import { diffLines } from 'diff'
import type {
  CodeLine,
  DiffResult,
  ErrorFinding,
  ReviewSummary,
  SuggestedFix,
} from '../types'

interface SymbolRecord {
  name: string
  line: number
  kind: 'variable' | 'function' | 'class' | 'type' | 'import'
  sourceLine: string
}

interface DelimiterRecord {
  char: string
  line: number
  column: number
}

const OPEN_TO_CLOSE: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
}

const CLOSE_TO_OPEN: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
}

const DECLARATION_PATTERN = /\b(const|let|var|function|class|interface|type)\s+([A-Za-z_$][\w$]*)/g
const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/
const PYTHON_ASSIGNMENT_PATTERN = /^\s*([A-Za-z_]\w*)\s*(?::\s*[^=]+)?=(?!=)/
const PYTHON_DEF_PATTERN = /^\s*def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/
const PYTHON_CLASS_PATTERN = /^\s*class\s+([A-Za-z_]\w*)\b/

function splitDiffChunk(value: string) {
  if (!value) return []

  const normalized = value.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')

  if (normalized.endsWith('\n')) {
    lines.pop()
  }

  return lines
}

function countCodeLines(code: string) {
  if (!code) return 0
  return code.replace(/\r\n/g, '\n').split('\n').length
}

function makeCodeLine(
  side: 'original' | 'new',
  rowIndex: number,
  lineNumber: number | null,
  counterpartLine: number | null,
  content: string,
  type: CodeLine['type'],
  risk?: string,
): CodeLine {
  return {
    id: `${side}-${rowIndex}-${lineNumber ?? 'blank'}`,
    lineNumber,
    counterpartLine,
    content,
    type,
    risk,
  }
}

function riskyChangeReason(before: string, after: string) {
  const previous = before.trim()
  const next = after.trim()

  if (!previous || !next) return undefined
  if (/===|!==/.test(previous) && /[^=!]==[^=]|!=[^=]/.test(next)) {
    return 'Strict equality was loosened, which can hide type coercion bugs.'
  }
  if (previous.includes('&&') && next.includes('||')) {
    return 'The condition changed from AND to OR, which can widen execution paths.'
  }
  if (previous.includes('||') && next.includes('&&')) {
    return 'The condition changed from OR to AND, which can block valid execution paths.'
  }
  if (/return\s+true\b/.test(previous) && /return\s+false\b/.test(next)) {
    return 'A boolean return value was inverted.'
  }
  if (/return\s+false\b/.test(previous) && /return\s+true\b/.test(next)) {
    return 'A boolean return value was inverted.'
  }
  if (/\bawait\b/.test(previous) && !/\bawait\b/.test(next)) {
    return 'An await was removed, so asynchronous work may no longer finish before the next step.'
  }
  if (/\bthrow\b/.test(previous) && !/\bthrow\b/.test(next)) {
    return 'A thrown error path appears to have been removed.'
  }
  if (/\bif\s*\([^)]*=[^=>]/.test(next)) {
    return 'The condition contains an assignment, which is often meant to be a comparison.'
  }

  return riskyLineReason(after)
}

