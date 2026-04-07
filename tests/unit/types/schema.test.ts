import { describe, it, expect } from 'vitest'
import { FileAnalysisSchema, ModuleAnalysisSchema, ArchitectureSchema } from '../../../src/types/schema'

describe('FileAnalysisSchema', () => {
  it('accepts a valid FileAnalysis object', () => {
    const valid = {
      path: 'src/config.ts',
      purpose: 'Loads and validates environment variables at startup.',
      exports: ['config'],
      imports: ['dotenv/config'],
      keyAbstractions: ['Config'],
      patterns: ['config-module'],
    }

    const result = FileAnalysisSchema.safeParse(valid)

    expect(result.success).toBe(true)
  })

  it('rejects when required field "purpose" is missing', () => {
    const invalid = {
      path: 'src/config.ts',
      exports: ['config'],
      imports: [],
      keyAbstractions: [],
      patterns: [],
    }

    const result = FileAnalysisSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })

  it('rejects when path is an empty string', () => {
    const invalid = {
      path: '',
      purpose: 'Some purpose.',
      exports: [],
      imports: [],
      keyAbstractions: [],
      patterns: [],
    }

    const result = FileAnalysisSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })

  it('accepts optional tokensUsed field', () => {
    const valid = {
      path: 'src/config.ts',
      purpose: 'Loads config.',
      exports: [],
      imports: [],
      keyAbstractions: [],
      patterns: [],
      tokensUsed: 1234,
    }

    const result = FileAnalysisSchema.safeParse(valid)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.tokensUsed).toBe(1234)
    }
  })

  it('accepts optional notes field', () => {
    const valid = {
      path: 'src/config.ts',
      purpose: 'Loads config.',
      exports: [],
      imports: [],
      keyAbstractions: [],
      patterns: [],
      notes: 'Has a circular dependency with logger.ts',
    }

    const result = FileAnalysisSchema.safeParse(valid)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.notes).toBe('Has a circular dependency with logger.ts')
    }
  })
})

describe('ModuleAnalysisSchema', () => {
  it('accepts a valid ModuleAnalysis object', () => {
    const valid = {
      path: 'src/pipeline',
      purpose: 'Core pipeline logic for file analysis and folder-wave synthesis.',
      children: ['src/pipeline/file-phase.ts', 'src/pipeline/folder-waves.ts'],
      publicApi: ['runFilePhase', 'runFolderWaves'],
      patterns: ['layered-architecture'],
      crossCuttingConcerns: ['error-handling', 'logging'],
    }

    const result = ModuleAnalysisSchema.safeParse(valid)

    expect(result.success).toBe(true)
  })

  it('rejects when crossCuttingConcerns is missing', () => {
    const invalid = {
      path: 'src/pipeline',
      purpose: 'Pipeline logic.',
      children: [],
      publicApi: [],
      patterns: [],
      // crossCuttingConcerns intentionally omitted
    }

    const result = ModuleAnalysisSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })
})

describe('ArchitectureSchema', () => {
  it('accepts a valid Architecture object', () => {
    const valid = {
      schemaVersion: '1.0',
      projectName: 'TestProject',
      fileModel: 'claude-sonnet-4-6',
      synthesisModel: 'claude-opus-4-6',
      generatedAt: '2026-04-06T12:00:00Z',
      files: [],
      modules: [],
      summary: 'A test project with no files analyzed.',
      designPatterns: [],
    }

    const result = ArchitectureSchema.safeParse(valid)

    expect(result.success).toBe(true)
  })

  it('rejects when schemaVersion is missing', () => {
    const invalid = {
      projectName: 'TestProject',
      fileModel: 'claude-sonnet-4-6',
      synthesisModel: 'claude-opus-4-6',
      generatedAt: '2026-04-06T12:00:00Z',
      files: [],
      modules: [],
      summary: 'A test project.',
      designPatterns: [],
    }

    const result = ArchitectureSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })

  it('rejects when summary is empty string', () => {
    const invalid = {
      schemaVersion: '1.0',
      projectName: 'TestProject',
      fileModel: 'claude-sonnet-4-6',
      synthesisModel: 'claude-opus-4-6',
      generatedAt: '2026-04-06T12:00:00Z',
      files: [],
      modules: [],
      summary: '',
      designPatterns: [],
    }

    const result = ArchitectureSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })
})
