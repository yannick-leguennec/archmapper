import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  submitBatch,
  pollBatch,
  retrieveAndSaveResults,
  deleteCachedResults,
  MAX_REQUESTS_PER_BATCH,
} from '../../src/batch-client'
import { createRootLogger } from '../../src/logger'

import type Anthropic from '@anthropic-ai/sdk'

const silentLogger = createRootLogger('test', 'ERROR')

let tempDir: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archmapper-batch-test-'))
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

// --- Mock helpers ---

function createMockRequest(customId: string) {
  return {
    custom_id: customId,
    params: {
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: [{ type: 'text' as const, text: 'System prompt', cache_control: { type: 'ephemeral' as const } }],
      messages: [{ role: 'user' as const, content: `Analyze ${customId}` }],
    } as Anthropic.Messages.MessageCreateParamsNonStreaming,
  }
}

function createAsyncIterable(items: unknown[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item
    },
  }
}

function createSucceededResult(customId: string, toolInput: unknown) {
  return {
    custom_id: customId,
    result: {
      type: 'succeeded',
      message: {
        content: [{
          type: 'tool_use',
          id: 'toolu_1',
          name: 'record_file_analysis',
          input: toolInput,
        }],
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 800,
          cache_creation_input_tokens: 0,
        },
        stop_reason: 'tool_use',
      },
    },
  }
}

// --- submitBatch ---

describe('submitBatch', () => {
  it('submits requests and returns a batch ID', async () => {
    const client = {
      messages: {
        batches: {
          create: vi.fn().mockResolvedValue({ id: 'batch_test_123' }),
        },
      },
    } as unknown as Anthropic

    const requests = [createMockRequest('src/a.ts'), createMockRequest('src/b.ts')]

    const batchId = await submitBatch({ client, requests, logger: silentLogger })

    expect(batchId).toBe('batch_test_123')
    expect(vi.mocked(client.messages.batches.create)).toHaveBeenCalledOnce()
  })

  it('passes all requests to the API', async () => {
    const client = {
      messages: {
        batches: {
          create: vi.fn().mockResolvedValue({ id: 'batch_test' }),
        },
      },
    } as unknown as Anthropic

    const requests = [
      createMockRequest('src/a.ts'),
      createMockRequest('src/b.ts'),
      createMockRequest('src/c.ts'),
    ]

    await submitBatch({ client, requests, logger: silentLogger })

    const body = vi.mocked(client.messages.batches.create).mock.calls[0]![0]
    expect(body.requests).toHaveLength(3)
    expect(body.requests[0]!.custom_id).toBe('src/a.ts')
  })

  it('throws on empty request array', async () => {
    const client = {} as Anthropic

    await expect(submitBatch({ client, requests: [], logger: silentLogger }))
      .rejects.toThrow('Cannot submit an empty batch')
  })

  it('throws when exceeding max requests per batch', async () => {
    const client = {} as Anthropic
    const requests = Array.from({ length: MAX_REQUESTS_PER_BATCH + 1 }, (_, i) =>
      createMockRequest(`file_${i}.ts`)
    )

    await expect(submitBatch({ client, requests, logger: silentLogger }))
      .rejects.toThrow(`${MAX_REQUESTS_PER_BATCH}`)
  })
})

// --- pollBatch ---

