import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import { computeWaves, gatherChildContext, runModuleSynthesis, processOneModule } from '../../../src/pipeline/folder-waves'
import { createFreshProgress } from '../../../src/pipeline/progress'
import { createRootLogger } from '../../../src/logger'

import type Anthropic from '@anthropic-ai/sdk'
import type { Architecture } from '../../../src/types/schema'
import type { TreeNode } from '../../../src/pipeline/static-analysis'
import type { ProcessOneModuleParams } from '../../../src/pipeline/folder-waves'

// --- Helpers ---

let tempDir: string
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

function validModuleAnalysis(folderPath: string) {
  return {
    path: folderPath,
    purpose: `Module for ${folderPath}.`,
    children: [],
    publicApi: ['someFn'],
    patterns: ['shared-library'],
    crossCuttingConcerns: [],
  }
}

function createMockClient(folderPath: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-4-6',
        stop_reason: 'tool_use',
        content: [{
          type: 'tool_use',
          id: 'toolu_test',
          name: 'record_module_analysis',
          input: validModuleAnalysis(folderPath),
        }],
        usage: {
          input_tokens: 3000,
          output_tokens: 1200,
          cache_read_input_tokens: 2000,
          cache_creation_input_tokens: 0,
        },
      }),
    },
  } as unknown as Anthropic
}

function createSmartMockClient(): Anthropic {
  return {
    messages: {
      create: vi.fn().mockImplementation(async (params: { messages: Array<{ content: string }> }) => {
        const userMsg = params.messages[0]!.content
        const pathMatch = userMsg.match(/Folder path: (.+)\n/)
        const folderPath = pathMatch ? pathMatch[1]! : 'unknown'

        return {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-opus-4-6',
          stop_reason: 'tool_use',
          content: [{
            type: 'tool_use',
            id: 'toolu_test',
            name: 'record_module_analysis',
            input: validModuleAnalysis(folderPath),
          }],
          usage: {
            input_tokens: 2000,
            output_tokens: 800,
            cache_read_input_tokens: 1500,
            cache_creation_input_tokens: 0,
          },
        }
      }),
    },
  } as unknown as Anthropic
}

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archmapper-waves-test-'))
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

// --- computeWaves ---

describe('computeWaves', () => {
  it('assigns wave 0 to leaf folders', () => {
    // src/utils/ has no subfolders → leaf
    const tree: TreeNode = {
      name: 'src', relativePath: '.', type: 'directory',
      children: [
        {
          name: 'utils', relativePath: 'utils', type: 'directory',
          children: [
            { name: 'helpers.ts', relativePath: 'utils/helpers.ts', type: 'file', extension: 'ts' },
          ],
        },
      ],
    }

    const waves = computeWaves(tree)

    // Root (.) is wave 1, utils is wave 0
    const wave0 = waves.find((w) => w.wave === 0)
    expect(wave0).toBeDefined()
    expect(wave0!.folders).toContain('utils')
  })

  it('assigns higher waves to parents', () => {
    const tree: TreeNode = {
      name: 'src', relativePath: '.', type: 'directory',
      children: [
        {
          name: 'api', relativePath: 'api', type: 'directory',
          children: [
            {
              name: 'handlers', relativePath: 'api/handlers', type: 'directory',
              children: [
                { name: 'users.ts', relativePath: 'api/handlers/users.ts', type: 'file', extension: 'ts' },
              ],
            },
            { name: 'router.ts', relativePath: 'api/router.ts', type: 'file', extension: 'ts' },
          ],
        },
      ],
    }

    const waves = computeWaves(tree)

    // handlers is wave 0, api is wave 1, root is wave 2
    expect(waves).toHaveLength(3)
    expect(waves[0]!.wave).toBe(0)
    expect(waves[0]!.folders).toContain('api/handlers')
    expect(waves[1]!.wave).toBe(1)
    expect(waves[1]!.folders).toContain('api')
    expect(waves[2]!.wave).toBe(2)
    expect(waves[2]!.folders).toContain('.')
  })

  it('handles flat structure (single wave)', () => {
    const tree: TreeNode = {
      name: 'project', relativePath: '.', type: 'directory',
      children: [
        { name: 'index.ts', relativePath: 'index.ts', type: 'file', extension: 'ts' },
        { name: 'config.ts', relativePath: 'config.ts', type: 'file', extension: 'ts' },
      ],
    }

    const waves = computeWaves(tree)

    expect(waves).toHaveLength(1)
    expect(waves[0]!.wave).toBe(0)
    expect(waves[0]!.folders).toEqual(['.'])
  })

  it('puts sibling leaves in the same wave', () => {
    const tree: TreeNode = {
      name: 'src', relativePath: '.', type: 'directory',
      children: [
        {
          name: 'utils', relativePath: 'utils', type: 'directory',
          children: [{ name: 'a.ts', relativePath: 'utils/a.ts', type: 'file', extension: 'ts' }],
        },
        {
          name: 'helpers', relativePath: 'helpers', type: 'directory',
          children: [{ name: 'b.ts', relativePath: 'helpers/b.ts', type: 'file', extension: 'ts' }],
        },
      ],
    }

    const waves = computeWaves(tree)

    const wave0 = waves.find((w) => w.wave === 0)!
    expect(wave0.folders).toContain('utils')
    expect(wave0.folders).toContain('helpers')
  })

  it('handles deep nesting (3+ levels)', () => {
    const tree: TreeNode = {
      name: 'root', relativePath: '.', type: 'directory',
      children: [{
        name: 'a', relativePath: 'a', type: 'directory',
        children: [{
          name: 'b', relativePath: 'a/b', type: 'directory',
          children: [{
            name: 'c', relativePath: 'a/b/c', type: 'directory',
            children: [
              { name: 'x.ts', relativePath: 'a/b/c/x.ts', type: 'file', extension: 'ts' },
            ],
          }],
        }],
      }],
    }

    const waves = computeWaves(tree)

    expect(waves).toHaveLength(4)
    expect(waves[0]!.folders).toContain('a/b/c')  // deepest leaf
    expect(waves[1]!.folders).toContain('a/b')
    expect(waves[2]!.folders).toContain('a')
    expect(waves[3]!.folders).toContain('.')       // root last
  })

  it('sorts folders within each wave alphabetically', () => {
    const tree: TreeNode = {
      name: 'src', relativePath: '.', type: 'directory',
      children: [
        { name: 'zebra', relativePath: 'zebra', type: 'directory', children: [{ name: 'a.ts', relativePath: 'zebra/a.ts', type: 'file', extension: 'ts' }] },
        { name: 'alpha', relativePath: 'alpha', type: 'directory', children: [{ name: 'b.ts', relativePath: 'alpha/b.ts', type: 'file', extension: 'ts' }] },
      ],
    }

    const waves = computeWaves(tree)
    const wave0 = waves.find((w) => w.wave === 0)!

    expect(wave0.folders).toEqual(['alpha', 'zebra'])
  })
})

