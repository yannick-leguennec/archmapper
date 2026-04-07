/**
 * Folder-wave runner — bottom-up module synthesis.
 *
 * After the file phase has analyzed every file, this module:
 *   1. Computes wave order (leaves first, parents after their children)
 *   2. For each wave, synthesizes every folder by sending child summaries to Opus
 *   3. Validates with Zod, inserts into architecture.modules[], checkpoints
 *
 * Does NOT: analyze files, create the LLM client, or build the tree.
 */

import { ModuleAnalysisSchema } from '../types/schema'
import { synthesizeModule } from '../llm-client'
import { markCompleted, markFailed, saveProgress } from './progress'
import { saveArtifact } from './static-analysis'

import type Anthropic from '@anthropic-ai/sdk'
import type { UsageInfo } from '../llm-client'
import type { ModuleAnalysis, Architecture, FileAnalysis } from '../types/schema'
import type { ProgressState } from './progress'
import type { TreeNode } from './static-analysis'
import type { Logger } from '../logger'
import type { AggregatedUsage } from './file-phase'

// --- Types ---

export interface Wave {
  wave: number
  folders: string[]
}

export interface ModuleSynthesisParams {
  client: Anthropic
  systemPrompt: string
  model: string
  maxTokens: number
  outputDir: string
  progress: ProgressState
  architecture: Architecture
  tree: TreeNode
  logger: Logger
}

export interface ModuleSynthesisResult {
  progress: ProgressState
  architecture: Architecture
  totalUsage: AggregatedUsage
}

// --- Wave computation ---

export function computeWaves(tree: TreeNode): Wave[] {
  // Collect all directories and their immediate subdirectory children
  const folderChildren = new Map<string, string[]>()
  collectFolders(tree, folderChildren)

  if (folderChildren.size === 0) return []

  const assigned = new Map<string, number>()
  const waves: Wave[] = []

  // Iteratively assign waves: a folder goes into wave N when all its
  // subfolder children are already assigned to waves < N
  let changed = true
  while (changed) {
    changed = false
    for (const [folder, children] of folderChildren) {
      if (assigned.has(folder)) continue

      const childDirs = children.filter((c) => folderChildren.has(c))

      // Can assign if all child directories are already assigned
      const allChildrenAssigned = childDirs.every((c) => assigned.has(c))
      if (!allChildrenAssigned) continue

      const waveNum = childDirs.length === 0
        ? 0
        : Math.max(...childDirs.map((c) => assigned.get(c)!)) + 1

      assigned.set(folder, waveNum)
      changed = true
    }
  }

  // Group by wave number
  const waveMap = new Map<number, string[]>()
  for (const [folder, waveNum] of assigned) {
    const list = waveMap.get(waveNum) ?? []
    list.push(folder)
    waveMap.set(waveNum, list)
  }

  // Sort waves by number, and folders within each wave alphabetically
  const waveNumbers = [...waveMap.keys()].sort((a, b) => a - b)
  for (const num of waveNumbers) {
    waves.push({ wave: num, folders: waveMap.get(num)!.sort() })
  }

  return waves
}

function collectFolders(node: TreeNode, result: Map<string, string[]>): void {
  if (node.type !== 'directory') return

  const childDirPaths: string[] = []
  if (node.children) {
    for (const child of node.children) {
      if (child.type === 'directory') {
        childDirPaths.push(child.relativePath)
        collectFolders(child, result)
      }
    }
  }

  result.set(node.relativePath, childDirPaths)
}

// --- Child context gathering ---

export function gatherChildContext(
  folderPath: string,
  architecture: Architecture,
): string {
  const normalizedFolder = folderPath === '.' ? '' : folderPath

  // Find direct child FILES (in this folder, not in subfolders)
  const childFiles = architecture.files.filter((f) => {
    const fileDirRaw = f.path.substring(0, f.path.lastIndexOf('/'))
    const fileDir = fileDirRaw || ''
    return fileDir === normalizedFolder
  })

  // Find direct child MODULES (subfolders of this folder)
  const childModules = architecture.modules.filter((m) => {
    if (normalizedFolder === '') {
      // Root: direct children are paths with no '/' in them
      return !m.path.includes('/')
    }
    // Non-root: path starts with folder/ and has no further / after that
    const prefix = normalizedFolder + '/'
    if (!m.path.startsWith(prefix)) return false
    const remainder = m.path.substring(prefix.length)
    return !remainder.includes('/')
  })

  const parts: string[] = []

  if (childFiles.length > 0) {
    parts.push('Files in this folder:')
    for (const f of childFiles) {
      const exports = f.exports.length > 0 ? ` Exports: ${f.exports.join(', ')}.` : ''
      const abstractions = f.keyAbstractions.length > 0
        ? ` Key abstractions: ${f.keyAbstractions.join(', ')}.`
        : ''
      parts.push(`- ${f.path}: ${f.purpose}${exports}${abstractions}`)
    }
  }

  if (childModules.length > 0) {
    if (parts.length > 0) parts.push('')
    parts.push('Submodules:')
    for (const m of childModules) {
      const api = m.publicApi.length > 0 ? ` Public API: ${m.publicApi.join(', ')}.` : ''
      const concerns = m.crossCuttingConcerns.length > 0
        ? ` Cross-cutting: ${m.crossCuttingConcerns.join(', ')}.`
        : ''
      parts.push(`- ${m.path}: ${m.purpose}${api}${concerns}`)
    }
  }

  return parts.join('\n')
}

