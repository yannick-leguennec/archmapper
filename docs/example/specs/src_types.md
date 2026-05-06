# Module: src/types

## Purpose
Defines the canonical domain types and runtime validation schemas for the architectural analysis system. It serves as the single source of truth for data shapes (FileAnalysis, ModuleAnalysis, Architecture) used throughout the codebase, providing both Zod schemas for runtime validation and inferred TypeScript types for static type safety. If deleted, all modules depending on these shared type definitions and validation schemas would break.

## Public API
- `FileAnalysisSchema`
- `ModuleAnalysisSchema`
- `ArchitectureSchema`
- `FileAnalysis`
- `ModuleAnalysis`
- `Architecture`

## Design Patterns
- shared-library
- flat-structure

## Cross-Cutting Concerns
- validation

## Children
- src/types/schema.ts