// --- gatherChildContext ---

describe('gatherChildContext', () => {
  it('finds direct child files only (not grandchildren)', () => {
    const arch = createEmptyArchitecture()
    arch.files = [
      { path: 'src/config.ts', purpose: 'Config loader.', exports: ['config'], imports: [], keyAbstractions: [], patterns: [] },
      { path: 'src/utils/helpers.ts', purpose: 'Helpers.', exports: ['help'], imports: [], keyAbstractions: [], patterns: [] },
    ]

    const context = gatherChildContext('src', arch)

    expect(context).toContain('src/config.ts')
    expect(context).not.toContain('src/utils/helpers.ts')
  })

  it('includes child module summaries', () => {
    const arch = createEmptyArchitecture()
    arch.modules = [
      { path: 'src/utils', purpose: 'Utility module.', children: [], publicApi: ['help'], patterns: [], crossCuttingConcerns: ['logging'] },
    ]

    const context = gatherChildContext('src', arch)

    expect(context).toContain('src/utils')
    expect(context).toContain('Utility module.')
    expect(context).toContain('help')
    expect(context).toContain('logging')
  })

  it('returns empty string when folder has no analyzed children', () => {
    const arch = createEmptyArchitecture()

    const context = gatherChildContext('src/empty', arch)

    expect(context).toBe('')
  })

  it('handles root folder (.) correctly', () => {
    const arch = createEmptyArchitecture()
    arch.files = [
      { path: 'index.ts', purpose: 'Entry point.', exports: ['main'], imports: [], keyAbstractions: [], patterns: [] },
      { path: 'src/deep.ts', purpose: 'Deep file.', exports: [], imports: [], keyAbstractions: [], patterns: [] },
    ]
    arch.modules = [
      { path: 'src', purpose: 'Source code.', children: [], publicApi: [], patterns: [], crossCuttingConcerns: [] },
    ]

    const context = gatherChildContext('.', arch)

    // Root should include index.ts (direct child) but not src/deep.ts (grandchild)
    expect(context).toContain('index.ts')
    expect(context).not.toContain('src/deep.ts')
    // Root should include src module
    expect(context).toContain('src')
  })

  it('includes exports and key abstractions in file summaries', () => {
    const arch = createEmptyArchitecture()
    arch.files = [
      { path: 'src/config.ts', purpose: 'Config.', exports: ['config', 'loadConfig'], imports: [], keyAbstractions: ['Config', 'EnvVar'], patterns: [] },
    ]

    const context = gatherChildContext('src', arch)

    expect(context).toContain('config, loadConfig')
    expect(context).toContain('Config, EnvVar')
  })
})

