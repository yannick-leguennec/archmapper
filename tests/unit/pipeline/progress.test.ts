import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  createFreshProgress,
  markCompleted,
  markFailed,
  saveProgress,
  loadProgress,
  computeStats,
} from '../../../src/pipeline/progress'

// --- Temp directory for filesystem tests ---

let tempDir: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archmapper-progress-test-'))
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

// --- computeStats ---

describe('computeStats', () => {
  it('computes stats from arrays correctly', () => {
    const stats = computeStats({
      completed: [
        { path: 'a.ts', analyzedAt: '', tokensUsed: 100, durationMs: 500 },
        { path: 'b.ts', analyzedAt: '', tokensUsed: 200, durationMs: 600 },
      ],
      failed: [
        { path: 'c.ts', failedAt: '', error: 'err', lastError: 'err', attempts: 1 },
      ],
      pending: ['d.ts', 'e.ts', 'f.ts'],
    })

    expect(stats.totalFiles).toBe(6)
    expect(stats.completedFiles).toBe(2)
    expect(stats.failedFiles).toBe(1)
    expect(stats.pendingFiles).toBe(3)
  })

  it('returns all zeros for empty arrays', () => {
    const stats = computeStats({ completed: [], failed: [], pending: [] })

    expect(stats.totalFiles).toBe(0)
    expect(stats.completedFiles).toBe(0)
    expect(stats.failedFiles).toBe(0)
    expect(stats.pendingFiles).toBe(0)
  })
})

// --- createFreshProgress ---

describe('createFreshProgress', () => {
  it('creates a fresh state with correct project metadata', () => {
    const state = createFreshProgress('TestProject', 'project/src')

    expect(state.projectName).toBe('TestProject')
    expect(state.scanRoot).toBe('project/src')
    expect(state.phase).toBe('static-analysis')
    expect(state.currentItem).toBeNull()
  })

  it('starts with empty arrays', () => {
    const state = createFreshProgress('TestProject', 'project')

    expect(state.completed).toEqual([])
    expect(state.failed).toEqual([])
    expect(state.pending).toEqual([])
    expect(state.batchIds).toEqual([])
  })

  it('sets timestamps as ISO 8601 strings', () => {
    const before = new Date().toISOString()
    const state = createFreshProgress('TestProject', 'project')
    const after = new Date().toISOString()

    expect(state.startedAt >= before).toBe(true)
    expect(state.startedAt <= after).toBe(true)
    expect(state.lastUpdatedAt).toBe(state.startedAt)
  })

  it('initializes stats to all zeros', () => {
    const state = createFreshProgress('TestProject', 'project')

    expect(state.stats).toEqual({
      totalFiles: 0, completedFiles: 0, failedFiles: 0, pendingFiles: 0,
    })
  })
})

// --- markCompleted ---

describe('markCompleted', () => {
  it('moves an item from pending to completed', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts', 'src/b.ts', 'src/c.ts']

    const updated = markCompleted(initial, 'src/b.ts', 1500, 2000)

    expect(updated.pending).toEqual(['src/a.ts', 'src/c.ts'])
    expect(updated.completed).toHaveLength(1)
    expect(updated.completed[0]!.path).toBe('src/b.ts')
    expect(updated.completed[0]!.tokensUsed).toBe(1500)
    expect(updated.completed[0]!.durationMs).toBe(2000)
  })

  it('updates stats after completion', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts', 'src/b.ts']

    const updated = markCompleted(initial, 'src/a.ts', 100, 500)

    expect(updated.stats.completedFiles).toBe(1)
    expect(updated.stats.pendingFiles).toBe(1)
    expect(updated.stats.totalFiles).toBe(2)
  })

  it('clears currentItem', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts']
    initial.currentItem = 'src/a.ts'

    const updated = markCompleted(initial, 'src/a.ts', 100, 500)

    expect(updated.currentItem).toBeNull()
  })

  it('updates lastUpdatedAt timestamp', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts']
    const originalTimestamp = initial.lastUpdatedAt

    const updated = markCompleted(initial, 'src/a.ts', 100, 500)

    expect(updated.lastUpdatedAt >= originalTimestamp).toBe(true)
  })

  it('does not mutate the original state', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts', 'src/b.ts']
    const pendingBefore = [...initial.pending]

    markCompleted(initial, 'src/a.ts', 100, 500)

    expect(initial.pending).toEqual(pendingBefore)
    expect(initial.completed).toEqual([])
  })
})

