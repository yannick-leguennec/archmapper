import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import { runFilePhase, processOneFile, buildFilePromptContext } from '../../../src/pipeline/file-phase'
import { createFreshProgress } from '../../../src/pipeline/progress'
import { createRootLogger } from '../../../src/logger'

import type Anthropic from '@anthropic-ai/sdk'
import type { Architecture } from '../../../src/types/schema'
import type { DependencyGraph } from '../../../src/pipeline/static-analysis'
import type { FilePhaseParams, ProcessOneFileParams } from '../../../src/pipeline/file-phase'

// --- Test fixtures ---

let tempDir: string
let scanRoot: string
let outputDir: string

const silentLogger = createRootLogger('test', 'ERROR')

function createEmptyArchitecture(): Architecture {
  return {
    schemaVersion: '1.0',
    projectName: 'TestProject',
    fileModel: 'claude-sonnet-4-6',
    synthesisModel: 'claude-opus-4-6',
    generatedAt: new Date().toISOString(),
    files: [],
    modules: [],
    summary: 'Test project.',
    designPatterns: [],
  }
}

function createMockClient(toolInput: unknown): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        stop_reason: 'tool_use',
        content: [{
          type: 'tool_use',
          id: 'toolu_test',
          name: 'record_file_analysis',
          input: toolInput,
        }],
        usage: {
          input_tokens: 1500,
          output_tokens: 600,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 0,
        },
      }),
    },
  } as unknown as Anthropic
}

function validFileAnalysis(filePath: string) {
  return {
    path: filePath,
    purpose: 'A test source file with utility functions.',
    exports: ['helper'],
    imports: [],
    keyAbstractions: ['Helper'],
    patterns: ['factory'],
  }
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archmapper-filephase-test-'))
  scanRoot = path.join(tempDir, 'project')
  outputDir = path.join(tempDir, 'output')

  // Create source files
  const files: Record<string, string> = {
    'src/a.ts': 'export function a() { return 1 }',
    'src/b.ts': 'export function b() { return 2 }',
    'src/c.ts': 'export function c() { return 3 }',
  }

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(scanRoot, filePath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, content, 'utf-8')
  }

  fs.mkdirSync(outputDir, { recursive: true })
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

// --- buildFilePromptContext ---

describe('buildFilePromptContext', () => {
  it('returns empty string when depGraph is null', () => {
    const result = buildFilePromptContext('src/a.ts', null)

    expect(result).toBe('')
  })

  it('returns empty string when file has no dependencies', () => {
    const depGraph: DependencyGraph = {
      modules: [{ source: 'src/a.ts', dependencies: [] }],
    }

    const result = buildFilePromptContext('src/a.ts', depGraph)

    expect(result).toBe('')
  })

  it('returns formatted dependency edges', () => {
    const depGraph: DependencyGraph = {
      modules: [{
        source: 'src/a.ts',
        dependencies: [
          { resolved: './config' },
          { resolved: './logger' },
        ],
      }],
    }

    const result = buildFilePromptContext('src/a.ts', depGraph)

    expect(result).toContain('→ ./config')
    expect(result).toContain('→ ./logger')
  })

  it('returns empty string when file is not in the graph', () => {
    const depGraph: DependencyGraph = {
      modules: [{ source: 'src/other.ts', dependencies: [{ resolved: './x' }] }],
    }

    const result = buildFilePromptContext('src/a.ts', depGraph)

    expect(result).toBe('')
  })
})

// --- processOneFile ---

