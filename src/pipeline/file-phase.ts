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
import { analyzeFile } from '../llm-client'
import { markCompleted, markFailed, saveProgress } from './progress'
import { saveArtifact } from './static-analysis'

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

  logger.info('File phase started', {
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
