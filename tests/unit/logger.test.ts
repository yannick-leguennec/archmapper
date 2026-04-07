import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRootLogger } from '../../src/logger'

describe('createRootLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('creates a logger that emits JSON to stdout for INFO level', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const logger = createRootLogger('development', undefined)

    logger.info('Pipeline started', { phase: 'static' })

    expect(writeSpy).toHaveBeenCalledOnce()
    const output = writeSpy.mock.calls[0]![0] as string
    const parsed = JSON.parse(output.trim())
    expect(parsed.level).toBe('INFO')
    expect(parsed.message).toBe('Pipeline started')
    expect(parsed.phase).toBe('static')
    expect(parsed.timestamp).toBeDefined()
    expect(parsed.source).toBe('root')
  })

  it('emits ERROR and CRITICAL to stderr', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const logger = createRootLogger('development', undefined)

    logger.error('Something failed', { error_type: 'ZodParseError' })

    expect(stderrSpy).toHaveBeenCalledOnce()
    const output = stderrSpy.mock.calls[0]![0] as string
    const parsed = JSON.parse(output.trim())
    expect(parsed.level).toBe('ERROR')
  })

  it('filters below minimum level in production', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = createRootLogger('production', undefined)

    logger.debug('This should be filtered')

    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  it('respects LOG_LEVEL override', () => {
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const logger = createRootLogger('development', 'WARNING')

    logger.info('This should be filtered')
    logger.warning('This should pass')

    expect(stdoutSpy).toHaveBeenCalledOnce()
    const output = stdoutSpy.mock.calls[0]![0] as string
    const parsed = JSON.parse(output.trim())
    expect(parsed.level).toBe('WARNING')
  })

  it('creates child loggers with inherited context', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const root = createRootLogger('development', undefined)
    const child = root.child({ source: 'file-phase.ts', phase: 'files' })

    child.info('Analyzing file', { path: 'src/main.ts' })

    const output = writeSpy.mock.calls[0]![0] as string
    const parsed = JSON.parse(output.trim())
    expect(parsed.source).toBe('file-phase.ts')
    expect(parsed.phase).toBe('files')
    expect(parsed.path).toBe('src/main.ts')
  })
})
