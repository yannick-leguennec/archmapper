/**
 * File-phase runner — coordinates the analysis of every source file.
 *
 * For each pending file:
 *   1. Read from disk
 *   2. Send to LLM (via llm-client.ts)
 *   3. Validate with Zod (belt and suspenders after structured output)
 *   4. Push into architecture.files[]
 *   5. Checkpoint progress
 *
 * Does NOT: build the tree, create the LLM client, or decide which files to scan.
 * Those are the orchestrator's job.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import { FileAnalysisSchema } from '../types/schema'
import { analyzeFile, buildBatchRequests } from '../llm-client'
import { submitBatch, pollBatch, retrieveAndSaveResults, deleteCachedResults, encodeCustomId, MAX_REQUESTS_PER_BATCH } from '../batch-client'
import { markCompleted, markFailed, saveProgress } from './progress'
import { saveArtifact, loadArtifact } from './static-analysis'

import type Anthropic from '@anthropic-ai/sdk'
import type { UsageInfo } from '../llm-client'
import type { FileAnalysis, Architecture } from '../types/schema'
import type { ProgressState } from './progress'
import type { DependencyGraph } from './static-analysis'
import type { Logger } from '../logger'

// --- Types ---

export interface FilePhaseParams {
  client: Anthropic
  systemPrompt: string
  model: string
  maxTokens: number
  scanRoot: string
  outputDir: string
  progress: ProgressState
  architecture: Architecture
  depGraph: DependencyGraph | null
  logger: Logger
  useBatches?: boolean
}

export interface FilePhaseResult {
  progress: ProgressState
  architecture: Architecture
  totalUsage: AggregatedUsage
}

export interface AggregatedUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUsd: number
  callCount: number
}

// --- Main entry point ---

export async function runFilePhase(params: FilePhaseParams): Promise<FilePhaseResult> {
  if (params.useBatches) {
    return runFilePhaseInBatchMode(params)
  }
  return runFilePhaseInSyncMode(params)
}

async function runFilePhaseInSyncMode(params: FilePhaseParams): Promise<FilePhaseResult> {
  const { logger, outputDir } = params
  let { progress, architecture } = params

  const totalUsage: AggregatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
    callCount: 0,
  }

  const pending = [...progress.pending]
  const total = pending.length + progress.completed.length + progress.failed.length

  logger.info('File phase started (sync mode)', {
    pendingFiles: pending.length,
    completedFiles: progress.completed.length,
    totalFiles: total,
  })

  for (const filePath of pending) {
    // Update currentItem for resume UX
    progress = { ...progress, currentItem: filePath }

    const result = await processOneFile({
      ...params,
      progress,
      architecture,
      filePath,
    })

    progress = result.progress
    architecture = result.architecture

    if (result.usage) {
      totalUsage.inputTokens += result.usage.inputTokens
      totalUsage.outputTokens += result.usage.outputTokens
      totalUsage.cacheReadInputTokens += result.usage.cacheReadInputTokens
      totalUsage.cacheCreationInputTokens += result.usage.cacheCreationInputTokens
      totalUsage.costUsd += result.usage.costUsd
      totalUsage.callCount += 1
    }

    // Checkpoint after every file
    saveProgress(outputDir, progress)
    saveArtifact(outputDir, 'architecture.json', architecture)
  }

  logger.info('File phase complete', {
    completedFiles: progress.completed.length,
    failedFiles: progress.failed.length,
    totalCostUsd: Math.round(totalUsage.costUsd * 1_000_000) / 1_000_000,
    totalInputTokens: totalUsage.inputTokens,
    totalOutputTokens: totalUsage.outputTokens,
  })

  return { progress, architecture, totalUsage }
}

// --- Batch mode ---

async function runFilePhaseInBatchMode(params: FilePhaseParams): Promise<FilePhaseResult> {
  const { client, systemPrompt, model, maxTokens, scanRoot, outputDir, depGraph, logger } = params
  let { progress, architecture } = params

  const totalUsage: AggregatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
    callCount: 0,
  }

  const pending = [...progress.pending]

  logger.info('File phase started (batch mode)', {
    pendingFiles: pending.length,
    completedFiles: progress.completed.length,
  })

  // Check if we already have a submitted batch (crash recovery)
  if (progress.batchIds.length > 0) {
    logger.info('Resuming existing batch', { batchIds: progress.batchIds })

    // Load the custom_id mapping from disk (saved before crash)
    const savedMap = loadArtifact<Record<string, string>>(outputDir, 'custom-id-map.json') ?? {}
    const customIdToPath = new Map(Object.entries(savedMap))

    for (const batchId of progress.batchIds) {
      const batchResult = await pollAndProcessBatch(
        client, batchId, model, progress, architecture, outputDir, logger, customIdToPath,
      )
      progress = batchResult.progress
      architecture = batchResult.architecture
      accumulateUsage(totalUsage, batchResult.totalUsage)
    }

    // Clear batch IDs after processing
    progress = { ...progress, batchIds: [] }
    saveProgress(outputDir, progress)

    return { progress, architecture, totalUsage }
  }

  // Build batch requests — read each file from disk and prepare the user message
  const batchItems: Array<{ id: string; userMessage: string }> = []

  for (const filePath of pending) {
    try {
      const fullPath = path.resolve(scanRoot, filePath)
      const fileContent = fs.readFileSync(fullPath, 'utf-8')
      const depEdges = buildFilePromptContext(filePath, depGraph)

      let userMessage = `Analyze the following source file.\n\nFile path: ${filePath}\n\n`
      if (depEdges) {
        userMessage += `Dependencies (from static analysis):\n${depEdges}\n\n`
      }
      userMessage += `<source_file path="${filePath}">\n${fileContent}\n</source_file>`

      batchItems.push({ id: filePath, userMessage })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('File read failed, excluding from batch', {
        path: filePath,
        error_type: 'FileReadError',
        message,
      })
      progress = markFailed(progress, filePath, `FileReadError: ${message}`)
    }
  }

  if (batchItems.length === 0) {
    logger.info('No files to submit in batch')
    saveProgress(outputDir, progress)
    return { progress, architecture, totalUsage }
  }

  // Build a mapping from encoded custom_id → original file path
  // Anthropic custom_id only allows [a-zA-Z0-9_-]{1,64}
  const customIdToPath = new Map<string, string>()
  const encodedItems = batchItems.map((item) => {
    const encodedId = encodeCustomId(item.id)
    customIdToPath.set(encodedId, item.id)
    return { id: encodedId, userMessage: item.userMessage }
  })

  // Split into chunks of MAX_REQUESTS_PER_BATCH if needed
  const chunks: Array<Array<{ id: string; userMessage: string }>> = []
  for (let i = 0; i < encodedItems.length; i += MAX_REQUESTS_PER_BATCH) {
    chunks.push(encodedItems.slice(i, i + MAX_REQUESTS_PER_BATCH))
  }

  // Submit each chunk as a batch
  const batchIds: string[] = []
  for (const chunk of chunks) {
    const requests = buildBatchRequests('file', chunk, model, systemPrompt, maxTokens)

    const batchId = await submitBatch({
      client,
      requests: requests.map((r) => ({
        custom_id: r.custom_id,
        params: r.params as Anthropic.Messages.MessageCreateParamsNonStreaming,
      })),
      logger,
    })

    batchIds.push(batchId)
  }

  // Save batch IDs and the custom_id mapping for crash recovery
  progress = { ...progress, batchIds }
  saveProgress(outputDir, progress)
  // Save the mapping so crash recovery can decode custom_ids
  saveArtifact(outputDir, 'custom-id-map.json', Object.fromEntries(customIdToPath))

  // Poll and process each batch
  for (const batchId of batchIds) {
    const batchResult = await pollAndProcessBatch(
      client, batchId, model, progress, architecture, outputDir, logger, customIdToPath,
    )
    progress = batchResult.progress
    architecture = batchResult.architecture
    accumulateUsage(totalUsage, batchResult.totalUsage)
  }

  // Clear batch IDs
  progress = { ...progress, batchIds: [] }
  saveProgress(outputDir, progress)

  logger.info('File phase complete (batch mode)', {
    completedFiles: progress.completed.length,
    failedFiles: progress.failed.length,
    totalCostUsd: Math.round(totalUsage.costUsd * 1_000_000) / 1_000_000,
    totalInputTokens: totalUsage.inputTokens,
    totalOutputTokens: totalUsage.outputTokens,
  })

  return { progress, architecture, totalUsage }
}

async function pollAndProcessBatch(
  client: Anthropic,
  batchId: string,
  model: string,
  progress: ProgressState,
  architecture: Architecture,
  outputDir: string,
  logger: Logger,
  customIdToPath: Map<string, string>,
): Promise<{ progress: ProgressState; architecture: Architecture; totalUsage: AggregatedUsage }> {
  const totalUsage: AggregatedUsage = {
    inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0, costUsd: 0, callCount: 0,
  }

  // Poll until done
  await pollBatch(client, batchId, logger)

  // Retrieve results — saved to disk before processing (crash safety)
  const output = await retrieveAndSaveResults(client, batchId, model, outputDir, logger)

  // Process successful results
  for (const result of output.results) {
    // Decode custom_id back to the original file path
    const filePath = customIdToPath.get(result.customId) ?? result.customId

    const parsed = FileAnalysisSchema.safeParse(result.json)
    if (!parsed.success) {
      const zodError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      logger.error('Batch result Zod validation failed', {
        path: filePath,
        error_type: 'ZodParseError',
        zodError,
      })
      progress = markFailed(progress, filePath, `ZodParseError: ${zodError}`)
    } else {
      const fileAnalysis: FileAnalysis = {
        ...parsed.data,
        tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
      }
      architecture = { ...architecture, files: [...architecture.files, fileAnalysis] }
      progress = markCompleted(
        progress,
        filePath,
        result.usage.inputTokens + result.usage.outputTokens,
        0, // durationMs not available per-item in batch mode
      )
    }

    totalUsage.inputTokens += result.usage.inputTokens
    totalUsage.outputTokens += result.usage.outputTokens
    totalUsage.cacheReadInputTokens += result.usage.cacheReadInputTokens
    totalUsage.cacheCreationInputTokens += result.usage.cacheCreationInputTokens
    totalUsage.costUsd += result.usage.costUsd
    totalUsage.callCount += 1
  }

  // Process failures
  for (const failure of output.failures) {
    const filePath = customIdToPath.get(failure.customId) ?? failure.customId
    logger.error('Batch request failed', {
      path: filePath,
      error_type: 'BatchError',
      message: failure.error,
    })
    progress = markFailed(progress, filePath, `BatchError: ${failure.error}`)
  }

  // Checkpoint
  saveProgress(outputDir, progress)
  saveArtifact(outputDir, 'architecture.json', architecture)

  // Clean up temp results file — processing succeeded, no longer needed
  deleteCachedResults(batchId, outputDir)
  logger.debug('Batch results temp file cleaned up', { batchId })

  return { progress, architecture, totalUsage }
}

function accumulateUsage(target: AggregatedUsage, source: AggregatedUsage): void {
  target.inputTokens += source.inputTokens
  target.outputTokens += source.outputTokens
  target.cacheReadInputTokens += source.cacheReadInputTokens
  target.cacheCreationInputTokens += source.cacheCreationInputTokens
  target.costUsd += source.costUsd
  target.callCount += source.callCount
}

// --- Single file processing ---

export interface ProcessOneFileParams {
  client: Anthropic
  systemPrompt: string
  model: string
  maxTokens: number
  scanRoot: string
  outputDir: string
  progress: ProgressState
  architecture: Architecture
  depGraph: DependencyGraph | null
  logger: Logger
  filePath: string
}

interface ProcessOneFileResult {
  progress: ProgressState
  architecture: Architecture
  usage: UsageInfo | null
}

export async function processOneFile(params: ProcessOneFileParams): Promise<ProcessOneFileResult> {
  const { client, systemPrompt, model, maxTokens, scanRoot, filePath, depGraph, logger } = params
  let { progress, architecture } = params

  const startTime = Date.now()

  logger.debug('File analysis started', { path: filePath })

  // Read file content from disk
  let fileContent: string
  try {
    const fullPath = path.resolve(scanRoot, filePath)
    fileContent = fs.readFileSync(fullPath, 'utf-8')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('File analysis failed: cannot read file', { path: filePath, error_type: 'FileReadError', message })
    progress = markFailed(progress, filePath, `FileReadError: ${message}`)
    return { progress, architecture, usage: null }
  }

  // Extract dependency edges for this file
  const depEdges = buildFilePromptContext(filePath, depGraph)

  // Send to LLM
  let result: { json: unknown; usage: UsageInfo }
  try {
    result = await analyzeFile(client, {
      model,
      systemPrompt,
      filePath,
      fileContent,
      depEdges,
      maxTokens,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('File analysis failed: LLM provider error', {
      path: filePath,
      error_type: 'LlmError',
      message,
    })
    progress = markFailed(progress, filePath, `LlmError: ${message}`)
    return { progress, architecture, usage: null }
  }

  // Validate with Zod (belt and suspenders — structured output should guarantee valid JSON)
  const parsed = FileAnalysisSchema.safeParse(result.json)
  if (!parsed.success) {
    const zodError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    logger.error('File analysis failed: LLM output invalid', {
      path: filePath,
      error_type: 'ZodParseError',
      zodError,
      rawPreview: JSON.stringify(result.json).slice(0, 2000),
    })
    progress = markFailed(progress, filePath, `ZodParseError: ${zodError}`)
    return { progress, architecture, usage: result.usage }
  }

  // Enrich with tokensUsed from the API response
  const fileAnalysis: FileAnalysis = {
    ...parsed.data,
    tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
  }

  // Push into architecture.files[]
  architecture = {
    ...architecture,
    files: [...architecture.files, fileAnalysis],
  }

  const durationMs = Date.now() - startTime

  // Mark completed in progress
  progress = markCompleted(
    progress,
    filePath,
    result.usage.inputTokens + result.usage.outputTokens,
    durationMs,
  )

  logger.info('File analysis complete', {
    path: filePath,
    tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
    durationMs,
    costUsd: result.usage.costUsd,
  })

  return { progress, architecture, usage: result.usage }
}

// --- Dependency context extraction ---

export function buildFilePromptContext(filePath: string, depGraph: DependencyGraph | null): string {
  if (!depGraph) return ''

  const normalizedPath = filePath.replace(/\\/g, '/')
  const moduleEntry = depGraph.modules.find((m) => {
    const normalizedSource = m.source.replace(/\\/g, '/')
    return normalizedSource === normalizedPath || normalizedSource.endsWith(`/${normalizedPath}`)
  })

  if (!moduleEntry || moduleEntry.dependencies.length === 0) return ''

  return moduleEntry.dependencies
    .map((dep) => `→ ${dep.resolved}`)
    .join('\n')
}