function riskyLineReason(line: string) {
  const value = line.trim()

  if (/\beval\s*\(/.test(value)) return 'eval executes dynamic code and is a security risk.'
  if (/\.innerHTML\s*=/.test(value)) return 'Writing innerHTML can create XSS issues when content is not sanitized.'
  if (/\bdebugger\b/.test(value)) return 'A debugger statement was added.'
  if (/\bconsole\.(log|debug)\s*\(/.test(value)) return 'A console debugging statement was added.'
  if (/(:\s*any\b|\bas\s+any\b)/.test(value)) return 'The change weakens TypeScript safety by using any.'
  if (/\bif\s*\([^)]*=[^=>]/.test(value)) return 'The condition contains an assignment, which is often meant to be a comparison.'

  return undefined
}

export function buildDiffResult(originalCode: string, newCode: string): DiffResult {
  const chunks = diffLines(originalCode, newCode)
  const originalLines: CodeLine[] = []
  const newLines: CodeLine[] = []
  const riskyLines: number[] = []
  let originalLineNumber = 1
  let newLineNumber = 1
  let rowIndex = 0
  let added = 0
  let removed = 0
  let modified = 0
  let unchanged = 0

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    const nextChunk = chunks[index + 1]

    if (chunk.removed && nextChunk?.added) {
      const removedLines = splitDiffChunk(chunk.value)
      const addedLines = splitDiffChunk(nextChunk.value)
      const maxLines = Math.max(removedLines.length, addedLines.length)

      for (let offset = 0; offset < maxLines; offset += 1) {
        const before = removedLines[offset]
        const after = addedLines[offset]

        if (before !== undefined && after !== undefined) {
          const risk = riskyChangeReason(before, after)

          originalLines.push(
            makeCodeLine(
              'original',
              rowIndex,
              originalLineNumber,
              newLineNumber,
              before,
              'modified',
            ),
          )
          newLines.push(
            makeCodeLine('new', rowIndex, newLineNumber, originalLineNumber, after, 'modified', risk),
          )
          if (risk) riskyLines.push(newLineNumber)
          originalLineNumber += 1
          newLineNumber += 1
          modified += 1
        } else if (before !== undefined) {
          originalLines.push(
            makeCodeLine('original', rowIndex, originalLineNumber, null, before, 'removed'),
          )
          newLines.push(makeCodeLine('new', rowIndex, null, originalLineNumber, '', 'empty'))
          originalLineNumber += 1
          removed += 1
        } else if (after !== undefined) {
          const risk = riskyLineReason(after)

          originalLines.push(makeCodeLine('original', rowIndex, null, newLineNumber, '', 'empty'))
          newLines.push(makeCodeLine('new', rowIndex, newLineNumber, null, after, 'added', risk))
          if (risk) riskyLines.push(newLineNumber)
          newLineNumber += 1
          added += 1
        }

        rowIndex += 1
      }

      index += 1
      continue
    }

    const lines = splitDiffChunk(chunk.value)

    for (const line of lines) {
      if (chunk.added) {
        const risk = riskyLineReason(line)

        originalLines.push(makeCodeLine('original', rowIndex, null, newLineNumber, '', 'empty'))
        newLines.push(makeCodeLine('new', rowIndex, newLineNumber, null, line, 'added', risk))
        if (risk) riskyLines.push(newLineNumber)
        newLineNumber += 1
        added += 1
      } else if (chunk.removed) {
        originalLines.push(makeCodeLine('original', rowIndex, originalLineNumber, null, line, 'removed'))
        newLines.push(makeCodeLine('new', rowIndex, null, originalLineNumber, '', 'empty'))
        originalLineNumber += 1
        removed += 1
      } else {
        originalLines.push(
          makeCodeLine('original', rowIndex, originalLineNumber, newLineNumber, line, 'unchanged'),
        )
        newLines.push(makeCodeLine('new', rowIndex, newLineNumber, originalLineNumber, line, 'unchanged'))
        originalLineNumber += 1
        newLineNumber += 1
        unchanged += 1
      }

      rowIndex += 1
    }
  }

  return {
    originalLines,
    newLines,
    riskyLines,
    stats: {
      added,
      removed,
      modified,
      unchanged,
      risky: riskyLines.length,
      totalOriginal: countCodeLines(originalCode),
      totalNew: countCodeLines(newCode),
    },
  }
}

function looksJavaScriptLike(code: string) {
  return /\b(const|let|var|function|import|export|return|class|interface|type)\b|=>/.test(code)
}

function scanDelimiterFindings(code: string): ErrorFinding[] {
  const findings: ErrorFinding[] = []
  const stack: DelimiterRecord[] = []
  const lines = code.replace(/\r\n/g, '\n').split('\n')
  let quote: 'single' | 'double' | 'template' | null = null
  let escaped = false
  let inBlockComment = false

  lines.forEach((line, lineIndex) => {
    let columnIndex = 0

    while (columnIndex < line.length) {
      const char = line[columnIndex]
      const next = line[columnIndex + 1]
      const lineNumber = lineIndex + 1

      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false
          columnIndex += 2
          continue
        }
        columnIndex += 1
        continue
      }

      if (quote) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (
          (quote === 'single' && char === "'") ||
          (quote === 'double' && char === '"') ||
          (quote === 'template' && char === '`')
        ) {
          quote = null
        }
        columnIndex += 1
        continue
      }

      if (char === '/' && next === '/') break
      if (char === '#') break
      if (char === '/' && next === '*') {
        inBlockComment = true
        columnIndex += 2
        continue
      }
      if (char === "'") quote = 'single'
      if (char === '"') quote = 'double'
      if (char === '`') quote = 'template'

      if (OPEN_TO_CLOSE[char]) {
        stack.push({ char, line: lineNumber, column: columnIndex + 1 })
      } else if (CLOSE_TO_OPEN[char]) {
        const expectedOpen = CLOSE_TO_OPEN[char]
        const last = stack[stack.length - 1]

        if (!last || last.char !== expectedOpen) {
          findings.push({
            id: `delimiter-unexpected-${lineNumber}-${columnIndex}`,
            severity: 'error',
            category: 'syntax',
            title: 'Unexpected closing delimiter',
            line: lineNumber,
            message: `Found "${char}" without a matching "${expectedOpen}".`,
            suggestion: 'Remove the extra delimiter or add the matching opener before this line.',
            evidence: line.trim(),
          })
        } else {
          stack.pop()
        }
      }

      columnIndex += 1
    }
  })

  if (stack.length > 0) {
    const missing = stack
      .slice()
      .reverse()
      .map((item) => OPEN_TO_CLOSE[item.char])
      .join('')
    const source = stack[stack.length - 1]

    findings.push({
      id: 'delimiter-unclosed',
      severity: 'error',
      category: 'missing-bracket',
      title: 'Missing closing delimiter',
      line: source.line,
      message: `The opener "${source.char}" at column ${source.column} is not closed.`,
      suggestion: `Add the missing closing delimiter sequence: ${missing}`,
      evidence: lines[source.line - 1]?.trim(),
      fixes: [{ type: 'append-text', text: `\n${missing}` }],
    })
  }

  return findings
}

