import * as fs from 'node:fs'
import * as path from 'node:path'

// --- Types ---

export type PipelinePhase = 'static-analysis' | 'file-analysis' | 'module-synthesis' | 'done'

export interface CompletedItem {
  path: string
  analyzedAt: string
  tokensUsed: number
  durationMs: number
}

export interface FailedItem {
  path: string
  failedAt: string
  error: string
  lastError: string
  attempts: number
}

export interface ProgressStats {
  totalFiles: number
  completedFiles: number
  failedFiles: number
  pendingFiles: number
}

export interface ProgressState {
  projectName: string
  scanRoot: string
  phase: PipelinePhase
  startedAt: string
  lastUpdatedAt: string
  currentItem: string | null
  completed: CompletedItem[]
  failed: FailedItem[]
  pending: string[]
  stats: ProgressStats
  batchIds: string[]
}

// --- Stats computation (always derived from arrays) ---

export function computeStats(state: Pick<ProgressState, 'completed' | 'failed' | 'pending'>): ProgressStats {
  return {
    totalFiles: state.completed.length + state.failed.length + state.pending.length,
    completedFiles: state.completed.length,
    failedFiles: state.failed.length,
    pendingFiles: state.pending.length,
  }
}

// --- Factory ---

export function createFreshProgress(projectName: string, scanRoot: string): ProgressState {
  const now = new Date().toISOString()
  const state: ProgressState = {
    projectName,
    scanRoot,
    phase: 'static-analysis',
    startedAt: now,
    lastUpdatedAt: now,
    currentItem: null,
    completed: [],
    failed: [],
    pending: [],
    stats: { totalFiles: 0, completedFiles: 0, failedFiles: 0, pendingFiles: 0 },
    batchIds: [],
  }
  return state
}

// --- Mutations ---

export function markCompleted(
  state: ProgressState,
  filePath: string,
  tokensUsed: number,
  durationMs: number,
): ProgressState {
  const now = new Date().toISOString()
  return {
    ...state,
    lastUpdatedAt: now,
    currentItem: null,
    pending: state.pending.filter((p) => p !== filePath),
    completed: [
      ...state.completed,
      { path: filePath, analyzedAt: now, tokensUsed, durationMs },
    ],
    failed: state.failed,
    stats: computeStats({
      completed: [...state.completed, { path: filePath, analyzedAt: now, tokensUsed, durationMs }],
      failed: state.failed,
      pending: state.pending.filter((p) => p !== filePath),
    }),
  }
}

export function markFailed(
  state: ProgressState,
  filePath: string,
  error: string,
): ProgressState {
  const now = new Date().toISOString()
  const existing = state.failed.find((f) => f.path === filePath)

  const updatedFailed = existing
    ? state.failed.map((f) =>
        f.path === filePath
          ? { ...f, failedAt: now, lastError: error, attempts: f.attempts + 1 }
          : f
      )
    : [
        ...state.failed,
        { path: filePath, failedAt: now, error, lastError: error, attempts: 1 },
      ]

  const updatedPending = state.pending.filter((p) => p !== filePath)

  return {
    ...state,
    lastUpdatedAt: now,
    currentItem: null,
    pending: updatedPending,
    failed: updatedFailed,
    stats: computeStats({
      completed: state.completed,
      failed: updatedFailed,
      pending: updatedPending,
    }),
  }
}

// --- Persistence ---

const PROGRESS_FILENAME = 'progress.json'
const PROGRESS_TMP_FILENAME = 'progress.tmp.json'

export function saveProgress(dir: string, state: ProgressState): void {
  // Recompute stats from arrays to guarantee consistency
  const stateWithStats: ProgressState = {
    ...state,
    stats: computeStats(state),
  }

  const filePath = path.join(dir, PROGRESS_FILENAME)
  const tmpPath = path.join(dir, PROGRESS_TMP_FILENAME)

  // Atomic write: tmp file → rename
  fs.writeFileSync(tmpPath, JSON.stringify(stateWithStats, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

export function loadProgress(dir: string): ProgressState | null {
  const filePath = path.join(dir, PROGRESS_FILENAME)

  if (!fs.existsSync(filePath)) {
    return null
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const parsed: unknown = JSON.parse(raw)

  // Basic shape validation — not full Zod because this is internal state, not LLM output
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('projectName' in parsed) ||
    !('phase' in parsed) ||
    !('completed' in parsed) ||
    !('pending' in parsed)
  ) {
    throw new Error(
      `Corrupted progress.json at ${filePath}: missing required fields. ` +
      `Delete the file and re-run with --force to start fresh.`
    )
  }

  return parsed as ProgressState
}