describe('pollBatch', () => {
  it('returns immediately when batch is already ended', async () => {
    const client = {
      messages: {
        batches: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'batch_123',
            processing_status: 'ended',
            request_counts: { processing: 0, succeeded: 5, errored: 0, canceled: 0, expired: 0 },
          }),
        },
      },
    } as unknown as Anthropic

    const result = await pollBatch(client, 'batch_123', silentLogger, { initialDelayMs: 1, maxDelayMs: 1 })

    expect(result.processing_status).toBe('ended')
    expect(vi.mocked(client.messages.batches.retrieve)).toHaveBeenCalledTimes(1)
  })

  it('polls multiple times until ended', async () => {
    let callCount = 0
    const client = {
      messages: {
        batches: {
          retrieve: vi.fn().mockImplementation(async () => {
            callCount++
            return {
              id: 'batch_123',
              processing_status: callCount >= 3 ? 'ended' : 'in_progress',
              request_counts: { processing: callCount >= 3 ? 0 : 3, succeeded: callCount >= 3 ? 5 : 2, errored: 0, canceled: 0, expired: 0 },
            }
          }),
        },
      },
    } as unknown as Anthropic

    const result = await pollBatch(client, 'batch_123', silentLogger, { initialDelayMs: 1, maxDelayMs: 1 })

    expect(result.processing_status).toBe('ended')
    expect(vi.mocked(client.messages.batches.retrieve)).toHaveBeenCalledTimes(3)
  })

  it('throws when max wait time is exceeded', async () => {
    const client = {
      messages: {
        batches: {
          retrieve: vi.fn().mockResolvedValue({
            id: 'batch_123',
            processing_status: 'in_progress',
            request_counts: { processing: 5, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
          }),
        },
      },
    } as unknown as Anthropic

    await expect(
      pollBatch(client, 'batch_123', silentLogger, { initialDelayMs: 1, maxDelayMs: 1, maxWaitMs: 5 })
    ).rejects.toThrow('did not complete')
  })
})

// --- retrieveAndSaveResults ---