function isSemicolonCandidate(line: string) {
  const value = line.trim()

  if (!value || value.startsWith('//') || value.startsWith('*')) return false
  if (/[;,{[(]$/.test(value) || /^[})\]]/.test(value)) return false
  if (/^(if|for|while|switch|catch|function|class|interface|type|else|try|finally|do)\b/.test(value)) {
    return false
  }

  return /^(const|let|var)\s+/.test(value) || /^return\b.+/.test(value) || /^[\w$.[\]'"()]+\s*[-+*/%]?=/.test(value)
}

function findSemicolonFindings(code: string, changedLines: Set<number>): ErrorFinding[] {
  if (!looksJavaScriptLike(code)) return []

  return code
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap((line, index) => {
      const lineNumber = index + 1

      if (!changedLines.has(lineNumber) || !isSemicolonCandidate(line)) return []

      return [
        {
          id: `semicolon-${lineNumber}`,
          severity: 'info',
          category: 'semicolons',
          title: 'Missing semicolon on changed line',
          line: lineNumber,
          message: 'This changed JavaScript/TypeScript line does not end with a semicolon.',
          suggestion: 'Add a semicolon if this project follows explicit statement terminators.',
          evidence: line.trim(),
          fixes: [{ type: 'append-semicolon', line: lineNumber }],
        } satisfies ErrorFinding,
      ]
    })
}

function parseNamedImports(line: string) {
  const named = line.match(/\{([^}]+)\}/)?.[1]
  if (!named) return []

  return named
    .split(',')
    .map((part) => part.trim().replace(/^type\s+/, ''))
    .map((part) => part.split(/\s+as\s+/i).at(-1)?.trim() ?? '')
    .filter((name) => IDENTIFIER_PATTERN.test(name))
}

function addSymbol(
  symbols: Map<string, SymbolRecord>,
  name: string | undefined,
  line: number,
  kind: SymbolRecord['kind'],
  sourceLine: string,
) {
  if (!name || !IDENTIFIER_PATTERN.test(name)) return
  symbols.set(name, { name, line, kind, sourceLine: sourceLine.trim() })
}

