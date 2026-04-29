import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import { diffChars } from 'diff'
import {
  AlertTriangle,
  Bug,
  ChevronDown,
  Code2,
  FileCode2,
  GitCompareArrows,
  RefreshCw,
  SearchCode,
  ShieldCheck,
  Upload,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useTransition, type ChangeEvent } from 'react'
import type * as Monaco from 'monaco-editor'
import { Badge } from './components/retroui/Badge'
import { Button } from './components/retroui/Button'
import { Card } from './components/retroui/Card'
import { TabButton } from './components/retroui/Tabs'
import { analyzeCode, buildDiffResult } from './lib/codeAnalysis'
import { cn } from './lib/utils'
import type { CodeLine, DiffResult, ErrorFinding, ReviewSummary } from './types'

type MonacoApi = typeof Monaco
type TabKey = 'summary' | 'errors' | 'review'

interface EditorPanelProps {
  title: string
  description: string
  value: string
  language: string
  fileName: string
  lineNumberMap?: Map<number, number>
  modeLabel?: string
  readOnly?: boolean
  tone: 'original' | 'new'
  lineCount: number
  onChange: (value: string) => void
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void
  onMount: OnMount
  beforeMount: BeforeMount
}

interface AnalysisState {
  findings: ErrorFinding[]
  review: ReviewSummary | null
}

interface DiffTooltipState {
  x: number
  y: number
  title: string
  kind: 'added' | 'removed' | 'modified' | 'risky' | 'missing'
  before?: string
  after?: string
  code?: string
  missingLines?: string[]
  risk?: string
}

interface CodeDiffSegment {
  value: string
  added?: boolean
  removed?: boolean
}

const DEFAULT_ORIGINAL_CODE = `import { formatCurrency } from './money'

function calculateTotal(items) {
  return items.reduce((total, item) => total + item.price * item.qty, 0);
}

export function checkout(cart, taxRate) {
  const subtotal = calculateTotal(cart.items);
  return formatCurrency(subtotal + subtotal * taxRate);
}`

const DEFAULT_NEW_CODE = `import { formatCurrency } from './money'

function calculateSum(items) {
  return items.reduce((total, item) => total + item.price * item.quantity, 0)
}

export function checkout(cart, taxRate) {
  const subtotal = calculateTotal(cart.items)
  if (taxRate = 0) {
    return subtotal
  }
  return formatCurrency(subtotal + subtotal * taxRate)`

const WORKSPACE_STORAGE_KEYS = {
  newCode: 'comparitor:new-code',
  newFileName: 'comparitor:new-file-name',
  originalCode: 'comparitor:original-code',
  originalFileName: 'comparitor:original-file-name',
} as const

const LANGUAGE_OPTIONS = [
  'plaintext',
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'css',
  'html',
  'python',
  'go',
  'rust',
  'java',
] as const

const TABS: Array<{ id: TabKey; label: string }> = [
  { id: 'summary', label: 'Diff Summary' },
  { id: 'errors', label: 'Possible Errors' },
  { id: 'review', label: 'Code Review' },
]

const EDITOR_OPTIONS: Monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  fixedOverflowWidgets: true,
  fontFamily: 'Space Mono, Consolas, monospace',
  fontSize: 13,
  glyphMargin: true,
  hover: { enabled: false },
  lineHeight: 20,
  lineDecorationsWidth: 12,
  lineNumbers: 'on',
  minimap: { enabled: false },
  padding: { top: 14, bottom: 14 },
  renderLineHighlight: 'all',
  renderWhitespace: 'selection',
  roundedSelection: false,
  scrollBeyondLastLine: false,
  scrollbar: {
    horizontalScrollbarSize: 10,
    verticalScrollbarSize: 10,
  },
  tabSize: 2,
  wordWrap: 'on',
}

function readWorkspaceValue(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function getLineCount(value: string) {
  if (!value) return 0
  return value.replace(/\r\n/g, '\n').split('\n').length
}

function inferLanguageFromFile(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    cjs: 'javascript',
    css: 'css',
    go: 'go',
    html: 'html',
    java: 'java',
    js: 'javascript',
    json: 'json',
    jsx: 'jsx',
    mjs: 'javascript',
    py: 'python',
    rs: 'rust',
    ts: 'typescript',
    tsx: 'tsx',
  }

  return extension ? map[extension] : undefined
}