// --- markFailed ---

describe('markFailed', () => {
  it('moves an item from pending to failed', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts', 'src/b.ts']

    const updated = markFailed(initial, 'src/a.ts', 'Zod parse failed')

    expect(updated.pending).toEqual(['src/b.ts'])
    expect(updated.failed).toHaveLength(1)
    expect(updated.failed[0]!.path).toBe('src/a.ts')
    expect(updated.failed[0]!.error).toBe('Zod parse failed')
    expect(updated.failed[0]!.lastError).toBe('Zod parse failed')
    expect(updated.failed[0]!.attempts).toBe(1)
  })

  it('increments attempts on repeated failure of same file', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts']

    const after1 = markFailed(initial, 'src/a.ts', 'First error')
    // Simulate retry: put back in pending
    const retryState = { ...after1, pending: ['src/a.ts'] }
    const after2 = markFailed(retryState, 'src/a.ts', 'Second error')

    expect(after2.failed).toHaveLength(1)
    expect(after2.failed[0]!.attempts).toBe(2)
    expect(after2.failed[0]!.error).toBe('First error')
    expect(after2.failed[0]!.lastError).toBe('Second error')
  })

  it('updates stats after failure', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts', 'src/b.ts']

    const updated = markFailed(initial, 'src/a.ts', 'error')

    expect(updated.stats.failedFiles).toBe(1)
    expect(updated.stats.pendingFiles).toBe(1)
    expect(updated.stats.totalFiles).toBe(2)
  })

  it('does not mutate the original state', () => {
    const initial = createFreshProgress('Test', 'project')
    initial.pending = ['src/a.ts']
    const pendingBefore = [...initial.pending]

    markFailed(initial, 'src/a.ts', 'error')

    expect(initial.pending).toEqual(pendingBefore)
    expect(initial.failed).toEqual([])
  })
})

// --- saveProgress + loadProgress ---