function extractPythonSymbols(
  trimmed: string,
  lineNumber: number,
  line: string,
  symbols: Map<string, SymbolRecord>,
) {
  if (/^from\s+/.test(trimmed)) {
    const imported = trimmed.match(/^from\s+[\w.]+\s+import\s+(.+)$/)?.[1]

    imported
      ?.split(',')
      .map((part) => part.trim().split(/\s+as\s+/i).at(-1)?.trim())
      .forEach((name) => addSymbol(symbols, name, lineNumber, 'import', line))
  }

  if (/^import\s+/.test(trimmed)) {
    trimmed
      .replace(/^import\s+/, '')
      .split(',')
      .map((part) => part.trim().split(/\s+as\s+/i).at(-1)?.trim())
      .forEach((name) => addSymbol(symbols, name, lineNumber, 'import', line))
  }

  const classMatch = PYTHON_CLASS_PATTERN.exec(line)
  addSymbol(symbols, classMatch?.[1], lineNumber, 'class', line)

  const defMatch = PYTHON_DEF_PATTERN.exec(line)
  addSymbol(symbols, defMatch?.[1], lineNumber, 'function', line)

  defMatch?.[2]
    .split(',')
    .map((part) => part.trim().replace(/^\*+/, '').split(':')[0]?.split('=')[0]?.trim())
    .forEach((name) => addSymbol(symbols, name, lineNumber, 'variable', line))

  const assignmentMatch = PYTHON_ASSIGNMENT_PATTERN.exec(line)
  addSymbol(symbols, assignmentMatch?.[1], lineNumber, 'variable', line)
}

function extractSymbols(code: string) {
  const symbols = new Map<string, SymbolRecord>()
  const lines = code.replace(/\r\n/g, '\n').split('\n')

  lines.forEach((line, index) => {
    const lineNumber = index + 1
    const trimmed = line.trim()

    if (/^import\b/.test(trimmed)) {
      const defaultImport = trimmed.match(/^import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)/)?.[1]
      const namespaceImport = trimmed.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1]
      const importedNames = [defaultImport, namespaceImport, ...parseNamedImports(trimmed)].filter(
        (name): name is string => Boolean(name),
      )

      importedNames.forEach((name) => {
        addSymbol(symbols, name, lineNumber, 'import', line)
      })
    }

    extractPythonSymbols(trimmed, lineNumber, line, symbols)

    DECLARATION_PATTERN.lastIndex = 0
    let match = DECLARATION_PATTERN.exec(line)

    while (match) {
      const keyword = match[1]
      const name = match[2]
      const kind = keyword === 'function' || keyword === 'class' ? keyword : keyword === 'interface' || keyword === 'type' ? 'type' : 'variable'

      addSymbol(symbols, name, lineNumber, kind, line)
      match = DECLARATION_PATTERN.exec(line)
    }
  })

  return symbols
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function findIdentifierLine(code: string, identifier: string) {
  const pattern = new RegExp(`\\b${escapeRegExp(identifier)}\\b`)
  const lines = code.replace(/\r\n/g, '\n').split('\n')

  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) return index + 1
  }

  return null
}

function levenshteinDistance(left: string, right: string) {
  const matrix = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let row = 0; row <= left.length; row += 1) matrix[row][0] = row
  for (let column = 0; column <= right.length; column += 1) matrix[0][column] = column

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + cost,
      )
    }
  }

  return matrix[left.length][right.length]
}

function findLikelyReplacement(name: string, candidates: Iterable<string>) {
  let bestName: string | null = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const candidate of candidates) {
    const distance = levenshteinDistance(name.toLowerCase(), candidate.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      bestName = candidate
    }
  }

  const allowedDistance = Math.max(2, Math.floor(name.length / 3))
  return bestName && bestDistance <= allowedDistance ? bestName : null
}