// --- processOneModule ---

describe('processOneModule', () => {
  function makeParams(overrides?: Partial<ProcessOneModuleParams>): ProcessOneModuleParams {
    const arch = createEmptyArchitecture()
    arch.files = [
      { path: 'src/utils/helpers.ts', purpose: 'Helper functions.', exports: ['help'], imports: [], keyAbstractions: [], patterns: [] },
      { path: 'src/utils/format.ts', purpose: 'Formatting.', exports: ['fmt'], imports: [], keyAbstractions: [], patterns: [] },
    ]

    const progress = createFreshProgress('Test', 'project')
    progress.pending = ['src/utils']
    progress.phase = 'module-synthesis'

    const testDir = path.join(tempDir, `module-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(testDir, { recursive: true })

    return {
      client: createMockClient('src/utils'),
      systemPrompt: 'You are an expert software architect.',
      model: 'claude-opus-4-6',
      maxTokens: 4096,
      outputDir: testDir,
      progress,
      architecture: arch,
      logger: silentLogger,
      folderPath: 'src/utils',
      ...overrides,
    }
  }

  it('synthesizes a folder and adds it to architecture.modules', async () => {
    const params = makeParams()

    const result = await processOneModule(params)

    expect(result.architecture.modules).toHaveLength(1)
    expect(result.architecture.modules[0]!.path).toBe('src/utils')
  })

  it('marks the folder as completed in progress', async () => {
    const params = makeParams()

    const result = await processOneModule(params)

    expect(result.progress.completed).toHaveLength(1)
    expect(result.progress.completed[0]!.path).toBe('src/utils')
  })

  it('returns usage info with cost', async () => {
    const params = makeParams()

    const result = await processOneModule(params)

    expect(result.usage).not.toBeNull()
    expect(result.usage!.inputTokens).toBe(3000)
    expect(result.usage!.outputTokens).toBe(1200)
    expect(result.usage!.costUsd).toBeGreaterThan(0)
  })

  it('enriches ModuleAnalysis with tokensUsed', async () => {
    const params = makeParams()

    const result = await processOneModule(params)

    expect(result.architecture.modules[0]!.tokensUsed).toBe(4200) // 3000 + 1200
  })

  it('marks folder as failed when LLM throws', async () => {
    const errorClient = {
      messages: { create: vi.fn().mockRejectedValue(new Error('Opus overloaded')) },
    } as unknown as Anthropic

    const params = makeParams({ client: errorClient })

    const result = await processOneModule(params)

    expect(result.progress.failed).toHaveLength(1)
    expect(result.progress.failed[0]!.error).toContain('LlmError')
    expect(result.architecture.modules).toHaveLength(0)
  })

  it('marks folder as failed when Zod validation fails', async () => {
    const badClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-4-6',
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'toolu_test', name: 'record_module_analysis', input: { path: 'src/utils' } }],
          usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
      },
    } as unknown as Anthropic

    const params = makeParams({ client: badClient })

    const result = await processOneModule(params)

    expect(result.progress.failed).toHaveLength(1)
    expect(result.progress.failed[0]!.error).toContain('ZodParseError')
  })

  it('marks folder as failed when no children are found', async () => {
    const params = makeParams({ folderPath: 'src/empty' })
    params.architecture.files = [] // no files

    const result = await processOneModule(params)

    expect(result.progress.failed).toHaveLength(1)
    expect(result.progress.failed[0]!.error).toContain('NoChildren')
  })

  it('does not mutate original objects', async () => {
    const params = makeParams()
    const originalModulesCount = params.architecture.modules.length
    const originalPending = [...params.progress.pending]

    await processOneModule(params)

    expect(params.architecture.modules.length).toBe(originalModulesCount)
    expect(params.progress.pending).toEqual(originalPending)
  })
})

// --- runModuleSynthesis ---

describe('runModuleSynthesis', () => {
  // Build a tree: src/ → utils/ (leaf) + api/ → handlers/ (leaf)
  const tree: TreeNode = {
    name: 'src', relativePath: '.', type: 'directory',
    children: [
      { name: 'config.ts', relativePath: 'config.ts', type: 'file', extension: 'ts' },
      {
        name: 'utils', relativePath: 'utils', type: 'directory',
        children: [
          { name: 'helpers.ts', relativePath: 'utils/helpers.ts', type: 'file', extension: 'ts' },
        ],
      },
      {
        name: 'api', relativePath: 'api', type: 'directory',
        children: [
          { name: 'router.ts', relativePath: 'api/router.ts', type: 'file', extension: 'ts' },
          {
            name: 'handlers', relativePath: 'api/handlers', type: 'directory',
            children: [
              { name: 'users.ts', relativePath: 'api/handlers/users.ts', type: 'file', extension: 'ts' },
            ],
          },
        ],
      },
    ],
  }

  function makeArchitectureWithFiles(): Architecture {
    const arch = createEmptyArchitecture()
    arch.files = [
      { path: 'config.ts', purpose: 'Config.', exports: ['config'], imports: [], keyAbstractions: [], patterns: [] },
      { path: 'utils/helpers.ts', purpose: 'Helpers.', exports: ['help'], imports: [], keyAbstractions: [], patterns: [] },
      { path: 'api/router.ts', purpose: 'Router.', exports: ['router'], imports: [], keyAbstractions: [], patterns: [] },
      { path: 'api/handlers/users.ts', purpose: 'User handlers.', exports: ['getUsers'], imports: [], keyAbstractions: [], patterns: [] },
    ]
    return arch
  }

  function makeSynthesisParams(overrides?: Record<string, unknown>) {
    const testDir = path.join(tempDir, `synth-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    fs.mkdirSync(testDir, { recursive: true })

    const progress = createFreshProgress('Test', 'project')
    progress.pending = ['utils', 'api/handlers', 'api', '.']
    progress.phase = 'module-synthesis'

    return {
      client: createSmartMockClient(),
      systemPrompt: 'You are an expert software architect.',
      model: 'claude-opus-4-6',
      maxTokens: 4096,
      outputDir: testDir,
      progress,
      architecture: makeArchitectureWithFiles(),
      tree,
      logger: silentLogger,
      ...overrides,
    }
  }

  it('processes all waves in bottom-up order', async () => {
    const params = makeSynthesisParams()

    const result = await runModuleSynthesis(params)

    // 4 folders: utils (w0), api/handlers (w0), api (w1), . (w2)
    expect(result.architecture.modules).toHaveLength(4)

    // Verify order: leaf folders appear before their parents
    const paths = result.architecture.modules.map((m) => m.path)
    const handlersIdx = paths.indexOf('api/handlers')
    const apiIdx = paths.indexOf('api')
    const rootIdx = paths.indexOf('.')
    expect(handlersIdx).toBeLessThan(apiIdx)
    expect(apiIdx).toBeLessThan(rootIdx)
  })

  it('skips already completed folders (resume)', async () => {
    const params = makeSynthesisParams()
    // Simulate utils/ already done
    params.progress.completed = [{
      path: 'utils', analyzedAt: new Date().toISOString(), tokensUsed: 1000, durationMs: 2000,
    }]
    params.progress.pending = ['api/handlers', 'api', '.']
    params.architecture.modules = [{
      path: 'utils', purpose: 'Previously done.', children: [], publicApi: [], patterns: [], crossCuttingConcerns: [],
    }]

    const result = await runModuleSynthesis(params)

    // 3 new + 1 existing = 4 total
    expect(result.architecture.modules).toHaveLength(4)
    // LLM should only be called 3 times (not for utils/)
    expect(vi.mocked(params.client.messages.create)).toHaveBeenCalledTimes(3)
  })

  it('continues after one folder fails', async () => {
    const failClient = {
      messages: {
        create: vi.fn().mockImplementation(async (createParams: { messages: Array<{ content: string }> }) => {
          const userMsg = createParams.messages[0]!.content
          if (userMsg.includes('api/handlers')) {
            throw new Error('Simulated failure')
          }
          const pathMatch = userMsg.match(/Folder path: (.+)\n/)
          return {
            id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-4-6',
            stop_reason: 'tool_use',
            content: [{ type: 'tool_use', id: 'toolu_test', name: 'record_module_analysis', input: validModuleAnalysis(pathMatch![1]!) }],
            usage: { input_tokens: 2000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          }
        }),
      },
    } as unknown as Anthropic

    const params = makeSynthesisParams({ client: failClient })

    const result = await runModuleSynthesis(params)

    // 3 succeeded, 1 failed
    expect(result.progress.failed.some((f) => f.path === 'api/handlers')).toBe(true)
    expect(result.architecture.modules.length).toBe(3)
  })

  it('checkpoints progress after each folder', async () => {
    const params = makeSynthesisParams()

    await runModuleSynthesis(params)

    const progressPath = path.join(params.outputDir, 'progress.json')
    expect(fs.existsSync(progressPath)).toBe(true)
    const saved = JSON.parse(fs.readFileSync(progressPath, 'utf-8'))
    expect(saved.completed.length).toBeGreaterThanOrEqual(4)
  })

  it('accumulates total usage across all folders', async () => {
    const params = makeSynthesisParams()

    const result = await runModuleSynthesis(params)

    // 4 folders × (2000 input + 800 output)
    expect(result.totalUsage.callCount).toBe(4)
    expect(result.totalUsage.inputTokens).toBe(8000)
    expect(result.totalUsage.outputTokens).toBe(3200)
    expect(result.totalUsage.costUsd).toBeGreaterThan(0)
  })
})
