# Module: .

## Purpose
Root of "archmapper", a Node.js CLI tool that performs fully automated, resumable, bottom-up reverse-engineering of codebases using LLM-driven analysis. The project orchestrates a three-phase pipeline (file tree building → individual file analysis → folder-level module synthesis) to produce architectural spec cards, cost summaries, and structured analysis artifacts. It relies on the Anthropic API for LLM integration, supports batch processing, and provides resilience through progress checkpointing and artifact caching. If this root were deleted, the entire archmapper tool—CLI entry point, analysis engine, configuration, logging, domain types, and pipeline orchestration—would be completely removed.

## Public API
- `generateSpecCards`
- `printCostSummary`
- `config`
- `loadConfig`
- `validateProjectName`
- `createRootLogger`
- `Logger`
- `createLlmClient`
- `analyzeFile`
- `synthesizeModule`
- `buildBatchRequests`
- `trackUsage`
- `submitBatch`
- `pollBatch`
- `retrieveAndSaveResults`
- `deleteCachedResults`
- `encodeCustomId`
- `decodeCustomId`
- `FileAnalysis`
- `ModuleAnalysis`
- `Architecture`
- `TreeNode`
- `DependencyEdge`
- `DependencyGraph`
- `FileAnalysisSchema`
- `ModuleAnalysisSchema`
- `ArchitectureSchema`
- `buildFileTree`
- `buildDependencyGraph`
- `extractFilePaths`
- `getLeafFolders`
- `runFilePhase`
- `runModuleSynthesis`
- `computeWaves`
- `gatherChildContext`
- `PipelinePhase`
- `ProgressState`
- `computeStats`
- `createFreshProgress`
- `markCompleted`
- `markFailed`
- `saveProgress`
- `loadProgress`
- `saveArtifact`
- `loadArtifact`

## Design Patterns
- layered-architecture
- feature-module
- barrel-reexport

## Cross-Cutting Concerns
- logging
- configuration
- validation
- error-handling
- caching

## Children
- package.json
- tsconfig.json
- vitest.config.ts
- scripts
- src

## Notes
The project is structured as a two-layer system: `src` provides the core library (config, LLM clients, domain types, pipeline phases, progress tracking) while `scripts` serves as the thin CLI orchestration layer that composes `src` modules into the end-to-end analysis pipeline. The ESM-only module system with Node >=20 requirement and ES2022 target reflects a modern runtime baseline. The maximally strict TypeScript configuration (noUncheckedIndexedAccess, exactOptionalPropertyTypes) suggests high emphasis on type safety for the LLM response parsing and schema validation paths.
