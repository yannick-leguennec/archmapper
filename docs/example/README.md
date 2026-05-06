# Example: ArchMapper analyzed by ArchMapper

This directory is the actual output of running ArchMapper on its own source code. It exists as a concrete reference for new users — *this is what your own `architecture/<PROJECT_NAME>/` directory will look like* after a successful `npm run analyze`.

## How this example was generated

```bash
# From the archmapper repo root, with .env populated:
mkdir -p project/archmapper-self
cp -r src scripts tests package.json tsconfig.json vitest.config.ts \
      project/archmapper-self/

SCAN_ROOT=project/archmapper-self \
PROJECT_NAME=archmapper_self \
USE_BATCHES=true \
npm run analyze

# Output landed in architecture/archmapper_self/. The contents were copied
# to this docs/example/ directory and the source copy under
# project/archmapper-self/ was deleted.
```

**Run parameters:**
- File model: `claude-sonnet-4-6` (project default)
- Synthesis model: `claude-opus-4-6` (the `.env` of the operator who ran this; the project's published default is now `claude-opus-4-7`)
- Batch mode enabled (50% per-request discount)
- Default `EXCLUDE_PATTERNS` augmented locally with `.test.ts`, `.spec.ts` (test files were not analyzed)

**Run cost:** $0.34 (file phase $0.22, module synthesis $0.12), 3 minutes wall-clock with batches.

## What's in this directory

| File | What it is |
|---|---|
| `architecture.json` | Complete merged analysis. Every analyzed file appears in `files[]`, every analyzed folder appears in `modules[]`. Includes a top-level `summary` and `topPatterns`. **This is the file you would feed back to an LLM as architectural context.** |
| `raw-tree.json` | The file/folder structure produced by [dree](https://www.npmjs.com/package/dree) before any LLM analysis. Useful for understanding what the pipeline started from. |
| `progress.json` | The resumability checkpoint. Shows which items completed, which failed, and the final phase (`done` for a successful run). |
| `custom-id-map.json` | Internal mapping between Anthropic batch `custom_id`s and file paths — used by the resumable batch client. |
| `specs/` | One Markdown spec card per analyzed module: `root.md`, `src.md`, `src_pipeline.md`, `src_types.md`, `scripts.md`. Easier for humans to read than the JSON. |

## How to read this output

For the field-by-field semantics and recommended reading order, see [`standards/analysis/reading-architecture.md`](../../standards/analysis/reading-architecture.md). The short version:

1. Open `specs/src.md` for the project-level overview.
2. Drill down via the per-module spec cards — one per directory under `src/`.
3. For per-file detail (purpose, exports, imports, design patterns, key abstractions), look the file up in `architecture.json → files[]`.

Two ways this output is typically consumed:

- **Paste `architecture.json` into a Claude conversation** and ask architectural questions — *"which modules carry the most cross-cutting concerns?"*, *"what would I need to touch to add feature X?"*. The bottom-up wave methodology grounds every level in verified facts, so the model answers with specificity rather than guessing.
- **Hand `architecture.json` to an autonomous coding agent** before it acts on the codebase. The agent gets a structural map up front, which dramatically reduces hallucinated imports and incorrect cross-references.

## What the "5 failed" entries in `progress.json` mean

`progress.json` records 5 failed module-synthesis entries:

```
tests/integration       → NoChildren: no analyzed children found for this folder
tests/unit/pipeline     → NoChildren
tests/unit/types        → NoChildren
tests/unit              → NoChildren
tests                   → NoChildren
```

These are not real failures. The `.env` used for this run had `EXCLUDE_PATTERNS` set to skip `.test.ts` and `.spec.ts` suffixes, so test files were never analyzed in the file phase. When the module-synthesis phase reached the `tests/` subdirectories, it found no analyzed children to synthesize and skipped them with `NoChildren`. This is expected behavior whenever you exclude an entire file class via `EXCLUDE_PATTERNS`.

If you want a clean run with no `NoChildren` entries, either remove the test-suffix excludes or set `SCAN_ROOT` to a subdirectory that does not contain test files.

## Notes on this specific run

- ArchMapper happens to be a small TypeScript project (~14 source files in `src/` and `scripts/`), so the analysis is compact. The same pipeline scales to repositories of 10,000+ files; the JSON simply gets longer.
- Each file's `purpose` is bounded to 2–4 sentences. Folder-level `purpose` strings are synthesized from the already-verified file-level facts of their children, not generated from the raw source tree — that's what makes the output reliable for downstream LLM reasoning.
- Re-running this dogfood after every major refactor is a useful sanity check. If the analysis output drifts in unexpected ways, the refactor probably needs another look.
