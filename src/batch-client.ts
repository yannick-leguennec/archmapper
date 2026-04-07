/**
 * Batch client — submits, polls, retrieves, and caches Anthropic Message Batch results.
 *
 * Responsibilities:
 * - Submit an array of requests as a single batch (50% cost reduction)
 * - Poll with exponential backoff until the batch completes
 * - Save raw results to a temp file on disk (crash safety — avoids re-submitting)
 * - Parse results matched by custom_id
 * - Clean up temp files after successful processing
 *
 * Three layers of crash safety:
 *   1. progress.batchIds — know which batches are in-flight
 *   2. batch-results-<id>.json — raw results saved before processing
 *   3. progress.json — individual items checkpointed after insertion
 *
 * Does NOT: build requests (llm-client.ts does that), validate with Zod,
 * track progress, or manage architecture.json.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type Anthropic from '@anthropic-ai/sdk'
import type { MessageBatch, MessageBatchIndividualResponse } from '@anthropic-ai/sdk/resources/messages/batches'

import { trackUsage } from './llm-client'

import type { UsageInfo } from './llm-client'
import type { Logger } from './logger'

// --- Types ---

export interface BatchSubmitParams {
  client: Anthropic
  requests: Array<{
    custom_id: string
    params: Anthropic.Messages.MessageCreateParamsNonStreaming
  }>
  logger: Logger
}

export interface BatchResult {
  customId: string
  json: unknown
  usage: UsageInfo
}

export interface BatchFailure {
  customId: string
  error: string
}

export interface BatchOutput {
  results: BatchResult[]
  failures: BatchFailure[]
  batchId: string
}

export interface PollOptions {
  initialDelayMs?: number
  maxDelayMs?: number
  maxWaitMs?: number
}

// --- Constants ---

const DEFAULT_INITIAL_DELAY_MS = 10_000   // 10 seconds
const DEFAULT_MAX_DELAY_MS = 60_000       // 1 minute
const DEFAULT_MAX_WAIT_MS = 86_400_000    // 24 hours (Anthropic's batch limit)
const MAX_REQUESTS_PER_BATCH = 10_000
const RESULTS_FILE_PREFIX = 'batch-results-'

// --- Submit ---

export async function submitBatch(params: BatchSubmitParams): Promise<string> {
  const { client, requests, logger } = params

  if (requests.length === 0) {
    throw new Error('Cannot submit an empty batch')
  }

  if (requests.length > MAX_REQUESTS_PER_BATCH) {
    throw new Error(
      `Batch exceeds ${MAX_REQUESTS_PER_BATCH} request limit (got ${requests.length}). ` +
      `Split into multiple batches.`
    )
  }

  logger.info('Submitting batch', { requestCount: requests.length })

  const batch = await client.messages.batches.create({
    requests: requests.map((r) => ({
      custom_id: r.custom_id,
      params: r.params,
    })),
  })

  logger.info('Batch submitted', { batchId: batch.id, requestCount: requests.length })

  return batch.id
}

// --- Poll ---

export async function pollBatch(
  client: Anthropic,
  batchId: string,
  logger: Logger,
  options?: PollOptions,
): Promise<MessageBatch> {
  const initialDelay = options?.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS
  const maxDelay = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const maxWait = options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS

  let delay = initialDelay
  const startTime = Date.now()

  while (true) {
    const batch = await client.messages.batches.retrieve(batchId)

    if (batch.processing_status === 'ended') {
      logger.info('Batch completed', {
        batchId,
        succeeded: batch.request_counts.succeeded,
        errored: batch.request_counts.errored,
        canceled: batch.request_counts.canceled,
        expired: batch.request_counts.expired,
      })
      return batch
    }

    const elapsed = Date.now() - startTime
    if (elapsed >= maxWait) {
      throw new Error(
        `Batch ${batchId} did not complete within ${Math.round(maxWait / 60_000)} minutes. ` +
        `Status: ${batch.processing_status}. Processing: ${batch.request_counts.processing}.`
      )
    }

    logger.debug('Batch still processing', {
      batchId,
      status: batch.processing_status,
      processing: batch.request_counts.processing,
      succeeded: batch.request_counts.succeeded,
      elapsedMs: elapsed,
      nextPollMs: delay,
    })

    await sleep(delay)

    // Exponential backoff: double the delay, capped at maxDelay
    delay = Math.min(delay * 2, maxDelay)
  }
}

// --- Retrieve and save to disk ---

export async function retrieveAndSaveResults(
  client: Anthropic,
  batchId: string,
  model: string,
  outputDir: string,
  logger: Logger,
): Promise<BatchOutput> {
  // Check if results already saved from a previous run (crash recovery)
  const existingOutput = loadCachedResults(batchId, outputDir)
  if (existingOutput) {
    logger.info('Batch results loaded from disk cache (skipping API download)', {
      batchId,
      succeeded: existingOutput.results.length,
      failed: existingOutput.failures.length,
    })
    return existingOutput
  }

  // Download from API
  const output = await retrieveFromApi(client, batchId, model, logger)

  // Save to disk BEFORE processing — crash safety
  saveBatchResults(batchId, outputDir, output)
  logger.info('Batch results saved to disk', {
    batchId,
    file: getResultsFilePath(batchId, outputDir),
    succeeded: output.results.length,
    failed: output.failures.length,
  })

  return output
}

async function retrieveFromApi(
  client: Anthropic,
  batchId: string,
  model: string,
  logger: Logger,
): Promise<BatchOutput> {
  const results: BatchResult[] = []
  const failures: BatchFailure[] = []

  const decoder = await client.messages.batches.results(batchId)

  for await (const item of decoder as AsyncIterable<MessageBatchIndividualResponse>) {
    if (item.result.type === 'succeeded') {
      const message = item.result.message

      // Extract tool_use input (structured output)
      const toolBlock = message.content.find((block) => block.type === 'tool_use')
      if (!toolBlock || toolBlock.type !== 'tool_use') {
        failures.push({
          customId: item.custom_id,
          error: `No tool_use block in response. stop_reason: ${message.stop_reason}`,
        })
        continue
      }

      results.push({
        customId: item.custom_id,
        json: toolBlock.input,
        usage: trackUsage(model, message.usage),
      })
    } else if (item.result.type === 'errored') {
      failures.push({
        customId: item.custom_id,
        error: `Anthropic error: ${item.result.error.error?.message ?? 'unknown error'}`,
      })
    } else if (item.result.type === 'canceled') {
      failures.push({
        customId: item.custom_id,
        error: 'Request was canceled',
      })
    } else if (item.result.type === 'expired') {
      failures.push({
        customId: item.custom_id,
        error: 'Request expired before processing',
      })
    }
  }

  logger.info('Batch results retrieved from API', {
    batchId,
    succeeded: results.length,
    failed: failures.length,
  })

  return { results, failures, batchId }
}

// --- Disk cache for raw results ---

function getResultsFilePath(batchId: string, outputDir: string): string {
  // Sanitize batchId for filesystem safety
  const safeBatchId = batchId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(outputDir, `${RESULTS_FILE_PREFIX}${safeBatchId}.json`)
}

function saveBatchResults(batchId: string, outputDir: string, output: BatchOutput): void {
  const filePath = getResultsFilePath(batchId, outputDir)
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(output, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

function loadCachedResults(batchId: string, outputDir: string): BatchOutput | null {
  const filePath = getResultsFilePath(batchId, outputDir)
  if (!fs.existsSync(filePath)) return null

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as BatchOutput
    // Basic shape check
    if (!Array.isArray(parsed.results) || !Array.isArray(parsed.failures)) return null
    return parsed
  } catch {
    return null
  }
}

export function deleteCachedResults(batchId: string, outputDir: string): void {
  const filePath = getResultsFilePath(batchId, outputDir)
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export { MAX_REQUESTS_PER_BATCH }