function detectSymbolFindings(originalCode: string, newCode: string): ErrorFinding[] {
  const originalSymbols = extractSymbols(originalCode)
  const newSymbols = extractSymbols(newCode)
  const findings: ErrorFinding[] = []

  for (const symbol of originalSymbols.values()) {
    if (newSymbols.has(symbol.name)) continue

    const usageLine = findIdentifierLine(newCode, symbol.name)
    const replacement = findLikelyReplacement(symbol.name, newSymbols.keys())

    if (usageLine) {
      findings.push({
        id: `deleted-symbol-used-${symbol.name}`,
        severity: 'error',
        category: symbol.kind === 'variable' ? 'variable-rename' : 'deleted-symbol',
        title: `${symbol.kind} "${symbol.name}" is still referenced`,
        line: usageLine,
        message: `"${symbol.name}" existed in the original code but is no longer declared in the new version.`,
        suggestion: replacement
          ? `Rename the remaining "${symbol.name}" reference to "${replacement}" or restore the declaration.`
          : `Restore the ${symbol.kind} or update every reference to the new name.`,
        fixes: replacement
          ? [{ type: 'replace-identifier', from: symbol.name, to: replacement, line: usageLine }]
          : symbol.sourceLine
            ? [{ type: 'insert-line', line: usageLine, text: symbol.sourceLine }]
            : undefined,
      })
    } else if (symbol.kind === 'function' || symbol.kind === 'class' || symbol.kind === 'import') {
      findings.push({
        id: `deleted-symbol-${symbol.name}`,
        severity: 'warning',
        category: 'deleted-symbol',
        title: `${symbol.kind} removed: ${symbol.name}`,
        line: null,
        message: `The original ${symbol.kind} "${symbol.name}" was removed from the new code.`,
        suggestion: 'Confirm callers, tests, and imports were updated before shipping this change.',
      })
    } else if (replacement) {
      findings.push({
        id: `renamed-variable-${symbol.name}`,
        severity: 'warning',
        category: 'variable-rename',
        title: `Possible variable rename: ${symbol.name} -> ${replacement}`,
        line: newSymbols.get(replacement)?.line ?? null,
        message: `A variable with a similar name appeared while "${symbol.name}" disappeared.`,
        suggestion: 'Check that every use site was renamed consistently.',
      })
    }

    if (findings.length >= 10) break
  }

  return findings
}

function detectRiskyFindings(diffResult: DiffResult): ErrorFinding[] {
  return diffResult.newLines.flatMap((line) => {
    if (!line.risk || !line.lineNumber) return []

    const isSecurity = /eval|innerHTML|security|XSS/.test(line.risk)
    return [
      {
        id: `risky-line-${line.lineNumber}`,
        severity: isSecurity ? 'error' : 'warning',
        category: isSecurity ? 'security' : 'logic',
        title: 'Risky changed line',
        line: line.lineNumber,
        message: line.risk,
        suggestion: 'Review this line carefully and add a test for the changed behavior.',
        evidence: line.content.trim(),
      } satisfies ErrorFinding,
    ]
  })
}