describe('processOneFile', () => {
  function makeParams(overrides?: Partial<ProcessOneFileParams>): ProcessOneFileParams {
    const progress = createFreshProgress('Test', scanRoot)
    progress.pending = ['src/a.ts']

    return {
      client: createMockClient(validFileAnalysis('src/a.ts')),
      systemPrompt: 'You are an expert software architect.',
      model: 'claude-sonnet-4-6',
      maxTokens: 4096,
      scanRoot,
      outputDir,
      progress,
      architecture: createEmptyArchitecture(),
      depGraph: null,
      logger: silentLogger,
      filePath: 'src/a.ts',
      ...overrides,
    }
  }

  it('analyzes a file and adds it to architecture.files', async () => {
    const params = makeParams()

    const result = await processOneFile(params)

    expect(result.architecture.files).toHaveLength(1)
    expect(result.architecture.files[0]!.path).toBe('src/a.ts')
    expect(result.architecture.files[0]!.purpose).toBe('A test source file with utility functions.')
  })

  it('marks the file as completed in progress', async () => {
    const params = makeParams()

    const result = await processOneFile(params)

    expect(result.progress.completed).toHaveLength(1)
    expect(result.progress.completed[0]!.path).toBe('src/a.ts')
    expect(result.progress.pending).toEqual([])
  })

  it('records tokensUsed on the completed item', async () => {
    const params = makeParams()

    const result = await processOneFile(params)

    // 1500 input + 600 output = 2100
    expect(result.progress.completed[0]!.tokensUsed).toBe(2100)
  })

  it('enriches FileAnalysis with tokensUsed from API response', async () => {
    const params = makeParams()

    const result = await processOneFile(params)

    expect(result.architecture.files[0]!.tokensUsed).toBe(2100)
  })

  it('returns usage info from the API call', async () => {
    const params = makeParams()

    const result = await processOneFile(params)

    expect(result.usage).not.toBeNull()
    expect(result.usage!.inputTokens).toBe(1500)
    expect(result.usage!.outputTokens).toBe(600)
    expect(result.usage!.costUsd).toBeGreaterThan(0)
  })

  it('marks file as failed when Zod validation fails', async () => {
    // LLM returns invalid JSON (missing required 'purpose' field)
    const badClient = createMockClient({ path: 'src/a.ts', exports: [] })
    const params = makeParams({ client: badClient })

    const result = await processOneFile(params)

    expect(result.progress.failed).toHaveLength(1)
    expect(result.progress.failed[0]!.path).toBe('src/a.ts')
    expect(result.progress.failed[0]!.error).toContain('ZodParseError')
    expect(result.architecture.files).toHaveLength(0)
  })

  it('still returns usage when Zod validation fails', async () => {
    const badClient = createMockClient({ path: 'src/a.ts' })
    const params = makeParams({ client: badClient })

    const result = await processOneFile(params)

    // Usage is tracked even on Zod failures (we paid for the call)
    expect(result.usage).not.toBeNull()
    expect(result.usage!.inputTokens).toBe(1500)
  })

  it('marks file as failed when LLM throws', async () => {
    const errorClient = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error('API rate limited')),
      },
    } as unknown as Anthropic

    const params = makeParams({ client: errorClient })

    const result = await processOneFile(params)

    expect(result.progress.failed).toHaveLength(1)
    expect(result.progress.failed[0]!.error).toContain('LlmError')
    expect(result.progress.failed[0]!.error).toContain('API rate limited')
    expect(result.usage).toBeNull()
  })

  it('marks file as failed when file cannot be read from disk', async () => {
    const params = makeParams({ filePath: 'src/nonexistent.ts' })
    params.progress.pending = ['src/nonexistent.ts']

    const result = await processOneFile(params)

    expect(result.progress.failed).toHaveLength(1)
    expect(result.progress.failed[0]!.error).toContain('FileReadError')
    expect(result.usage).toBeNull()
  })

  it('does not mutate the original architecture object', async () => {
    const params = makeParams()
    const originalFilesCount = params.architecture.files.length

    await processOneFile(params)

    expect(params.architecture.files.length).toBe(originalFilesCount)
  })

  it('does not mutate the original progress object', async () => {
    const params = makeParams()
    const originalPending = [...params.progress.pending]

    await processOneFile(params)

    expect(params.progress.pending).toEqual(originalPending)
  })
})

// --- runFilePhase ---

