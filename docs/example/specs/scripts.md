# Module: scripts

## Purpose
Top-level scripts folder containing the CLI entry point for the ArchMapper reverse-engineering tool. It orchestrates a complete three-phase pipeline (static analysis → file analysis → module synthesis) that uses LLM clients to analyze codebases, manages progress checkpointing and artifact caching for resilience, and produces Markdown spec cards and cost/token-usage summaries. If this folder were deleted, the entire ArchMapper CLI tool would cease to function — no analysis pipelines could be initiated, no spec cards generated, and no cost reporting would be available.

## Public API
- `generateSpecCards`
- `printCostSummary`

## Design Patterns
- flat-structure

## Cross-Cutting Concerns
- caching
- logging
- configuration

## Children
- scripts/orchestrator.ts

## Notes
Currently a single-file module acting as both CLI entry point and pipeline orchestrator. As the tool grows, the orchestrator could be split into separate concerns: CLI argument parsing, pipeline coordination, checkpoint/resume logic, and reporting/output generation.