describe('saveProgress and loadProgress', () => {
  it('round-trips correctly: save then load returns the same state', () => {
    const state = createFreshProgress('RoundTrip', 'project')
    state.pending = ['src/a.ts', 'src/b.ts']
    state.phase = 'file-analysis'
    state.currentItem = 'src/a.ts'

    const dir = path.join(tempDir, 'roundtrip')
    fs.mkdirSync(dir, { recursive: true })

    saveProgress(dir, state)
    const loaded = loadProgress(dir)

    expect(loaded).not.toBeNull()
    expect(loaded!.projectName).toBe('RoundTrip')
    expect(loaded!.phase).toBe('file-analysis')
    expect(loaded!.pending).toEqual(['src/a.ts', 'src/b.ts'])
    expect(loaded!.currentItem).toBe('src/a.ts')
  })

  it('returns null when no progress file exists', () => {
    const dir = path.join(tempDir, 'nonexistent')
    fs.mkdirSync(dir, { recursive: true })

    const result = loadProgress(dir)

    expect(result).toBeNull()
  })

  it('writes valid JSON to disk', () => {
    const state = createFreshProgress('JsonCheck', 'project')
    const dir = path.join(tempDir, 'jsoncheck')
    fs.mkdirSync(dir, { recursive: true })

    saveProgress(dir, state)

    const raw = fs.readFileSync(path.join(dir, 'progress.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.projectName).toBe('JsonCheck')
  })

  it('uses atomic write — no .tmp file left behind', () => {
    const state = createFreshProgress('Atomic', 'project')
    const dir = path.join(tempDir, 'atomic')
    fs.mkdirSync(dir, { recursive: true })

    saveProgress(dir, state)

    const files = fs.readdirSync(dir)
    expect(files).toContain('progress.json')
    expect(files).not.toContain('progress.tmp.json')
  })

  it('recomputes stats on save to guarantee consistency', () => {
    const state = createFreshProgress('StatsCheck', 'project')
    state.pending = ['a.ts', 'b.ts', 'c.ts']
    // Deliberately set wrong stats
    state.stats = { totalFiles: 999, completedFiles: 999, failedFiles: 999, pendingFiles: 999 }

    const dir = path.join(tempDir, 'statscheck')
    fs.mkdirSync(dir, { recursive: true })

    saveProgress(dir, state)
    const loaded = loadProgress(dir)

    // Stats should have been recomputed from arrays, not saved as-is
    expect(loaded!.stats.totalFiles).toBe(3)
    expect(loaded!.stats.pendingFiles).toBe(3)
    expect(loaded!.stats.completedFiles).toBe(0)
    expect(loaded!.stats.failedFiles).toBe(0)
  })

  it('throws on corrupted progress file with helpful message', () => {
    const dir = path.join(tempDir, 'corrupted')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'progress.json'), '{"unrelated": true}', 'utf-8')

    expect(() => loadProgress(dir)).toThrow('Corrupted progress.json')
    expect(() => loadProgress(dir)).toThrow('--force')
  })

  it('throws on invalid JSON with a parse error', () => {
    const dir = path.join(tempDir, 'badjson')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'progress.json'), '{not valid json!!!', 'utf-8')

    expect(() => loadProgress(dir)).toThrow()
  })

  it('preserves completed item metadata through round-trip', () => {
    const state = createFreshProgress('Metadata', 'project')
    state.pending = ['src/a.ts']
    const withCompleted = markCompleted(state, 'src/a.ts', 2048, 4500)

    const dir = path.join(tempDir, 'metadata')
    fs.mkdirSync(dir, { recursive: true })

    saveProgress(dir, withCompleted)
    const loaded = loadProgress(dir)

    expect(loaded!.completed).toHaveLength(1)
    expect(loaded!.completed[0]!.path).toBe('src/a.ts')
    expect(loaded!.completed[0]!.tokensUsed).toBe(2048)
    expect(loaded!.completed[0]!.durationMs).toBe(4500)
    expect(loaded!.completed[0]!.analyzedAt).toBeDefined()
  })

  it('preserves failed item metadata through round-trip', () => {
    const state = createFreshProgress('FailMeta', 'project')
    state.pending = ['src/bad.ts']
    const withFailed = markFailed(state, 'src/bad.ts', 'Context window exceeded')

    const dir = path.join(tempDir, 'failmeta')
    fs.mkdirSync(dir, { recursive: true })

    saveProgress(dir, withFailed)
    const loaded = loadProgress(dir)

    expect(loaded!.failed).toHaveLength(1)
    expect(loaded!.failed[0]!.path).toBe('src/bad.ts')
    expect(loaded!.failed[0]!.error).toBe('Context window exceeded')
    expect(loaded!.failed[0]!.attempts).toBe(1)
  })
})

// --- Array vs Set guarantee ---

describe('JSON serialization safety', () => {
  it('uses arrays not Sets — completed serializes correctly', () => {
    const state = createFreshProgress('SetCheck', 'project')
    state.pending = ['a.ts']
    const updated = markCompleted(state, 'a.ts', 100, 200)

    const json = JSON.stringify(updated)
    const parsed = JSON.parse(json)

    expect(Array.isArray(parsed.completed)).toBe(true)
    expect(parsed.completed).toHaveLength(1)
  })

  it('uses arrays not Sets — pending serializes correctly', () => {
    const state = createFreshProgress('SetCheck2', 'project')
    state.pending = ['a.ts', 'b.ts']

    const json = JSON.stringify(state)
    const parsed = JSON.parse(json)

    expect(Array.isArray(parsed.pending)).toBe(true)
    expect(parsed.pending).toHaveLength(2)
  })
})