describe('runFilePhase', () => {
  function makePhaseParams(pendingFiles: string[], overrides?: Partial<FilePhaseParams>): FilePhaseParams {
    const progress = createFreshProgress('Test', scanRoot)
    progress.pending = pendingFiles
    progress.phase = 'file-analysis'

    // Create a fresh output dir per test to avoid interference
    const testOutputDir = path.join(tempDir, `output-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(testOutputDir, { recursive: true })

    // Create a mock client that returns valid analysis for any file
    const client = {
      messages: {
        create: vi.fn().mockImplementation(async (params: { messages: Array<{ content: string }> }) => {
          // Extract file path from user message
          const userMsg = params.messages[0]!.content
          const pathMatch = userMsg.match(/File path: (.+)\n/)
          const filePath = pathMatch ? pathMatch[1] : 'unknown'

          return {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            stop_reason: 'tool_use',
            content: [{
              type: 'tool_use',
              id: 'toolu_test',
              name: 'record_file_analysis',
              input: validFileAnalysis(filePath!),
            }],
            usage: {
              input_tokens: 1000,
              output_tokens: 400,
              cache_read_input_tokens: 800,
              cache_creation_input_tokens: 0,
            },
          }
        }),
      },
    } as unknown as Anthropic

    return {
      client,
      systemPrompt: 'You are an expert software architect.',
      model: 'claude-sonnet-4-6',
      maxTokens: 4096,
      scanRoot,
      outputDir: testOutputDir,
      progress,
      architecture: createEmptyArchitecture(),
      depGraph: null,
      logger: silentLogger,
      ...overrides,
    }
  }

  it('processes all pending files', async () => {
    const params = makePhaseParams(['src/a.ts', 'src/b.ts', 'src/c.ts'])

    const result = await runFilePhase(params)

    expect(result.architecture.files).toHaveLength(3)
    expect(result.progress.completed).toHaveLength(3)
    expect(result.progress.pending).toEqual([])
  })

  it('skips files already in completed (resume)', async () => {
    const params = makePhaseParams(['src/b.ts', 'src/c.ts'])
    // Simulate src/a.ts already completed in a previous run
    params.progress.completed = [{
      path: 'src/a.ts',
      analyzedAt: new Date().toISOString(),
      tokensUsed: 1000,
      durationMs: 2000,
    }]
    params.architecture.files = [{
      path: 'src/a.ts',
      purpose: 'Previously analyzed.',
      exports: [],
      imports: [],
      keyAbstractions: [],
      patterns: [],
    }]

    const result = await runFilePhase(params)

    // Only 2 new files processed, but architecture has all 3
    expect(result.progress.completed).toHaveLength(3)
    expect(result.architecture.files).toHaveLength(3)
    // The mock client should only have been called twice (not for src/a.ts)
    expect(vi.mocked(params.client.messages.create)).toHaveBeenCalledTimes(2)
  })

  it('continues after one file fails', async () => {
    // Create a client that fails on src/b.ts but succeeds on others
    const client = {
      messages: {
        create: vi.fn().mockImplementation(async (createParams: { messages: Array<{ content: string }> }) => {
          const userMsg = createParams.messages[0]!.content
          if (userMsg.includes('src/b.ts')) {
            throw new Error('Simulated API error for b.ts')
          }
          const pathMatch = userMsg.match(/File path: (.+)\n/)
          return {
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            stop_reason: 'tool_use',
            content: [{
              type: 'tool_use',
              id: 'toolu_test',
              name: 'record_file_analysis',
              input: validFileAnalysis(pathMatch![1]!),
            }],
            usage: { input_tokens: 1000, output_tokens: 400, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          }
        }),
      },
    } as unknown as Anthropic

    const params = makePhaseParams(['src/a.ts', 'src/b.ts', 'src/c.ts'], { client })

    const result = await runFilePhase(params)

    // 2 succeeded, 1 failed — pipeline did NOT abort
    expect(result.progress.completed).toHaveLength(2)
    expect(result.progress.failed).toHaveLength(1)
    expect(result.progress.failed[0]!.path).toBe('src/b.ts')
    expect(result.architecture.files).toHaveLength(2)
  })

  it('saves progress after each file (checkpoint)', async () => {
    const params = makePhaseParams(['src/a.ts', 'src/b.ts'])

    await runFilePhase(params)

    // progress.json should exist and be valid
    const progressPath = path.join(params.outputDir, 'progress.json')
    expect(fs.existsSync(progressPath)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(progressPath, 'utf-8'))
    expect(saved.completed).toHaveLength(2)
  })

  it('saves architecture.json after each file', async () => {
    const params = makePhaseParams(['src/a.ts', 'src/b.ts'])

    await runFilePhase(params)

    const archPath = path.join(params.outputDir, 'architecture.json')
    expect(fs.existsSync(archPath)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(archPath, 'utf-8'))
    expect(saved.files).toHaveLength(2)
  })

  it('accumulates total usage across all files', async () => {
    const params = makePhaseParams(['src/a.ts', 'src/b.ts', 'src/c.ts'])

    const result = await runFilePhase(params)

    // 3 files × (1000 input + 400 output) = 4200 total
    expect(result.totalUsage.callCount).toBe(3)
    expect(result.totalUsage.inputTokens).toBe(3000)
    expect(result.totalUsage.outputTokens).toBe(1200)
    expect(result.totalUsage.costUsd).toBeGreaterThan(0)
  })

  it('handles empty pending list gracefully', async () => {
    const params = makePhaseParams([])

    const result = await runFilePhase(params)

    expect(result.architecture.files).toHaveLength(0)
    expect(result.totalUsage.callCount).toBe(0)
    expect(result.totalUsage.costUsd).toBe(0)
  })
})
