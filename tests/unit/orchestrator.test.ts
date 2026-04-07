import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

import { generateSpecCards, printCostSummary } from '../../scripts/orchestrator'
import { createFreshProgress, computeStats } from '../../src/pipeline/progress'

import type { Architecture } from '../../src/types/schema'
import type { AggregatedUsage } from '../../src/pipeline/file-phase'

// --- Fixtures ---

let tempDir: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archmapper-orchestrator-test-'))
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function createTestArchitecture(): Architecture {
  return {
    schemaVersion: '1.0',
    projectName: 'TestProject',
    fileModel: 'claude-sonnet-4-6',
    synthesisModel: 'claude-opus-4-6',
    generatedAt: '2026-04-07T12:00:00Z',
    files: [
      { path: 'src/config.ts', purpose: 'Config loader.', exports: ['config'], imports: ['dotenv'], keyAbstractions: ['Config'], patterns: ['config-module'] },
      { path: 'src/logger.ts', purpose: 'Structured logger.', exports: ['createRootLogger'], imports: [], keyAbstractions: ['Logger'], patterns: ['factory'] },
    ],
    modules: [
      {
        path: 'src',
        purpose: 'Main source directory containing all application logic.',
        children: ['src/config.ts', 'src/logger.ts', 'src/pipeline'],
        publicApi: ['config', 'createRootLogger'],
        patterns: ['layered-architecture'],
        crossCuttingConcerns: ['logging', 'configuration'],
        notes: 'Could benefit from splitting config and pipeline into separate top-level modules.',
      },
      {
        path: 'src/pipeline',
        purpose: 'Core pipeline modules for file analysis and folder synthesis.',
        children: ['src/pipeline/file-phase.ts', 'src/pipeline/folder-waves.ts'],
        publicApi: ['runFilePhase', 'runModuleSynthesis'],
        patterns: ['feature-module'],
        crossCuttingConcerns: ['error-handling'],
      },
    ],
    summary: 'A test project with 2 files and 2 modules.',
    designPatterns: ['config-module', 'factory'],
  }
}

function createEmptyUsage(): AggregatedUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
    callCount: 0,
  }
}

// --- generateSpecCards ---

describe('generateSpecCards', () => {
  it('creates one .md file per module', () => {
    const arch = createTestArchitecture()
    const outputDir = path.join(tempDir, 'specs-test-1')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const specsDir = path.join(outputDir, 'specs')
    const files = fs.readdirSync(specsDir).sort()
    expect(files).toEqual(['src.md', 'src_pipeline.md'])
  })

  it('includes purpose in the spec card', () => {
    const arch = createTestArchitecture()
    const outputDir = path.join(tempDir, 'specs-test-2')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const content = fs.readFileSync(path.join(outputDir, 'specs', 'src.md'), 'utf-8')
    expect(content).toContain('Main source directory containing all application logic.')
  })

  it('includes public API in the spec card', () => {
    const arch = createTestArchitecture()
    const outputDir = path.join(tempDir, 'specs-test-3')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const content = fs.readFileSync(path.join(outputDir, 'specs', 'src.md'), 'utf-8')
    expect(content).toContain('`config`')
    expect(content).toContain('`createRootLogger`')
  })

  it('includes patterns in the spec card', () => {
    const arch = createTestArchitecture()
    const outputDir = path.join(tempDir, 'specs-test-4')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const content = fs.readFileSync(path.join(outputDir, 'specs', 'src.md'), 'utf-8')
    expect(content).toContain('layered-architecture')
  })

  it('includes cross-cutting concerns in the spec card', () => {
    const arch = createTestArchitecture()
    const outputDir = path.join(tempDir, 'specs-test-5')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const content = fs.readFileSync(path.join(outputDir, 'specs', 'src.md'), 'utf-8')
    expect(content).toContain('logging')
    expect(content).toContain('configuration')
  })

  it('includes children in the spec card', () => {
    const arch = createTestArchitecture()
    const outputDir = path.join(tempDir, 'specs-test-6')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const content = fs.readFileSync(path.join(outputDir, 'specs', 'src.md'), 'utf-8')
    expect(content).toContain('src/config.ts')
    expect(content).toContain('src/pipeline')
  })

  it('includes notes when present', () => {
    const arch = createTestArchitecture()
    const outputDir = path.join(tempDir, 'specs-test-7')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const content = fs.readFileSync(path.join(outputDir, 'specs', 'src.md'), 'utf-8')
    expect(content).toContain('Could benefit from splitting')
  })

  it('omits empty sections', () => {
    const arch = createTestArchitecture()
    // pipeline module has no notes
    const outputDir = path.join(tempDir, 'specs-test-8')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const content = fs.readFileSync(path.join(outputDir, 'specs', 'src_pipeline.md'), 'utf-8')
    expect(content).not.toContain('## Notes')
  })

  it('handles root module path (.) as "root.md"', () => {
    const arch = createTestArchitecture()
    arch.modules.push({
      path: '.',
      purpose: 'Project root.',
      children: ['src'],
      publicApi: [],
      patterns: [],
      crossCuttingConcerns: [],
    })
    const outputDir = path.join(tempDir, 'specs-test-9')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const files = fs.readdirSync(path.join(outputDir, 'specs'))
    expect(files).toContain('root.md')
  })

  it('handles architecture with no modules gracefully', () => {
    const arch = createTestArchitecture()
    arch.modules = []
    const outputDir = path.join(tempDir, 'specs-test-10')
    fs.mkdirSync(outputDir, { recursive: true })

    generateSpecCards(outputDir, arch)

    const specsDir = path.join(outputDir, 'specs')
    expect(fs.existsSync(specsDir)).toBe(true)
    expect(fs.readdirSync(specsDir)).toEqual([])
  })
})