function dedupeFindings(findings: ErrorFinding[]) {
  const seen = new Set<string>()

  return findings.filter((finding) => {
    const key = `${finding.title}-${finding.line}-${finding.evidence ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildReviewSummary(diffResult: DiffResult, findings: ErrorFinding[]): ReviewSummary {
  const errorCount = findings.filter((finding) => finding.severity === 'error').length
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length
  const riskLevel = errorCount > 0 || diffResult.stats.risky > 2 ? 'High' : warningCount > 0 || diffResult.stats.modified > 4 ? 'Medium' : 'Low'
  const changes = [
    `${diffResult.stats.added} added line${diffResult.stats.added === 1 ? '' : 's'}`,
    `${diffResult.stats.removed} removed line${diffResult.stats.removed === 1 ? '' : 's'}`,
    `${diffResult.stats.modified} modified line${diffResult.stats.modified === 1 ? '' : 's'}`,
    `${diffResult.stats.unchanged} unchanged line${diffResult.stats.unchanged === 1 ? '' : 's'}`,
  ]
  const risks = findings
    .filter((finding) => finding.severity !== 'info')
    .slice(0, 6)
    .map((finding) => `${finding.title}${finding.line ? ` on line ${finding.line}` : ''}`)

  if (risks.length === 0) {
    risks.push('No obvious breaking risks were detected by the heuristic analyzer.')
  }

  const improvements = [
    diffResult.stats.modified > 0
      ? 'Add focused tests around the modified branches before merging.'
      : 'Keep the change small and verify expected behavior with a smoke test.',
    errorCount > 0
      ? 'Fix syntax and unresolved symbol errors before reviewing style improvements.'
      : 'Review naming consistency and keep related edits grouped together.',
    diffResult.stats.risky > 0
      ? 'Document why risky logic changes are intentional in the review notes.'
      : 'Use clear comments only where behavior is not self-explanatory.',
  ]

  return {
    summary: `Compared ${diffResult.stats.totalOriginal} original lines with ${diffResult.stats.totalNew} new lines. Risk level: ${riskLevel}.`,
    riskLevel,
    changes,
    risks,
    improvements,
  }
}

function applySuggestedFixes(newCode: string, findings: ErrorFinding[]): SuggestedFix {
  const lines = newCode.replace(/\r\n/g, '\n').split('\n')
  const changedLines = new Set<number>()
  const appendedText: string[] = []
  const insertions: Array<{ line: number; text: string }> = []

  findings.forEach((finding) => {
    finding.fixes?.forEach((fix) => {
      if (fix.type === 'append-semicolon') {
        const index = fix.line - 1
        const line = lines[index]

        if (line !== undefined && !line.trimEnd().endsWith(';')) {
          lines[index] = `${line};`
          changedLines.add(fix.line)
        }
      }

      if (fix.type === 'append-text') {
        appendedText.push(fix.text)
        changedLines.add(lines.length + appendedText.length)
      }

      if (fix.type === 'insert-line') {
        insertions.push(fix)
      }

      if (fix.type === 'replace-identifier') {
        const pattern = new RegExp(`\\b${escapeRegExp(fix.from)}\\b`, 'g')

        if (fix.line) {
          const index = fix.line - 1

          if (lines[index]?.match(pattern)) {
            lines[index] = lines[index].replace(pattern, fix.to)
            changedLines.add(fix.line)
          }
        } else {
          lines.forEach((line, index) => {
            if (pattern.test(line)) {
              lines[index] = line.replace(pattern, fix.to)
              changedLines.add(index + 1)
            }
          })
        }
      }
    })
  })

  const uniqueInsertions = insertions.filter(
    (insertion, index, allInsertions) =>
      allInsertions.findIndex((candidate) => candidate.text === insertion.text) === index,
  )

  if (uniqueInsertions.length > 0) {
    const earliestLine = Math.min(...uniqueInsertions.map((insertion) => insertion.line))
    const index = Math.max(0, Math.min(earliestLine - 1, lines.length))

    lines.splice(index, 0, ...uniqueInsertions.map((insertion) => insertion.text))
    uniqueInsertions.forEach((_, offset) => changedLines.add(index + offset + 1))
  }

  const code = `${lines.join('\n')}${appendedText.join('')}`
  const changedLineList = Array.from(changedLines).sort((left, right) => left - right)
  const fixedErrorCount = findings.filter((finding) => finding.severity === 'error' && finding.fixes?.length).length

  return {
    code,
    changedLines: changedLineList,
    confidence: changedLineList.length === 0 ? 'Low' : fixedErrorCount > 0 ? 'Medium' : 'High',
    explanation:
      changedLineList.length === 0
        ? 'No safe automatic code rewrite was found. The suggested output preserves the new code so it can still be copied.'
        : `Applied safe mechanical fixes on ${changedLineList.length} line${changedLineList.length === 1 ? '' : 's'}, such as closing delimiters, semicolons, or consistent renamed references.`,
  }
}

export function analyzeCode(originalCode: string, newCode: string, diffResult: DiffResult) {
  const changedLines = new Set(
    diffResult.newLines
      .filter((line) => line.lineNumber && (line.type === 'added' || line.type === 'modified' || line.risk))
      .map((line) => line.lineNumber as number),
  )
  const findings = dedupeFindings([
    ...scanDelimiterFindings(newCode),
    ...findSemicolonFindings(newCode, changedLines),
    ...detectSymbolFindings(originalCode, newCode),
    ...detectRiskyFindings(diffResult),
  ]).slice(0, 24)

  return {
    findings,
    review: buildReviewSummary(diffResult, findings),
    suggestedFix: applySuggestedFixes(newCode, findings),
  }
}
