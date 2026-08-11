import { describe, it, expect } from 'vitest'
import { loadConfig, validateProjectName } from '../../src/config.loader'

// Minimal valid env — the two required variables
const VALID_ENV: Record<string, string> = {
  ANTHROPIC_API_KEY: 'sk-ant-test-key-1234',
  PROJECT_NAME: 'TestProject',
}

describe('validateProjectName', () => {
  it('accepts alphanumeric names', () => {
    expect(validateProjectName('MyProject')).toBe('MyProject')
    expect(validateProjectName('project2024')).toBe('project2024')
    expect(validateProjectName('ABC')).toBe('ABC')
    expect(validateProjectName('a')).toBe('a')
  })

  it('accepts names with underscores', () => {
    expect(validateProjectName('my_project')).toBe('my_project')
    expect(validateProjectName('claude_code_reverse_engineered')).toBe('claude_code_reverse_engineered')
  })

  it('rejects names with hyphens', () => {
    expect(() => validateProjectName('my-project')).toThrow('Invalid PROJECT_NAME')
  })

  it('rejects names with spaces', () => {
    expect(() => validateProjectName('my project')).toThrow('Invalid PROJECT_NAME')
  })

  it('rejects names with dots', () => {
    expect(() => validateProjectName('my.project')).toThrow('Invalid PROJECT_NAME')
  })

  it('rejects empty string', () => {
    expect(() => validateProjectName('')).toThrow('Invalid PROJECT_NAME')
  })

  it('rejects names with path traversal characters', () => {
    expect(() => validateProjectName('../etc')).toThrow('Invalid PROJECT_NAME')
    expect(() => validateProjectName('foo/bar')).toThrow('Invalid PROJECT_NAME')
  })

  it('includes the invalid name in the error message', () => {
    expect(() => validateProjectName('bad-name')).toThrow('"bad-name"')
  })
})

describe('loadConfig — required variables', () => {
  it('throws when ANTHROPIC_API_KEY is missing', () => {
    const env = { PROJECT_NAME: 'Test' }

    expect(() => loadConfig(env)).toThrow('Missing required environment variable: ANTHROPIC_API_KEY')
  })

  it('throws when PROJECT_NAME is missing', () => {
    const env = { ANTHROPIC_API_KEY: 'sk-test' }

    expect(() => loadConfig(env)).toThrow('Missing required environment variable: PROJECT_NAME')
  })

  it('includes .env.example reference in error message', () => {
    const env = {}

    expect(() => loadConfig(env)).toThrow('.env.example')
  })

  it('throws when PROJECT_NAME is invalid (not alphanumeric)', () => {
    const env = { ...VALID_ENV, PROJECT_NAME: 'bad-name' }

    expect(() => loadConfig(env)).toThrow('Invalid PROJECT_NAME')
  })
})

describe('loadConfig — required variables present', () => {
  it('loads successfully with only required variables', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.anthropicApiKey).toBe('sk-ant-test-key-1234')
    expect(cfg.projectName).toBe('TestProject')
  })

  it('does not expose the API key as any other field', () => {
    const cfg = loadConfig(VALID_ENV)
    const values = Object.entries(cfg)
      .filter(([key]) => key !== 'anthropicApiKey')
      .map(([, value]) => String(value))

    // API key must not appear in any other config value
    for (const value of values) {
      expect(value).not.toContain('sk-ant-test-key-1234')
    }
  })
})

describe('loadConfig — optional variables with defaults', () => {
  it('defaults fileModel to claude-sonnet-5', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.fileModel).toBe('claude-sonnet-5')
  })

  it('defaults synthesisModel to claude-opus-5', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.synthesisModel).toBe('claude-opus-5')
  })

  it('defaults scanRoot to "project"', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.scanRoot).toBe('project')
  })

  it('defaults useBatches to false', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.useBatches).toBe(false)
  })

  it('defaults excludePatterns to four entries', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.excludePatterns).toEqual(['node_modules', 'dist', 'build', '.git'])
  })

  it('defaults maxTokens to 4096', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.maxTokens).toBe(4096)
  })

  it('defaults nodeEnv to "development"', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.nodeEnv).toBe('development')
  })

  it('defaults logLevel to undefined', () => {
    const cfg = loadConfig(VALID_ENV)

    expect(cfg.logLevel).toBeUndefined()
  })
})

describe('loadConfig — optional variables with overrides', () => {
  it('overrides fileModel', () => {
    const env = { ...VALID_ENV, FILE_MODEL: 'claude-haiku-4-5-20251001' }

    expect(loadConfig(env).fileModel).toBe('claude-haiku-4-5-20251001')
  })

  it('overrides synthesisModel', () => {
    const env = { ...VALID_ENV, SYNTHESIS_MODEL: 'claude-sonnet-4-6' }

    expect(loadConfig(env).synthesisModel).toBe('claude-sonnet-4-6')
  })

  it('overrides scanRoot', () => {
    const env = { ...VALID_ENV, SCAN_ROOT: 'other/path' }

    expect(loadConfig(env).scanRoot).toBe('other/path')
  })

  it('sets useBatches to true when USE_BATCHES is "true"', () => {
    const env = { ...VALID_ENV, USE_BATCHES: 'true' }

    expect(loadConfig(env).useBatches).toBe(true)
  })

  it('keeps useBatches false for non-"true" values', () => {
    const env = { ...VALID_ENV, USE_BATCHES: 'yes' }

    expect(loadConfig(env).useBatches).toBe(false)
  })

  it('parses custom EXCLUDE_PATTERNS as comma-separated list', () => {
    const env = { ...VALID_ENV, EXCLUDE_PATTERNS: 'vendor,tmp,.cache' }

    expect(loadConfig(env).excludePatterns).toEqual(['vendor', 'tmp', '.cache'])
  })

  it('parses MAX_TOKENS as integer', () => {
    const env = { ...VALID_ENV, MAX_TOKENS: '8192' }

    expect(loadConfig(env).maxTokens).toBe(8192)
  })

  it('overrides logLevel', () => {
    const env = { ...VALID_ENV, LOG_LEVEL: 'WARNING' }

    expect(loadConfig(env).logLevel).toBe('WARNING')
  })
})
