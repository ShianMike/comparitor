export type DiffLineType =
  | 'unchanged'
  | 'added'
  | 'removed'
  | 'modified'
  | 'empty'
  | 'risky'

export type RiskLevel = 'Low' | 'Medium' | 'High'

export type FindingSeverity = 'error' | 'warning' | 'info'

export type FindingCategory =
  | 'syntax'
  | 'missing-bracket'
  | 'semicolons'
  | 'variable-rename'
  | 'deleted-symbol'
  | 'logic'
  | 'security'
  | 'maintainability'

export type CodeFixAction =
  | { type: 'append-semicolon'; line: number }
  | { type: 'append-text'; text: string }
  | { type: 'insert-line'; line: number; text: string }
  | { type: 'replace-identifier'; from: string; to: string; line?: number }

export interface CodeLine {
  id: string
  lineNumber: number | null
  counterpartLine: number | null
  content: string
  type: DiffLineType
  risk?: string
}

export interface DiffStats {
  added: number
  removed: number
  modified: number
  unchanged: number
  risky: number
  totalOriginal: number
  totalNew: number
}

export interface DiffResult {
  originalLines: CodeLine[]
  newLines: CodeLine[]
  stats: DiffStats
  riskyLines: number[]
}

export interface ErrorFinding {
  id: string
  severity: FindingSeverity
  category: FindingCategory
  title: string
  line: number | null
  message: string
  suggestion: string
  evidence?: string
  fixes?: CodeFixAction[]
}

export interface ReviewSummary {
  summary: string
  riskLevel: RiskLevel
  changes: string[]
  risks: string[]
  improvements: string[]
}

export interface SuggestedFix {
  code: string
  explanation: string
  changedLines: number[]
  confidence: 'Low' | 'Medium' | 'High'
}
