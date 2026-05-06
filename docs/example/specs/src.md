# Module: src

## Purpose
Root source module for an automated architecture analysis system that processes codebases bottom-up using LLM-driven analysis. It provides configuration loading, structured logging, Anthropic API integration (single-request and batch), canonical domain types with runtime validation, and a multi-phase pipeline that builds file trees, analyzes individual files, and synthesizes folder-level module summaries. If deleted, the entire application ceases to function—no configuration, no LLM calls, no analysis pipeline, and no shared type definitions would exist.

## Public API
- `config`
- `loadConfig`
- `validateProjectName`
- `createRootLogger`
- `Logger`
- `LogLevel`
- `LogEntry`
- `createLlmClient`
- `analyzeFile`
- `synthesizeModule`
- `buildBatchRequests`
- `trackUsage`
- `getJsonSchema`
- `AnalysisKind`
- `LlmResult`
- `UsageInfo`
- `BatchRequestItem`
- `AnalyzeFileParams`
- `SynthesizeModuleParams`
- `submitBatch`
- `pollBatch`
- `retrieveAndSaveResults`
- `deleteCachedResults`
- `encodeCustomId`
- `decodeCustomId`
- `MAX_REQUESTS_PER_BATCH`
- `BatchSubmitParams`
- `BatchResult`
- `BatchFailure`
- `BatchOutput`
- `PollOptions`
- `FileAnalysisSchema`
- `ModuleAnalysisSchema`
- `ArchitectureSchema`
- `FileAnalysis`
- `ModuleAnalysis`
- `Architecture`
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
- `runFilePhase`
- `processOneFile`
- `buildFilePromptContext`
- `computeWaves`
- `gatherChildContext`
- `runModuleSynthesis`
- `processOneModule`
- `PipelinePhase`
- `ProgressState`
- `computeStats`
- `createFreshProgress`
- `markCompleted`
- `markFailed`
- `saveProgress`
- `loadProgress`

## Design Patterns
- layered-architecture
- feature-module
- shared-library

## Cross-Cutting Concerns
- logging
- configuration
- validation
- error-handling
- caching

## Children
- src/logger.ts
- src/config.ts
- src/config.loader.ts
- src/llm-client.ts
- src/batch-client.ts
- src/pipeline
- src/types

## Notes
Configuration is split across config.ts (eager singleton with dotenv side-effect) and config.loader.ts (pure logic for testability). The LLM integration is split between llm-client.ts (single synchronous API calls) and batch-client.ts (batch lifecycle with polling and disk-based crash-safety caching), both targeting the Anthropic API but serving different execution strategies. The types submodule acts as a shared-library providing Zod-validated domain types consumed across all other modules.