describe('retrieveAndSaveResults', () => {
  it('downloads results from API and saves to disk', async () => {
    const outputDir = path.join(tempDir, 'retrieve-test-1')
    fs.mkdirSync(outputDir, { recursive: true })

    const mockResults = [
      createSucceededResult('src/a.ts', { path: 'src/a.ts', purpose: 'Test', exports: [], imports: [], keyAbstractions: [], patterns: [] }),
    ]

    const client = {
      messages: {
        batches: {
          results: vi.fn().mockResolvedValue(createAsyncIterable(mockResults)),
        },
      },
    } as unknown as Anthropic

    const output = await retrieveAndSaveResults(client, 'batch_save_1', 'claude-sonnet-4-6', outputDir, silentLogger)

    expect(output.results).toHaveLength(1)
    expect(output.results[0]!.customId).toBe('src/a.ts')

    // Verify file was saved to disk
    const files = fs.readdirSync(outputDir)
    const resultFile = files.find((f) => f.startsWith('batch-results-'))
    expect(resultFile).toBeDefined()

    // Verify saved content is valid JSON
    const savedContent = JSON.parse(fs.readFileSync(path.join(outputDir, resultFile!), 'utf-8'))
    expect(savedContent.results).toHaveLength(1)
    expect(savedContent.batchId).toBe('batch_save_1')
  })

  it('loads from disk cache if results file already exists (skips API)', async () => {
    const outputDir = path.join(tempDir, 'retrieve-test-2')
    fs.mkdirSync(outputDir, { recursive: true })

    // Pre-save a results file
    const cachedOutput = {
      results: [{ customId: 'src/cached.ts', json: { path: 'src/cached.ts' }, usage: { model: 'claude-sonnet-4-6', inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: 0.001 } }],
      failures: [],
      batchId: 'batch_cached',
    }
    fs.writeFileSync(path.join(outputDir, 'batch-results-batch_cached.json'), JSON.stringify(cachedOutput), 'utf-8')

    // API should NOT be called
    const client = {
      messages: {
        batches: {
          results: vi.fn().mockRejectedValue(new Error('Should not be called')),
        },
      },
    } as unknown as Anthropic

    const output = await retrieveAndSaveResults(client, 'batch_cached', 'claude-sonnet-4-6', outputDir, silentLogger)

    expect(output.results).toHaveLength(1)
    expect(output.results[0]!.customId).toBe('src/cached.ts')
    expect(vi.mocked(client.messages.batches.results)).not.toHaveBeenCalled()
  })

  it('handles errored results as failures', async () => {
    const outputDir = path.join(tempDir, 'retrieve-test-3')
    fs.mkdirSync(outputDir, { recursive: true })

    const mockResults = [
      { custom_id: 'src/bad.ts', result: { type: 'errored', error: { error: { message: 'Context exceeded' } } } },
    ]

    const client = {
      messages: { batches: { results: vi.fn().mockResolvedValue(createAsyncIterable(mockResults)) } },
    } as unknown as Anthropic

    const output = await retrieveAndSaveResults(client, 'batch_err', 'claude-sonnet-4-6', outputDir, silentLogger)

    expect(output.results).toHaveLength(0)
    expect(output.failures).toHaveLength(1)
    expect(output.failures[0]!.error).toContain('Context exceeded')
  })

  it('handles canceled and expired results as failures', async () => {
    const outputDir = path.join(tempDir, 'retrieve-test-4')
    fs.mkdirSync(outputDir, { recursive: true })

    const mockResults = [
      { custom_id: 'src/canceled.ts', result: { type: 'canceled' } },
      { custom_id: 'src/expired.ts', result: { type: 'expired' } },
    ]

    const client = {
      messages: { batches: { results: vi.fn().mockResolvedValue(createAsyncIterable(mockResults)) } },
    } as unknown as Anthropic

    const output = await retrieveAndSaveResults(client, 'batch_cx', 'claude-sonnet-4-6', outputDir, silentLogger)

    expect(output.failures).toHaveLength(2)
  })

  it('handles results without tool_use block as failures', async () => {
    const outputDir = path.join(tempDir, 'retrieve-test-5')
    fs.mkdirSync(outputDir, { recursive: true })

    const mockResults = [
      {
        custom_id: 'src/weird.ts',
        result: {
          type: 'succeeded',
          message: {
            content: [{ type: 'text', text: 'I cannot do that.' }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            stop_reason: 'end_turn',
          },
        },
      },
    ]

    const client = {
      messages: { batches: { results: vi.fn().mockResolvedValue(createAsyncIterable(mockResults)) } },
    } as unknown as Anthropic

    const output = await retrieveAndSaveResults(client, 'batch_notool', 'claude-sonnet-4-6', outputDir, silentLogger)

    expect(output.failures).toHaveLength(1)
    expect(output.failures[0]!.error).toContain('No tool_use block')
  })

  it('handles mixed success and failure results', async () => {
    const outputDir = path.join(tempDir, 'retrieve-test-6')
    fs.mkdirSync(outputDir, { recursive: true })

    const mockResults = [
      createSucceededResult('src/good.ts', { path: 'src/good.ts', purpose: 'Good', exports: [], imports: [], keyAbstractions: [], patterns: [] }),
      { custom_id: 'src/bad.ts', result: { type: 'errored', error: { error: { message: 'Server error' } } } },
    ]

    const client = {
      messages: { batches: { results: vi.fn().mockResolvedValue(createAsyncIterable(mockResults)) } },
    } as unknown as Anthropic

    const output = await retrieveAndSaveResults(client, 'batch_mixed', 'claude-sonnet-4-6', outputDir, silentLogger)

    expect(output.results).toHaveLength(1)
    expect(output.failures).toHaveLength(1)
  })
})

// --- deleteCachedResults ---

describe('deleteCachedResults', () => {
  it('deletes the cached results file', () => {
    const outputDir = path.join(tempDir, 'delete-test-1')
    fs.mkdirSync(outputDir, { recursive: true })
    const filePath = path.join(outputDir, 'batch-results-batch_del.json')
    fs.writeFileSync(filePath, '{}', 'utf-8')

    deleteCachedResults('batch_del', outputDir)

    expect(fs.existsSync(filePath)).toBe(false)
  })

  it('does not throw when file does not exist', () => {
    const outputDir = path.join(tempDir, 'delete-test-2')
    fs.mkdirSync(outputDir, { recursive: true })

    expect(() => deleteCachedResults('nonexistent', outputDir)).not.toThrow()
  })
})
