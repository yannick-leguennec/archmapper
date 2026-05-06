# Module: src/pipeline

## Purpose
Implements the multi-phase architecture analysis pipeline that processes a codebase bottom-up. It performs static analysis (file tree construction, dependency graph extraction), per-file LLM-driven analysis with crash-recovery and checkpointing, bottom-up folder-wave synthesis (topological leaf-to-root module summarization), and persistent progress tracking across all phases. Without this module, no automated architecture extraction or LLM-based code analysis would function.

## Public API
- `TreeNode`
- `DependencyEdge`
- `DependencyGraph`
- `BuildOptions`
- `saveArtifact`
- `loadArtifact`
- `buildFileTree`
- `buildDependencyGraph`
- `extractFilePaths`
- `getLeafFolders`
- `FilePhaseParams`
- `FilePhaseResult`
- `AggregatedUsage`
- `runFilePhase`
- `ProcessOneFileParams`
- `processOneFile`
- `buildFilePromptContext`
- `Wave`
- `ModuleSynthesisParams`
- `ModuleSynthesisResult`
- `ProcessOneModuleParams`
- `computeWaves`
- `gatherChildContext`
- `runModuleSynthesis`
- `processOneModule`
- `PipelinePhase`
- `CompletedItem`
- `FailedItem`
- `ProgressStats`
- `ProgressState`
- `computeStats`
- `createFreshProgress`
- `markCompleted`
- `markFailed`
- `saveProgress`
- `loadProgress`

## Design Patterns
- layered-architecture
- flat-structure

## Cross-Cutting Concerns
- error-handling
- validation
- caching

## Children
- src/pipeline/static-analysis.ts
- src/pipeline/file-phase.ts
- src/pipeline/folder-waves.ts
- src/pipeline/progress.ts

## Notes
The pipeline follows a clear phase ordering: static-analysis → file-phase → folder-waves, with progress.ts providing cross-phase checkpointing and crash-recovery. The file-phase supports both synchronous and Anthropic batch API modes. All phases share a mutable Architecture accumulator threaded through processing steps. The folder lacks a barrel index, so all child exports are directly consumed by the orchestration layer above.