function inferLanguageFromCode(code: string) {
  const value = code.trim()

  if (!value) return undefined
  if (/^https?:\/\/\S+$/i.test(value)) return 'plaintext'

  try {
    JSON.parse(value)
    return 'json'
  } catch {
    // Continue with language heuristics when the snippet is not strict JSON.
  }

  if (/<\/?[a-z][\s\S]*>/i.test(value)) return 'html'
  if (/^\s*(from\s+[\w.]+\s+import\s+|import\s+\w+|def\s+\w+\s*\(|class\s+\w+\b|print\s*\(|self\.)/m.test(value)) {
    return 'python'
  }
  if (/\bpackage\s+main\b|\bfunc\s+\w+\s*\(/.test(value)) return 'go'
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|println!\s*\(/.test(value)) return 'rust'
  if (/\bpublic\s+class\b|\bSystem\.out\.println\b/.test(value)) return 'java'
  if (/\binterface\s+\w+\b|\btype\s+\w+\s*=|:\s*(string|number|boolean|unknown)\b|\bas\s+\w+/.test(value)) {
    return 'typescript'
  }
  if (/\bimport\s+.*\s+from\b|\bexport\b|\bconst\b|\blet\b|\bfunction\b|=>/.test(value)) return 'javascript'
  if (/[.#][\w-]+\s*\{|\b(display|color|margin|padding|font-size)\s*:/.test(value)) return 'css'

  return 'plaintext'
}

function detectLanguage(originalCode: string, newCode: string, originalFileName: string, newFileName: string) {
  const codeLanguage = inferLanguageFromCode(newCode) ?? inferLanguageFromCode(originalCode)
  const fileLanguage = inferLanguageFromFile(newFileName) ?? inferLanguageFromFile(originalFileName)

  if (fileLanguage === 'typescript' && codeLanguage === 'javascript') return 'typescript'
  if (fileLanguage === 'tsx' && (codeLanguage === 'javascript' || codeLanguage === 'typescript')) return 'tsx'
  if (fileLanguage === 'jsx' && codeLanguage === 'javascript') return 'jsx'

  return codeLanguage ?? fileLanguage ?? 'plaintext'
}

function defineRetroMonacoTheme(monaco: MonacoApi) {
  monaco.editor.defineTheme('retro-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'd4d4d8', background: '101014' },
      { token: 'comment', foreground: '7c8190', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'facc15', fontStyle: 'bold' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: '67e8f9' },
      { token: 'type', foreground: 'c4b5fd' },
    ],
    colors: {
      'editor.background': '#101014',
      'editor.foreground': '#d4d4d8',
      'editor.lineHighlightBackground': '#27272a88',
      'editor.lineHighlightBorder': '#00000000',
      'editorLineNumber.foreground': '#71717a',
      'editorLineNumber.activeForeground': '#facc15',
      'editorCursor.foreground': '#facc15',
      'editor.selectionBackground': '#facc1540',
      'editorGutter.background': '#101014',
    },
  })
}

function markerSeverity(monaco: MonacoApi, severity: ErrorFinding['severity']) {
  if (severity === 'error') return monaco.MarkerSeverity.Error
  if (severity === 'warning') return monaco.MarkerSeverity.Warning
  return monaco.MarkerSeverity.Info
}

function lineDecorationClass(line: CodeLine) {
  if (line.type === 'added') return 'diff-line-added'
  if (line.type === 'removed') return 'diff-line-removed'
  if (line.type === 'modified') return 'diff-line-modified'
  if (line.type === 'risky') return 'diff-line-risky'
  return undefined
}

function formatHoverCode(code: string) {
  return code.trim() ? code : '(blank line)'
}

function getMissingLinesByTargetLine(
  originalLines: CodeLine[],
  newLines: CodeLine[],
) {
  const missingByTargetLine = new Map<number, string[]>()

  newLines.forEach((newLine, index) => {
    const originalLine = originalLines[index]

    if (newLine.type !== 'empty' || originalLine?.type !== 'removed') return

    const nextLine = newLines.slice(index + 1).find((line) => line.lineNumber)
    const previousLine = newLines.slice(0, index).reverse().find((line) => line.lineNumber)
    const targetLineNumber = nextLine?.lineNumber ?? previousLine?.lineNumber

    if (!targetLineNumber) return

    const missingLines = missingByTargetLine.get(targetLineNumber) ?? []
    missingLines.push(originalLine.content)
    missingByTargetLine.set(targetLineNumber, missingLines)
  })

  return missingByTargetLine
}

function buildMissingCodeHoverDecorations(
  monaco: MonacoApi,
  originalLines: CodeLine[],
  newLines: CodeLine[],
): Monaco.editor.IModelDeltaDecoration[] {
  const missingByTargetLine = getMissingLinesByTargetLine(originalLines, newLines)

  return Array.from(missingByTargetLine.entries()).map(([lineNumber, missingLines]) => ({
    range: new monaco.Range(lineNumber, 1, lineNumber, 1),
    options: {
      glyphMarginClassName: 'diff-glyph-missing',
      hoverMessage: {
        value: `**Missing from new code near this line**\n\n\`\`\`text\n${missingLines.map(formatHoverCode).join('\n')}\n\`\`\``,
      },
      isWholeLine: true,
      overviewRuler: {
        color: '#ef4444',
        position: monaco.editor.OverviewRulerLane.Right,
      },
    },
  }))
}

function buildEditorDecorations(
  monaco: MonacoApi,
  lines: CodeLine[],
): Monaco.editor.IModelDeltaDecoration[] {
  return lines.flatMap((line) => {
    if (!line.lineNumber) return []

    const decorations: Monaco.editor.IModelDeltaDecoration[] = []
    const className = lineDecorationClass(line)
    const endColumn = Math.max(1, line.content.length + 1)

    if (className) {
      decorations.push({
        range: new monaco.Range(line.lineNumber, 1, line.lineNumber, endColumn),
        options: {
          glyphMarginClassName: className,
          isWholeLine: true,
        },
      })
    }

    if (line.risk) {
      decorations.push({
        range: new monaco.Range(line.lineNumber, 1, line.lineNumber, endColumn),
        options: {
          glyphMarginClassName: 'diff-glyph-risky',
          isWholeLine: true,
          overviewRuler: {
            color: '#f59e0b',
            position: monaco.editor.OverviewRulerLane.Right,
          },
        },
      })
    }

    return decorations
  })
}

function getLineByNumber(lines: CodeLine[], lineNumber: number) {
  return lines.find((line) => line.lineNumber === lineNumber)
}

function getTooltipPosition(clientX: number, clientY: number) {
  const width = Math.min(720, window.innerWidth - 32)
  const maxX = Math.max(16, window.innerWidth - width - 16)
  const maxY = Math.max(16, window.innerHeight - 360)

  return {
    x: Math.max(16, Math.min(clientX + 18, maxX)),
    y: Math.max(16, Math.min(clientY + 18, maxY)),
  }
}

function buildDiffTooltipState(
  diffResult: DiffResult,
  side: 'original' | 'new',
  lineNumber: number,
  clientX: number,
  clientY: number,
): DiffTooltipState | null {
  const lines = side === 'new' ? diffResult.newLines : diffResult.originalLines
  const counterpartLines = side === 'new' ? diffResult.originalLines : diffResult.newLines
  const line = getLineByNumber(lines, lineNumber)
  const counterpart = line?.counterpartLine ? getLineByNumber(counterpartLines, line.counterpartLine) : undefined
  const missingLines = side === 'new'
    ? getMissingLinesByTargetLine(diffResult.originalLines, diffResult.newLines).get(lineNumber)
    : undefined
  const position = getTooltipPosition(clientX, clientY)

  if (!line && !missingLines?.length) return null

  if (line?.type === 'added' && side === 'new') {
    return {
      ...position,
      title: 'Added in new code',
      kind: 'added',
      code: line.content,
      missingLines,
      risk: line.risk,
    }
  }

  if (line?.type === 'removed' && side === 'original') {
    return {
      ...position,
      title: 'Missing from new code',
      kind: 'removed',
      code: line.content,
      risk: line.risk,
    }
  }

  if (line?.type === 'modified' && counterpart) {
    return {
      ...position,
      title: side === 'new' ? 'Changed from original' : 'Changed to new code',
      kind: line.risk ? 'risky' : 'modified',
      before: side === 'new' ? counterpart.content : line.content,
      after: side === 'new' ? line.content : counterpart.content,
      missingLines,
      risk: line.risk,
    }
  }

  if (line?.risk) {
    return {
      ...position,
      title: 'Possible risky change',
      kind: 'risky',
      code: line.content,
      missingLines,
      risk: line.risk,
    }
  }

  if (missingLines?.length) {
    return {
      ...position,
      title: 'Missing code near this line',
      kind: 'missing',
      missingLines,
    }
  }

  return null
}

function buildChangedOnlyView(diffResult: DiffResult | null) {
  const lineMap = new Map<number, number>()
  const displayLines: CodeLine[] = []

  if (!diffResult) {
    return { code: '', displayLines, lineMap }
  }

  const output: string[] = []

  function pushChangedLine(line: CodeLine) {
    if (!line.lineNumber) return

    output.push(line.content)

    const displayLineNumber = output.length
    lineMap.set(displayLineNumber, line.lineNumber)
    displayLines.push({
      ...line,
      id: `changed-only-${line.id}-${displayLineNumber}`,
      lineNumber: displayLineNumber,
    })
  }

  diffResult.newLines.forEach((newLine) => {
    const changed = newLine.type === 'added' || newLine.type === 'modified' || Boolean(newLine.risk)

    if (changed) pushChangedLine(newLine)
  })

  return {
    code: output.join('\n'),
    displayLines,
    lineMap,
  }
}

function getSeverityTone(severity: ErrorFinding['severity']) {
  if (severity === 'error') return 'danger'
  if (severity === 'warning') return 'warning'
  return 'default'
}

function getRiskTone(risk: ReviewSummary['riskLevel']) {
  if (risk === 'High') return 'danger'
  if (risk === 'Medium') return 'warning'
  return 'success'
}

function EditorPanel({
  title,
  description,
  value,
  language,
  fileName,
  lineNumberMap,
  modeLabel,
  readOnly = false,
  tone,
  lineCount,
  onChange,
  onUpload,
  onMount,
  beforeMount,
}: EditorPanelProps) {
  return (
    <Card className="flex min-h-[560px] min-w-0 flex-col overflow-hidden bg-code text-white shadow-hard-lg xl:h-full">
      <Card.Header className="flex flex-col gap-3 bg-card text-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Card.Title className="text-lg">{title}</Card.Title>
            <Badge variant={tone === 'original' ? 'surface' : 'warning'} size="sm">
              {lineCount} lines
            </Badge>
            {modeLabel ? (
              <Badge variant="solid" size="sm">
                {modeLabel}
              </Badge>
            ) : null}
          </div>
          <Card.Description>{description}</Card.Description>
        </div>
        <Button asChild variant="outline" size="sm" className="w-fit bg-background text-foreground">
          <label>
            <Upload className="size-4" /> Upload
            <input
              className="sr-only"
              type="file"
              accept=".js,.jsx,.ts,.tsx,.json,.css,.html,.py,.go,.rs,.java,.txt,.md"
              onChange={onUpload}
            />
          </label>
        </Button>
      </Card.Header>
      <div className="border-b-2 border-border bg-zinc-950 px-4 py-2 font-mono text-xs text-zinc-400">
        {fileName} · Monaco · {language}
      </div>
      <div className="min-h-[480px] flex-1 overflow-hidden bg-[#101014]">
        <Editor
          beforeMount={beforeMount}
          height="100%"
          language={language}
          onChange={(nextValue) => {
            if (!readOnly) onChange(nextValue ?? '')
          }}
          onMount={onMount}
          options={{
            ...EDITOR_OPTIONS,
            lineNumbers: lineNumberMap
              ? (lineNumber) => String(lineNumberMap.get(lineNumber) ?? lineNumber)
              : 'on',
            readOnly,
          }}
          theme="retro-dark"
          value={value}
        />
      </div>
    </Card>
  )
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-md border-2 border-border bg-background p-3 shadow-hard-sm">
      <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-head text-3xl', tone)}>{value}</p>
    </div>
  )
}

function DiffLine({ line, side }: { line?: CodeLine; side: 'original' | 'new' }) {
  const effectiveType = line?.risk ? 'risky' : line?.type ?? 'empty'
  const typeClass = {
    added: 'border-success/60 bg-success/15',
    empty: 'border-border bg-muted/40 text-muted-foreground',
    modified: 'border-warning/70 bg-warning/15',
    removed: 'border-destructive/60 bg-destructive/15',
    risky: 'border-warning bg-warning/20',
    unchanged: 'border-border bg-card',
  }[effectiveType]
  const symbol = {
    added: '+',
    empty: '·',
    modified: '~',
    removed: '-',
    risky: '!',
    unchanged: ' ',
  }[effectiveType]
  const placeholder = side === 'new' ? 'deleted from new version' : 'added in new version'

  return (
    <div className={cn('grid grid-cols-[2rem_3.25rem_1fr] border-b border-border/60 font-mono text-xs', typeClass)}>
      <span className="select-none border-r border-border/60 px-2 py-1 text-center font-bold">
        {symbol}
      </span>
      <span className="select-none border-r border-border/60 px-2 py-1 text-right text-muted-foreground">
        {line?.lineNumber ?? '·'}
      </span>
      <code
        className={cn(
          'min-h-7 overflow-x-auto whitespace-pre px-2 py-1 text-left',
          line?.type === 'empty' && 'italic text-muted-foreground',
        )}
      >
        {line?.content || (line?.type === 'empty' ? placeholder : ' ')}
      </code>
    </div>
  )
}

function AlignedDiffView({ diffResult }: { diffResult: DiffResult | null }) {
  if (!diffResult) {
    return <EmptyState message="Run Compare to generate an aligned line-by-line diff." />
  }

  const rows = diffResult.originalLines.map((line, index) => ({
    left: line,
    right: diffResult.newLines[index],
  }))
  const visibleRows = rows.slice(0, 160)

  return (
    <div className="overflow-hidden rounded-lg border-2 border-border bg-card shadow-hard-sm">
      <div className="grid grid-cols-1 border-b-2 border-border bg-muted font-head text-xs uppercase tracking-[0.08em] md:grid-cols-2">
        <div className="border-b-2 border-border p-2 md:border-b-0 md:border-r-2">Original aligned view</div>
        <div className="p-2">New aligned view</div>
      </div>
      <div className="grid min-h-[420px] max-h-[min(70vh,760px)] grid-cols-1 overflow-auto md:grid-cols-2">
        <div className="border-b-2 border-border md:border-b-0 md:border-r-2">
          {visibleRows.map((row) => (
            <DiffLine key={row.left.id} line={row.left} side="original" />
          ))}
        </div>
        <div>
          {visibleRows.map((row) => (
            <DiffLine key={row.right.id} line={row.right} side="new" />
          ))}
        </div>
      </div>
      {rows.length > visibleRows.length ? (
        <div className="border-t-2 border-border bg-muted p-3 text-sm text-muted-foreground">
          Showing first {visibleRows.length} aligned rows for scan performance.
        </div>
      ) : null}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border-2 border-dashed border-border bg-muted p-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function getCodeDiffSegments(before: string, after: string): CodeDiffSegment[] {
  return diffChars(before, after)
}

function TooltipCodeBlock({
  label,
  code,
  diffSegments,
  side,
  tone,
}: {
  label: string
  code: string
  diffSegments?: CodeDiffSegment[]
  side?: 'before' | 'after'
  tone?: 'added' | 'removed'
}) {
  const wholeBlockTone = tone === 'added'
    ? 'bg-success/20 text-emerald-100'
    : tone === 'removed'
      ? 'bg-destructive/20 text-red-100'
      : ''

  return (
    <div>
      <p className="mb-1 font-head text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <pre className={cn('max-h-52 whitespace-pre-wrap break-words rounded-md border-2 border-border bg-code p-3 font-mono text-xs leading-5 text-zinc-100', wholeBlockTone)}>
        {diffSegments && side
          ? diffSegments
              .filter((segment) => (side === 'before' ? !segment.added : !segment.removed))
              .map((segment, index) => (
                <span
                  key={`${segment.value}-${index}`}
                  className={cn(
                    side === 'before' && segment.removed && 'rounded border border-destructive bg-destructive/65 px-0.5 font-bold text-red-50',
                    side === 'after' && segment.added && 'rounded border border-success bg-success/55 px-0.5 font-bold text-emerald-50',
                  )}
                >
                  {segment.value}
                </span>
              ))
          : formatHoverCode(code)}
      </pre>
    </div>
  )
}

function DiffTooltip({ tooltip }: { tooltip: DiffTooltipState }) {
  const tone = {
    added: 'success',
    missing: 'danger',
    modified: 'warning',
    removed: 'danger',
    risky: 'warning',
  }[tooltip.kind] as 'success' | 'danger' | 'warning'
  const diffSegments = tooltip.before !== undefined && tooltip.after !== undefined
    ? getCodeDiffSegments(tooltip.before, tooltip.after)
    : undefined

  return (
    <div
      className="pointer-events-none fixed z-[10000] w-[min(720px,calc(100vw-2rem))] rounded-xl border-2 border-border bg-card p-4 text-foreground shadow-hard-lg"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-border pb-2">
        <Badge variant={tone} size="sm">
          {tooltip.kind}
        </Badge>
        <h3 className="font-head text-sm uppercase tracking-[0.05em]">{tooltip.title}</h3>
      </div>

      <div className="mt-3 space-y-3">
        {tooltip.before !== undefined ? (
          <TooltipCodeBlock label="Before - excluded" code={tooltip.before} diffSegments={diffSegments} side="before" />
        ) : null}
        {tooltip.after !== undefined ? (
          <TooltipCodeBlock label="After - included" code={tooltip.after} diffSegments={diffSegments} side="after" />
        ) : null}
        {tooltip.code !== undefined ? (
          <TooltipCodeBlock label={tooltip.kind === 'added' ? 'Included code' : 'Code'} code={tooltip.code} tone={tooltip.kind === 'added' ? 'added' : undefined} />
        ) : null}
        {tooltip.missingLines?.length ? (
          <TooltipCodeBlock label="Excluded from new code" code={tooltip.missingLines.join('\n')} tone="removed" />
        ) : null}
        {tooltip.risk ? (
          <div className="rounded-md border-2 border-border bg-warning/20 p-3 text-sm font-semibold">
            {tooltip.risk}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function FindingCard({ finding }: { finding: ErrorFinding }) {
  return (
    <div className="rounded-lg border-2 border-border bg-background p-4 shadow-hard-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={getSeverityTone(finding.severity)} size="sm">
              {finding.severity}
            </Badge>
            <span className="font-head text-sm uppercase tracking-[0.05em]">{finding.title}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{finding.message}</p>
        </div>
        <Badge variant="solid" size="sm">
          {finding.line ? `Line ${finding.line}` : 'Global'}
        </Badge>
      </div>
      {finding.evidence ? (
        <pre className="mt-3 overflow-x-auto rounded-md border-2 border-border bg-code p-3 font-mono text-xs text-zinc-100">
          {finding.evidence}
        </pre>
      ) : null}
      <p className="mt-3 text-sm">
        <span className="font-bold">Suggestion:</span> {finding.suggestion}
      </p>
    </div>
  )
}

function ListPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border-2 border-border bg-background p-4 shadow-hard-sm">
      <h4 className="font-head text-sm uppercase tracking-[0.07em]">{title}</h4>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ResultsPanel({
  activeTab,
  diffResult,
  findings,
  review,
}: {
  activeTab: TabKey
  diffResult: DiffResult | null
  findings: ErrorFinding[]
  review: ReviewSummary | null
}) {
  if (activeTab === 'summary') {
    return (
      <div className="space-y-4">
        {diffResult ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard label="Added" value={diffResult.stats.added} tone="text-success" />
            <StatCard label="Removed" value={diffResult.stats.removed} tone="text-destructive" />
            <StatCard label="Modified" value={diffResult.stats.modified} tone="text-warning" />
            <StatCard label="Unchanged" value={diffResult.stats.unchanged} tone="text-foreground" />
            <StatCard label="Risky" value={diffResult.stats.risky} tone="text-warning" />
          </div>
        ) : null}
        <AlignedDiffView diffResult={diffResult} />
      </div>
    )
  }

  if (activeTab === 'errors') {
    if (findings.length === 0) {
      return <EmptyState message="No possible errors detected yet. Run Compare after changing code." />
    }

    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {findings.map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
      </div>
    )
  }

  if (!review) {
    return <EmptyState message="Run Compare to generate a code review summary." />
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border-2 border-border bg-background p-4 shadow-hard-sm">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={getRiskTone(review.riskLevel)}>{review.riskLevel} risk</Badge>
          <p className="text-sm text-muted-foreground">{review.summary}</p>
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ListPanel title="What changed" items={review.changes} />
        <ListPanel title="Risks" items={review.risks} />
        <ListPanel title="Improvements" items={review.improvements} />
      </div>
    </div>
  )
}

function App() {
  const [originalCode, setOriginalCode] = useState(() =>
    readWorkspaceValue(WORKSPACE_STORAGE_KEYS.originalCode, DEFAULT_ORIGINAL_CODE),
  )
  const [newCode, setNewCode] = useState(() =>
    readWorkspaceValue(WORKSPACE_STORAGE_KEYS.newCode, DEFAULT_NEW_CODE),
  )
  const [originalFileName, setOriginalFileName] = useState(() =>
    readWorkspaceValue(WORKSPACE_STORAGE_KEYS.originalFileName, 'original.ts'),
  )
  const [newFileName, setNewFileName] = useState(() =>
    readWorkspaceValue(WORKSPACE_STORAGE_KEYS.newFileName, 'modified.ts'),
  )
  const [diffResult, setDiffResult] = useState<DiffResult | null>(() =>
    buildDiffResult(originalCode, newCode),
  )
  const [analysis, setAnalysis] = useState<AnalysisState>(() => {
    const initialDiff = buildDiffResult(originalCode, newCode)
    const initialState = analyzeCode(originalCode, newCode, initialDiff)

    return { findings: initialState.findings, review: initialState.review }
  })
  const [activeTab, setActiveTab] = useState<TabKey>('summary')
  const [syncScroll, setSyncScroll] = useState(true)
  const [hoverTipsEnabled, setHoverTipsEnabled] = useState(true)
  const [changedOnlyMode, setChangedOnlyMode] = useState(false)
  const [diffTooltip, setDiffTooltip] = useState<DiffTooltipState | null>(null)
  const [isPending, startTransition] = useTransition()
  const originalEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const newEditorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<MonacoApi | null>(null)
  const diffResultRef = useRef<DiffResult | null>(diffResult)
  const originalDecorationIds = useRef<string[]>([])
  const newDecorationIds = useRef<string[]>([])
  const syncScrollRef = useRef(syncScroll)
  const hoverTipsEnabledRef = useRef(hoverTipsEnabled)
  const changedOnlyModeRef = useRef(changedOnlyMode)
  const changedOnlyLineMapRef = useRef<Map<number, number>>(new Map())
  const isSyncingScrollRef = useRef(false)
  const scrollDisposablesRef = useRef<Array<{ dispose: () => void }>>([])
  const mouseDisposablesRef = useRef<Array<{ dispose: () => void }>>([])

  const beforeMount: BeforeMount = (monaco) => {
    defineRetroMonacoTheme(monaco)
  }

  const handleOriginalMount: OnMount = (editor, monaco) => {
    originalEditorRef.current = editor
    monacoRef.current = monaco
    registerScrollSync()
    registerEditorTooltipHandlers()
  }

  const handleNewMount: OnMount = (editor, monaco) => {
    newEditorRef.current = editor
    monacoRef.current = monaco
    registerScrollSync()
    registerEditorTooltipHandlers()
  }

  useEffect(() => {
    syncScrollRef.current = syncScroll

    if (!syncScroll) return

    const originalEditor = originalEditorRef.current
    const newEditor = newEditorRef.current

    if (!originalEditor || !newEditor || isSyncingScrollRef.current) return

    isSyncingScrollRef.current = true
    newEditor.setScrollTop(originalEditor.getScrollTop())
    newEditor.setScrollLeft(originalEditor.getScrollLeft())
    window.requestAnimationFrame(() => {
      isSyncingScrollRef.current = false
    })
  }, [syncScroll])

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_STORAGE_KEYS.originalCode, originalCode)
      window.localStorage.setItem(WORKSPACE_STORAGE_KEYS.newCode, newCode)
      window.localStorage.setItem(WORKSPACE_STORAGE_KEYS.originalFileName, originalFileName)
      window.localStorage.setItem(WORKSPACE_STORAGE_KEYS.newFileName, newFileName)
    } catch {
      // Persistence is best-effort; the editor still works if storage is blocked.
    }
  }, [newCode, newFileName, originalCode, originalFileName])

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      startTransition(() => {
        const nextDiff = buildDiffResult(originalCode, newCode)
        const nextAnalysis = analyzeCode(originalCode, newCode, nextDiff)

        setDiffResult(nextDiff)
        setAnalysis({ findings: nextAnalysis.findings, review: nextAnalysis.review })
      })
    }, 120)

    return () => window.clearTimeout(timeoutId)
  }, [newCode, originalCode, startTransition])

  useEffect(() => {
    diffResultRef.current = diffResult
  }, [diffResult])

  useEffect(() => {
    return () => {
      scrollDisposablesRef.current.forEach((disposable) => disposable.dispose())
      scrollDisposablesRef.current = []
      mouseDisposablesRef.current.forEach((disposable) => disposable.dispose())
      mouseDisposablesRef.current = []
    }
  }, [])

  useEffect(() => {
    const monaco = monacoRef.current
    const originalEditor = originalEditorRef.current
    const newEditor = newEditorRef.current

    if (!monaco || !originalEditor || !newEditor) return

    const changedOnlyView = buildChangedOnlyView(diffResult)
    const sourceToDisplayLine = new Map(
      Array.from(changedOnlyView.lineMap.entries()).map(
        ([displayLineNumber, sourceLineNumber]) => [sourceLineNumber, displayLineNumber] as const,
      ),
    )

    originalDecorationIds.current = originalEditor.deltaDecorations(
      originalDecorationIds.current,
      diffResult ? buildEditorDecorations(monaco, diffResult.originalLines) : [],
    )
    newDecorationIds.current = newEditor.deltaDecorations(
      newDecorationIds.current,
      diffResult
        ? changedOnlyMode
          ? buildEditorDecorations(monaco, changedOnlyView.displayLines)
          : [
              ...buildEditorDecorations(monaco, diffResult.newLines),
              ...buildMissingCodeHoverDecorations(monaco, diffResult.originalLines, diffResult.newLines),
            ]
        : [],
    )

    const model = newEditor.getModel()

    if (model) {
      monaco.editor.setModelMarkers(
        model,
        'comparitor-analysis',
        analysis.findings
          .filter((finding) => finding.line)
          .flatMap((finding) => {
            const sourceLine = finding.line ?? 1
            const targetLine = changedOnlyMode ? sourceToDisplayLine.get(sourceLine) : sourceLine

            if (!targetLine) return []

            const line = Math.min(targetLine, model.getLineCount())

            return [{
              endColumn: model.getLineMaxColumn(line),
              endLineNumber: line,
              message: `${finding.title}: ${finding.message}`,
              severity: markerSeverity(monaco, finding.severity),
              startColumn: 1,
              startLineNumber: line,
            }]
          }),
      )
    }
  }, [analysis.findings, changedOnlyMode, diffResult])

  function runAnalysis(nextTab: TabKey) {
    startTransition(() => {
      const nextDiff = buildDiffResult(originalCode, newCode)
      const nextAnalysis = analyzeCode(originalCode, newCode, nextDiff)

      setDiffResult(nextDiff)
      setAnalysis({ findings: nextAnalysis.findings, review: nextAnalysis.review })
      setActiveTab(nextTab)
    })
  }

  function resetWorkspace() {
    setOriginalCode('')
    setNewCode('')
    setOriginalFileName('original')
    setNewFileName('modified')
    setDiffResult(null)
    setAnalysis({ findings: [], review: null })
    setActiveTab('summary')
  }

  async function uploadFile(side: 'original' | 'new', event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const text = await file.text()

    if (side === 'original') {
      setOriginalCode(text)
      setOriginalFileName(file.name)
    } else {
      setNewCode(text)
      setNewFileName(file.name)
    }

    event.target.value = ''
  }

  function syncEditorScroll(
    sourceEditor: Monaco.editor.IStandaloneCodeEditor,
    targetEditor: Monaco.editor.IStandaloneCodeEditor,
  ) {
    if (!syncScrollRef.current || isSyncingScrollRef.current) return

    isSyncingScrollRef.current = true
    targetEditor.setScrollTop(sourceEditor.getScrollTop())
    targetEditor.setScrollLeft(sourceEditor.getScrollLeft())
    window.requestAnimationFrame(() => {
      isSyncingScrollRef.current = false
    })
  }

  function registerScrollSync() {
    const originalEditor = originalEditorRef.current
    const newEditor = newEditorRef.current

    if (!originalEditor || !newEditor) return

    scrollDisposablesRef.current.forEach((disposable) => disposable.dispose())
    scrollDisposablesRef.current = [
      originalEditor.onDidScrollChange(() => syncEditorScroll(originalEditor, newEditor)),
      newEditor.onDidScrollChange(() => syncEditorScroll(newEditor, originalEditor)),
    ]
  }

  function showEditorDiffTooltip(side: 'original' | 'new', event: Monaco.editor.IEditorMouseEvent) {
    const lineNumber = event.target.position?.lineNumber
    const currentDiffResult = diffResultRef.current

    if (!hoverTipsEnabledRef.current || !lineNumber || !currentDiffResult) {
      setDiffTooltip(null)
      return
    }

    const sourceLineNumber = side === 'new' && changedOnlyModeRef.current
      ? changedOnlyLineMapRef.current.get(lineNumber)
      : lineNumber

    if (!sourceLineNumber) {
      setDiffTooltip(null)
      return
    }

    setDiffTooltip(
      buildDiffTooltipState(
        currentDiffResult,
        side,
        sourceLineNumber,
        event.event.posx,
        event.event.posy,
      ),
    )
  }

  function registerEditorTooltipHandlers() {
    const originalEditor = originalEditorRef.current
    const newEditor = newEditorRef.current

    if (!originalEditor || !newEditor) return

    mouseDisposablesRef.current.forEach((disposable) => disposable.dispose())
    mouseDisposablesRef.current = [
      originalEditor.onMouseMove((event) => showEditorDiffTooltip('original', event)),
      originalEditor.onMouseLeave(() => setDiffTooltip(null)),
      newEditor.onMouseMove((event) => showEditorDiffTooltip('new', event)),
      newEditor.onMouseLeave(() => setDiffTooltip(null)),
    ]
  }

  function navigateDashboard(sectionId: 'workspace' | 'analysis', tab?: TabKey) {
    if (tab) setActiveTab(tab)

    window.setTimeout(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 0)
  }

  function toggleHoverTips() {
    const nextValue = !hoverTipsEnabledRef.current

    hoverTipsEnabledRef.current = nextValue
    setHoverTipsEnabled(nextValue)
    if (!nextValue) setDiffTooltip(null)
  }

  function toggleChangedOnlyMode() {
    const nextValue = !changedOnlyModeRef.current

    changedOnlyModeRef.current = nextValue
    setChangedOnlyMode(nextValue)
    setDiffTooltip(null)
  }

  function updateNewCode(value: string) {
    if (changedOnlyModeRef.current) return
    setNewCode(value)
  }

  const errorCount = analysis.findings.filter((finding) => finding.severity === 'error').length
  const warningCount = analysis.findings.filter((finding) => finding.severity === 'warning').length
  const currentOriginalLineCount = getLineCount(originalCode)
  const currentNewLineCount = getLineCount(newCode)
  const language = detectLanguage(originalCode, newCode, originalFileName, newFileName)
  const changedOnlyNewView = useMemo(
    () => buildChangedOnlyView(diffResult),
    [diffResult],
  )
  const newEditorValue = changedOnlyMode ? changedOnlyNewView.code : newCode
  const visibleNewLineCount = changedOnlyMode ? getLineCount(newEditorValue) : currentNewLineCount

  useEffect(() => {
    changedOnlyModeRef.current = changedOnlyMode
  }, [changedOnlyMode])

  useEffect(() => {
    changedOnlyLineMapRef.current = changedOnlyNewView.lineMap
  }, [changedOnlyNewView])

  const dashboardNavItems = [
    { label: 'Workspace', icon: Code2, section: 'workspace' as const },
    { label: 'Diff Summary', icon: GitCompareArrows, section: 'analysis' as const, tab: 'summary' as const },
    { label: 'Possible Errors', icon: Bug, section: 'analysis' as const, tab: 'errors' as const },
    { label: 'Code Review', icon: ShieldCheck, section: 'analysis' as const, tab: 'review' as const },
  ]

  return (
    <main className="min-h-screen bg-background bg-grid bg-[length:32px_32px] text-foreground lg:h-screen lg:overflow-hidden">
      <section className="grid h-full w-full gap-4 p-3 sm:p-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="rounded-2xl border-2 border-border bg-card p-4 shadow-hard-lg lg:h-[calc(100vh-2rem)] lg:overflow-auto">
          <div className="flex items-center gap-3 border-b-2 border-border pb-4">
            <div className="grid size-11 shrink-0 place-items-center rounded-lg border-2 border-border bg-primary text-primary-foreground shadow-hard-sm">
              <SearchCode className="size-5" />
            </div>
            <div>
              <h1 className="font-head text-xl uppercase leading-none">Comparitor</h1>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                Diff dashboard
              </p>
            </div>
          </div>

          <nav aria-label="Dashboard navigation" className="mt-4 grid gap-2">
            {dashboardNavItems.map((item) => {
              const Icon = item.icon
              const active = item.tab ? activeTab === item.tab : false

              return (
                <button
                  key={item.label}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border-2 border-border px-3 py-2 text-left font-head text-sm uppercase tracking-[0.04em] transition-all',
                    active
                      ? 'translate-x-1 translate-y-1 bg-secondary text-secondary-foreground shadow-none'
                      : 'bg-background shadow-hard-sm hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none',
                  )}
                  onClick={() => navigateDashboard(item.section, item.tab)}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              )
            })}
          </nav>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-lg border-2 border-border bg-muted p-3 shadow-hard-sm">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Errors</p>
              <p className="font-head text-3xl text-destructive">{errorCount}</p>
            </div>
            <div className="rounded-lg border-2 border-border bg-muted p-3 shadow-hard-sm">
              <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">Risks</p>
              <p className="font-head text-3xl text-warning">{diffResult?.stats.risky ?? 0}</p>
            </div>
          </div>

          <label className="mt-4 grid gap-2 rounded-xl border-2 border-border bg-background p-3 shadow-hard-sm">
            <span className="font-head text-xs uppercase tracking-[0.08em]">Editor language</span>
            <div className="relative">
              <select
                className="w-full appearance-none rounded-md border-2 border-border bg-card px-3 py-2 pr-11 font-mono text-sm shadow-hard-sm outline-none disabled:cursor-default disabled:opacity-100"
                disabled
                value={language}
              >
                {LANGUAGE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" />
            </div>
          </label>

          <button
            type="button"
            aria-pressed={syncScroll}
            className={cn(
              'mt-3 flex w-full items-center justify-between rounded-lg border-2 border-border px-3 py-2 font-head text-sm uppercase transition-all shadow-hard-sm hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none',
              syncScroll ? 'bg-success text-black' : 'bg-background text-foreground',
            )}
            onClick={() => setSyncScroll((current) => !current)}
          >
            <span>Sync scroll</span>
            <span className="font-mono text-xs">{syncScroll ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            aria-pressed={hoverTipsEnabled}
            className={cn(
              'mt-3 flex w-full items-center justify-between rounded-lg border-2 border-border px-3 py-2 font-head text-sm uppercase transition-all shadow-hard-sm hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none',
              hoverTipsEnabled ? 'bg-secondary text-secondary-foreground' : 'bg-background text-foreground',
            )}
            onClick={toggleHoverTips}
          >
            <span>Hover tips</span>
            <span className="font-mono text-xs">{hoverTipsEnabled ? 'ON' : 'OFF'}</span>
          </button>

          <button
            type="button"
            aria-pressed={changedOnlyMode}
            className={cn(
              'mt-3 flex w-full items-center justify-between rounded-lg border-2 border-border px-3 py-2 font-head text-sm uppercase transition-all shadow-hard-sm hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-none',
              changedOnlyMode ? 'bg-primary text-primary-foreground' : 'bg-background text-foreground',
            )}
            onClick={toggleChangedOnlyMode}
          >
            <span>New code view</span>
            <span className="font-mono text-xs">{changedOnlyMode ? 'CHANGES' : 'FULL'}</span>
          </button>

          <div className="mt-3 grid gap-2.5">
            <Button className="w-full" onClick={() => runAnalysis('summary')} disabled={isPending}>
              <GitCompareArrows className="size-4" /> Compare
            </Button>
            <Button className="w-full" variant="outline" onClick={resetWorkspace}>
              <RefreshCw className="size-4" /> Reset
            </Button>
          </div>

        </aside>

        <div className="min-w-0 space-y-4 lg:h-[calc(100vh-2rem)] lg:overflow-auto lg:pr-2">
          <header className="rounded-2xl border-2 border-border bg-card p-3 shadow-hard-lg sm:p-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="surface">RetroUI system</Badge>
                  <Badge variant="solid">Monaco editor</Badge>
                  <Badge variant="warning">jsdiff engine</Badge>
                </div>
                <h2 className="mt-3 font-head text-2xl uppercase leading-tight sm:text-3xl">
                  Code Comparison Workspace
                </h2>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Paste, compare, debug, and review changes from one dashboard-focused workspace.
                </p>
              </div>

            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border-2 border-border bg-background p-3 shadow-hard-sm">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">New file</p>
                <p className="mt-1 font-head text-xl">{currentNewLineCount} lines</p>
              </div>
              <div className="rounded-lg border-2 border-border bg-background p-3 shadow-hard-sm">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Warnings</p>
                <p className="mt-1 font-head text-xl text-warning">{warningCount}</p>
              </div>
              <div className="rounded-lg border-2 border-border bg-background p-3 shadow-hard-sm">
                <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted-foreground">Status</p>
                <p className="mt-1 flex items-center gap-2 font-head text-xl">
                  {errorCount > 0 ? <AlertTriangle className="size-5 text-destructive" /> : <ShieldCheck className="size-5 text-success" />}
                  {errorCount > 0 ? 'Needs fix' : 'Reviewable'}
                </p>
              </div>
            </div>
          </header>

          <section id="workspace" className="scroll-mt-4 grid min-h-[calc(100vh-17rem)] gap-4 xl:grid-cols-2">
            <EditorPanel
              beforeMount={beforeMount}
              description="Paste the baseline or upload the previous file."
              fileName={originalFileName}
              language={language}
              lineCount={currentOriginalLineCount}
              onChange={setOriginalCode}
              onMount={handleOriginalMount}
              onUpload={(event) => uploadFile('original', event)}
              title="Original Code"
              tone="original"
              value={originalCode}
            />
            <EditorPanel
              beforeMount={beforeMount}
              description="Paste the edited version you want to debug and review."
              fileName={newFileName}
              language={language}
              lineNumberMap={changedOnlyMode ? changedOnlyNewView.lineMap : undefined}
              lineCount={visibleNewLineCount}
              modeLabel={changedOnlyMode ? 'Changed only' : undefined}
              onChange={updateNewCode}
              onMount={handleNewMount}
              onUpload={(event) => uploadFile('new', event)}
              readOnly={changedOnlyMode}
              title="New Code"
              tone="new"
              value={newEditorValue}
            />
          </section>

          <Card id="analysis" className="scroll-mt-4 min-h-[520px] overflow-hidden">
            <Card.Header className="flex flex-col gap-4 bg-secondary sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Code2 className="size-5" />
                  <Card.Title>Analysis Output</Card.Title>
                </div>
                <Card.Description className="text-foreground/70">
                  Diff summary, detected errors, and review guidance.
                </Card.Description>
              </div>
              <div className="flex flex-wrap gap-2">
                {errorCount > 0 ? (
                  <Badge variant="danger">
                    <AlertTriangle className="size-3" /> Errors found
                  </Badge>
                ) : (
                  <Badge variant="success">
                    <ShieldCheck className="size-3" /> No hard errors
                  </Badge>
                )}
                <Badge variant="solid">
                  <FileCode2 className="size-3" /> {currentNewLineCount} new lines
                </Badge>
              </div>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {TABS.map((tab) => (
                  <TabButton key={tab.id} active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                    {tab.label}
                  </TabButton>
                ))}
              </div>
              <ResultsPanel
                activeTab={activeTab}
                diffResult={diffResult}
                findings={analysis.findings}
                review={analysis.review}
              />
            </Card.Content>
          </Card>
        </div>
      </section>
      {diffTooltip ? <DiffTooltip tooltip={diffTooltip} /> : null}
    </main>
  )
}

export default App