// --- Main entry point ---

export async function runModuleSynthesis(params: ModuleSynthesisParams): Promise<ModuleSynthesisResult> {
  const { tree, logger, outputDir } = params
  let { progress, architecture } = params

  const totalUsage: AggregatedUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
    callCount: 0,
  }

  const waves = computeWaves(tree)

  logger.info('Module synthesis started', {
    totalWaves: waves.length,
    totalFolders: waves.reduce((sum, w) => sum + w.folders.length, 0),
  })

  for (const wave of waves) {
    logger.info('Processing wave', {
      wave: wave.wave,
      folderCount: wave.folders.length,
      folders: wave.folders,
    })

    for (const folderPath of wave.folders) {
      // Skip if already completed (resume support)
      const alreadyDone = progress.completed.some((c) => c.path === folderPath)
      if (alreadyDone) {
        logger.debug('Module synthesis skipped: already completed', { path: folderPath })
        continue
      }

      progress = { ...progress, currentItem: folderPath }

      const result = await processOneModule({
        ...params,
        progress,
        architecture,
        folderPath,
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

      // Checkpoint after every folder
      saveProgress(outputDir, progress)
      saveArtifact(outputDir, 'architecture.json', architecture)
    }
  }

  logger.info('Module synthesis complete', {
    totalFolders: waves.reduce((sum, w) => sum + w.folders.length, 0),
    totalCostUsd: Math.round(totalUsage.costUsd * 1_000_000) / 1_000_000,
    totalInputTokens: totalUsage.inputTokens,
    totalOutputTokens: totalUsage.outputTokens,
  })

  return { progress, architecture, totalUsage }
}

// --- Single module processing ---

export interface ProcessOneModuleParams {
  client: Anthropic
  systemPrompt: string
  model: string
  maxTokens: number
  outputDir: string
  progress: ProgressState
  architecture: Architecture
  logger: Logger
  folderPath: string
}

interface ProcessOneModuleResult {
  progress: ProgressState
  architecture: Architecture
  usage: UsageInfo | null
}

export async function processOneModule(params: ProcessOneModuleParams): Promise<ProcessOneModuleResult> {
  const { client, systemPrompt, model, maxTokens, folderPath, logger } = params
  let { progress, architecture } = params

  const startTime = Date.now()

  logger.debug('Module synthesis started', { path: folderPath })

  // Gather child summaries from already-analyzed files and modules
  const childSummaries = gatherChildContext(folderPath, architecture)

  if (!childSummaries) {
    logger.warning('Module synthesis skipped: no analyzed children found', { path: folderPath })
    progress = markFailed(progress, folderPath, 'NoChildren: no analyzed children found for this folder')
    return { progress, architecture, usage: null }
  }

  // Send to LLM (Opus)
  let result: { json: unknown; usage: UsageInfo }
  try {
    result = await synthesizeModule(client, {
      model,
      systemPrompt,
      folderPath,
      childSummaries,
      maxTokens,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Module synthesis failed: LLM provider error', {
      path: folderPath,
      error_type: 'LlmError',
      message,
    })
    progress = markFailed(progress, folderPath, `LlmError: ${message}`)
    return { progress, architecture, usage: null }
  }

  // Validate with Zod
  const parsed = ModuleAnalysisSchema.safeParse(result.json)
  if (!parsed.success) {
    const zodError = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    logger.error('Module synthesis failed: LLM output invalid', {
      path: folderPath,
      error_type: 'ZodParseError',
      zodError,
      rawPreview: JSON.stringify(result.json).slice(0, 2000),
    })
    progress = markFailed(progress, folderPath, `ZodParseError: ${zodError}`)
    return { progress, architecture, usage: result.usage }
  }

  // Enrich with tokensUsed
  const moduleAnalysis: ModuleAnalysis = {
    ...parsed.data,
    tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
  }

  // Push into architecture.modules[]
  architecture = {
    ...architecture,
    modules: [...architecture.modules, moduleAnalysis],
  }

  const durationMs = Date.now() - startTime

  // Mark completed in progress
  progress = markCompleted(
    progress,
    folderPath,
    result.usage.inputTokens + result.usage.outputTokens,
    durationMs,
  )

  logger.info('Module synthesis complete', {
    path: folderPath,
    tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
    durationMs,
    costUsd: result.usage.costUsd,
  })

  return { progress, architecture, usage: result.usage }
}