// --- printCostSummary ---

describe('printCostSummary', () => {
  it('writes a formatted cost summary to stdout', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const fileUsage: AggregatedUsage = {
      inputTokens: 2_340_000,
      outputTokens: 890_000,
      cacheReadInputTokens: 1_800_000,
      cacheCreationInputTokens: 50_000,
      costUsd: 20.37,
      callCount: 1897,
    }
    const moduleUsage: AggregatedUsage = {
      inputTokens: 164_000,
      outputTokens: 124_800,
      cacheReadInputTokens: 120_000,
      cacheCreationInputTokens: 10_000,
      costUsd: 3.94,
      callCount: 142,
    }

    const progress = createFreshProgress('TestProject', 'project')
    progress.stats = { totalFiles: 1900, completedFiles: 1897, failedFiles: 3, pendingFiles: 0 }

    printCostSummary(fileUsage, moduleUsage, 2_820_000, progress)

    const output = writeSpy.mock.calls[0]![0] as string

    expect(output).toContain('TestProject')
    expect(output).toContain('1897 analyzed')
    expect(output).toContain('3 failed')
    expect(output).toContain('142 synthesized')
    expect(output).toContain('$20.37')
    expect(output).toContain('$3.94')
    expect(output).toContain('$24.31')
    expect(output).toContain('47')  // ~47 minutes

    writeSpy.mockRestore()
  })

  it('formats large token counts with M suffix', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const usage: AggregatedUsage = {
      inputTokens: 2_340_000,
      outputTokens: 890_000,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
      callCount: 0,
    }

    const progress = createFreshProgress('Test', 'project')
    progress.stats = { totalFiles: 0, completedFiles: 0, failedFiles: 0, pendingFiles: 0 }

    printCostSummary(usage, createEmptyUsage(), 0, progress)

    const output = writeSpy.mock.calls[0]![0] as string
    expect(output).toContain('2.34M')
    expect(output).toContain('890.0K')

    writeSpy.mockRestore()
  })

  it('handles zero usage gracefully', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    const progress = createFreshProgress('Empty', 'project')
    progress.stats = { totalFiles: 0, completedFiles: 0, failedFiles: 0, pendingFiles: 0 }

    printCostSummary(createEmptyUsage(), createEmptyUsage(), 0, progress)

    const output = writeSpy.mock.calls[0]![0] as string
    expect(output).toContain('$0.0000')
    expect(output).toContain('0 analyzed')

    writeSpy.mockRestore()
  })
})
