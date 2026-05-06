/**
 * ArchMapper orchestrator — the CLI entry point.
 *
 * Runs the full reverse-engineering pipeline in order:
 *   1. Load config + create tools
 *   2. Load or create progress checkpoint
 *   3. Static analysis (dree + dependency-cruiser)
 *   4. File phase (analyze every file with Sonnet)
 *   5. Module synthesis (bottom-up folder waves with Opus)
 *   6. Generate spec cards + print cost summary
 *
 * Supports:
 *   --force          Start completely fresh (delete existing progress)
 *   --retry-failed   Move failed items back to pending for retry
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import { config } from '../src/config'
import { createRootLogger } from '../src/logger'
import { createLlmClient } from '../src/llm-client'
import {
  createFreshProgress,
  loadProgress,
  saveProgress,
} from '../src/pipeline/progress'
import {
  buildFileTree,
  buildDependencyGraph,
  extractFilePaths,
  saveArtifact,
  loadArtifact,
} from '../src/pipeline/static-analysis'
import { runFilePhase } from '../src/pipeline/file-phase'
import { computeWaves, runModuleSynthesis } from '../src/pipeline/folder-waves'

import type { ProgressState } from '../src/pipeline/progress'
import type { Architecture } from '../src/types/schema'
import type { TreeNode, DependencyGraph } from '../src/pipeline/static-analysis'
import type { AggregatedUsage } from '../src/pipeline/file-phase'

// --- CLI flags ---

const args = process.argv.slice(2)
const forceFlag = args.includes('--force')
const retryFailedFlag = args.includes('--retry-failed')

// --- Main ---

async function main(): Promise<void> {
  const logger = createRootLogger(config.nodeEnv, config.logLevel)
  const startTime = Date.now()

  logger.info('ArchMapper started', {
    projectName: config.projectName,
    scanRoot: config.scanRoot,
    fileModel: config.fileModel,
    synthesisModel: config.synthesisModel,
    force: forceFlag,
    retryFailed: retryFailedFlag,
  })

  // --- Validate scan root exists ---
  const scanRootResolved = path.resolve(config.scanRoot)
  if (!fs.existsSync(scanRootResolved)) {
    logger.critical('SCAN_ROOT does not exist', { scanRoot: scanRootResolved })
    process.exit(1)
  }

  // --- Output directory ---
  const outputDir = path.join('architecture', config.projectName)
  fs.mkdirSync(outputDir, { recursive: true })

  // --- LLM client ---
  const client = createLlmClient(config.anthropicApiKey)

  // --- Load prompts ---
  const filePromptPath = path.resolve('prompts/file-analysis.md')
  const modulePromptPath = path.resolve('prompts/module-synthesis.md')

  if (!fs.existsSync(filePromptPath) || !fs.existsSync(modulePromptPath)) {
    logger.critical('Prompt files not found', {
      filePrompt: filePromptPath,
      modulePrompt: modulePromptPath,
    })
    process.exit(1)
  }

  const fileSystemPrompt = fs.readFileSync(filePromptPath, 'utf-8')
  const moduleSystemPrompt = fs.readFileSync(modulePromptPath, 'utf-8')

  // --- Load or create progress ---
  let progress: ProgressState | null = null

  if (forceFlag) {
    logger.info('--force: starting fresh run')
    progress = null
  } else {
    progress = loadProgress(outputDir)
  }

  // --- Handle --retry-failed (must come BEFORE the "already done" check) ---
  if (progress && retryFailedFlag && progress.failed.length > 0) {
    const retryCount = progress.failed.length
    const retryPaths = progress.failed.map((f) => f.path)
    logger.info('--retry-failed: moving failed items back to pending', { count: retryCount })
    progress = {
      ...progress,
      phase: 'module-synthesis',  // re-enter module synthesis phase
      pending: [...progress.pending, ...retryPaths],
      failed: [],
      lastUpdatedAt: new Date().toISOString(),
    }
    saveProgress(outputDir, progress)
  }

  if (progress && progress.phase === 'done' && !forceFlag) {
    logger.info('Pipeline already complete. Use --force to re-run.', {
      completedFiles: progress.completed.length,
      failedFiles: progress.failed.length,
    })
    printCompletionSummary(progress)
    return
  }

  if (!progress) {
    progress = createFreshProgress(config.projectName, config.scanRoot)
    saveProgress(outputDir, progress)
  }

  // --- Architecture object (load existing or create fresh) ---
  let architecture: Architecture = loadArtifact<Architecture>(outputDir, 'architecture.json') ?? {
    schemaVersion: '1.0',
    projectName: config.projectName,
    fileModel: config.fileModel,
    synthesisModel: config.synthesisModel,
    generatedAt: new Date().toISOString(),
    files: [],
    modules: [],
    summary: '',
    designPatterns: [],
  }

  // --- Phase tracking for usage ---
  let fileUsage: AggregatedUsage = createEmptyUsage()
  let moduleUsage: AggregatedUsage = createEmptyUsage()

  // ============================
  // PHASE 1: Static Analysis
  // ============================

  let tree: TreeNode
  let depGraph: DependencyGraph | null = null

  if (progress.phase === 'static-analysis') {
    logger.info('Phase: static-analysis')

    // Build file tree
    const existingTree = forceFlag ? null : loadArtifact<TreeNode>(outputDir, 'raw-tree.json')
    if (existingTree) {
      logger.info('File tree loaded from disk (cached)')
      tree = existingTree
    } else {
      logger.info('Building file tree with dree', { scanRoot: scanRootResolved })
      tree = buildFileTree(scanRootResolved, { exclude: config.excludePatterns })
      saveArtifact(outputDir, 'raw-tree.json', tree)
      logger.info('File tree saved', { outputDir })
    }

    // Build dependency graph (optional)
    const existingGraph = forceFlag ? null : loadArtifact<DependencyGraph>(outputDir, 'dep-graph.json')
    if (existingGraph) {
      logger.info('Dependency graph loaded from disk (cached)')
      depGraph = existingGraph
    } else {
      logger.info('Building dependency graph with dependency-cruiser')
      depGraph = buildDependencyGraph(scanRootResolved)
      if (depGraph) {
        saveArtifact(outputDir, 'dep-graph.json', depGraph)
        logger.info('Dependency graph saved')
      } else {
        logger.warning('Dependency graph unavailable (dependency-cruiser not installed or failed). Continuing without it.')
      }
    }

    // Extract file paths → set as pending
    // Separate directory excludes from file-suffix excludes
    // Directory patterns: "node_modules", "dist", "vendor", "test", etc.
    // File suffixes: ".test.ts", ".spec.ts", ".test.tsx", ".spec.tsx", etc.
    const excludeSuffixes = config.excludePatterns.filter((p) => p.startsWith('.'))
    const filePaths = extractFilePaths(tree, excludeSuffixes.length > 0 ? excludeSuffixes : undefined)
    logger.info('Files to analyze', { count: filePaths.length, excludedSuffixes: excludeSuffixes })

    progress = {
      ...progress,
      phase: 'file-analysis',
      pending: filePaths,
      lastUpdatedAt: new Date().toISOString(),
    }
    saveProgress(outputDir, progress)
  } else {
    // Load tree from disk (needed for module synthesis even when resuming)
    tree = loadArtifact<TreeNode>(outputDir, 'raw-tree.json')!
    depGraph = loadArtifact<DependencyGraph>(outputDir, 'dep-graph.json')

    if (!tree) {
      logger.critical('Cannot resume: raw-tree.json not found. Re-run with --force.')
      process.exit(1)
    }
  }

  // ============================
  // PHASE 2: File Analysis
  // ============================

  if (progress.phase === 'file-analysis') {
    logger.info('Phase: file-analysis', { pendingFiles: progress.pending.length })

    const fileResult = await runFilePhase({
      client,
      systemPrompt: fileSystemPrompt,
      model: config.fileModel,
      maxTokens: config.maxTokens,
      scanRoot: scanRootResolved,
      outputDir,
      progress,
      architecture,
      depGraph,
      logger,
      useBatches: config.useBatches,
    })

    progress = {
      ...fileResult.progress,
      phase: 'module-synthesis',
      // Set all folder paths as pending for the module phase
      pending: computeWaves(tree).flatMap((w) => w.folders),
      lastUpdatedAt: new Date().toISOString(),
    }
    architecture = fileResult.architecture
    fileUsage = fileResult.totalUsage

    saveProgress(outputDir, progress)
    saveArtifact(outputDir, 'architecture.json', architecture)
  }

  // ============================
  // PHASE 3: Module Synthesis
  // ============================

  if (progress.phase === 'module-synthesis') {
    logger.info('Phase: module-synthesis', { pendingFolders: progress.pending.length })

    const moduleResult = await runModuleSynthesis({
      client,
      systemPrompt: moduleSystemPrompt,
      model: config.synthesisModel,
      maxTokens: config.maxTokens,
      outputDir,
      progress,
      architecture,
      tree,
      logger,
    })

    progress = {
      ...moduleResult.progress,
      phase: 'done',
      currentItem: null,
      lastUpdatedAt: new Date().toISOString(),
    }
    architecture = moduleResult.architecture
    moduleUsage = moduleResult.totalUsage

    saveProgress(outputDir, progress)
  }

  // ============================
  // FINAL: Generate outputs
  // ============================

  // Update architecture with final metadata
  architecture = {
    ...architecture,
    generatedAt: new Date().toISOString(),
    summary: architecture.summary || generateDefaultSummary(architecture),
  }
  saveArtifact(outputDir, 'architecture.json', architecture)

  // Generate spec cards
  generateSpecCards(outputDir, architecture)

  const durationMs = Date.now() - startTime

  // Print cost summary
  printCostSummary(fileUsage, moduleUsage, durationMs, progress)

  logger.info('ArchMapper complete', {
    projectName: config.projectName,
    outputDir,
    durationMs,
  })
}

// --- Spec card generation ---

export function generateSpecCards(outputDir: string, architecture: Architecture): void {
  const specsDir = path.join(outputDir, 'specs')
  fs.mkdirSync(specsDir, { recursive: true })

  for (const mod of architecture.modules) {
    const safeName = mod.path === '.' ? 'root' : mod.path.replace(/\//g, '_')
    const fileName = `${safeName}.md`

    const lines: string[] = [
      `# Module: ${mod.path}`,
      '',
      '## Purpose',
      mod.purpose,
      '',
    ]

    if (mod.publicApi.length > 0) {
      lines.push('## Public API')
      for (const api of mod.publicApi) {
        lines.push(`- \`${api}\``)
      }
      lines.push('')
    }

    if (mod.patterns.length > 0) {
      lines.push('## Design Patterns')
      for (const pattern of mod.patterns) {
        lines.push(`- ${pattern}`)
      }
      lines.push('')
    }

    if (mod.crossCuttingConcerns.length > 0) {
      lines.push('## Cross-Cutting Concerns')
      for (const concern of mod.crossCuttingConcerns) {
        lines.push(`- ${concern}`)
      }
      lines.push('')
    }

    if (mod.children.length > 0) {
      lines.push('## Children')
      for (const child of mod.children) {
        lines.push(`- ${child}`)
      }
      lines.push('')
    }

    if (mod.notes) {
      lines.push('## Notes')
      lines.push(mod.notes)
      lines.push('')
    }

    fs.writeFileSync(path.join(specsDir, fileName), lines.join('\n'), 'utf-8')
  }
}

// --- Cost summary ---

export function printCostSummary(
  fileUsage: AggregatedUsage,
  moduleUsage: AggregatedUsage,
  durationMs: number,
  progress: ProgressState,
): void {
  const totalCost = fileUsage.costUsd + moduleUsage.costUsd
  const durationMin = Math.round(durationMs / 60_000 * 10) / 10

  const summary = `
════════════════════════════════════════════════════════
  ArchMapper — Run Complete
════════════════════════════════════════════════════════

  Project:     ${progress.projectName}
  Duration:    ${durationMin} minutes

  Files:       ${progress.stats.completedFiles} analyzed, ${progress.stats.failedFiles} failed
  Folders:     ${moduleUsage.callCount} synthesized

  ── Cost Breakdown ──

  File phase (Sonnet):
    Calls:     ${fileUsage.callCount}
    Input:     ${formatTokens(fileUsage.inputTokens)} tokens
    Output:    ${formatTokens(fileUsage.outputTokens)} tokens
    Cached:    ${formatTokens(fileUsage.cacheReadInputTokens)} tokens (90% discount)
    Cost:      $${fileUsage.costUsd.toFixed(4)}

  Module phase (Opus):
    Calls:     ${moduleUsage.callCount}
    Input:     ${formatTokens(moduleUsage.inputTokens)} tokens
    Output:    ${formatTokens(moduleUsage.outputTokens)} tokens
    Cached:    ${formatTokens(moduleUsage.cacheReadInputTokens)} tokens (90% discount)
    Cost:      $${moduleUsage.costUsd.toFixed(4)}

  ── Total ──
    Cost:      $${totalCost.toFixed(4)}

════════════════════════════════════════════════════════
`

  process.stdout.write(summary)
}

// --- Helpers ---

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

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

function generateDefaultSummary(architecture: Architecture): string {
  const fileCount = architecture.files.length
  const moduleCount = architecture.modules.length
  const allPatterns = [...new Set(architecture.files.flatMap((f) => f.patterns))]
  const topPatterns = allPatterns.slice(0, 5).join(', ')

  return (
    `This project contains ${fileCount} analyzed files organized into ${moduleCount} modules. ` +
    (topPatterns ? `Common design patterns include: ${topPatterns}.` : 'No recurring design patterns were identified.')
  )
}

function printCompletionSummary(progress: ProgressState): void {
  process.stdout.write(
    `\nPipeline already complete.\n` +
    `  Completed: ${progress.stats.completedFiles} files\n` +
    `  Failed:    ${progress.stats.failedFiles} files\n` +
    `  Use --force to re-run from scratch.\n` +
    `  Use --retry-failed to retry failed items.\n\n`
  )
}

// --- Run ---
//
// Only invoke main() when this file is the CLI entry point.
// When imported by a test or another module, importers can call the exports
// directly without triggering a full pipeline run on module load.

const invokedAsCli =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedAsCli) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`\nFatal error: ${message}\n`)
    process.exit(1)
  })
}
