# CLAUDE.md — ArchMapper

**Mandatory reading.** Read this file in full at the start of every session before touching any code, test, or document. Do not rely on memory from a previous session — rules change, and stale mental models cause errors.

This file is the single source of truth for AI agents and developers working on **ArchMapper itself**. It governs how you build this tool, not what ArchMapper analyzes.

---

## 1. Role

You are a software engineer building ArchMapper — a fully automated, resumable, bottom-up reverse-engineering pipeline. Your responsibilities:

- Implement pipeline features following TDD, SOLID, DRY, KISS, and YAGNI.
- Validate all LLM outputs with Zod before persisting them.
- Never commit `.env`, `architecture/` artifacts, or the contents of `project/`.
- Load and follow the relevant standard from `standards/` before writing any code.
- Produce one commit per ticket, with a ticket ID (`AM-NNN`) in the subject line.

If you are an AI agent (e.g. Claude Code): produce ready-to-run commands for the developer to copy-paste. Do not run `git add` or `git commit` yourself unless explicitly instructed.

---

## 2. What ArchMapper is

ArchMapper reverse-engineers any codebase placed under `project/` (or a configured `SCAN_ROOT`) by:

1. **Building a file tree** using `dree` → `architecture/<PROJECT_NAME>/raw-tree.json`
2. **Extracting a dependency graph** using `dependency-cruiser` → `architecture/<PROJECT_NAME>/dep-graph.json`
3. **Analyzing every source file** via the Anthropic API → one `FileAnalysis` per file
4. **Synthesizing folders bottom-up** (leaf folders first, then parents, wave by wave) → one `ModuleAnalysis` per directory
5. **Writing merged output** → `architecture/<PROJECT_NAME>/architecture.json` + Markdown spec cards under `architecture/<PROJECT_NAME>/specs/`

The pipeline is **resumable**: `progress.json` tracks completed items as `string[]` (not `Set`). A crash at any point allows continuing from the last checkpoint without repeating work.

**Non-goals:** ArchMapper does not provide a GUI, a web API, a streaming interface, or any interactive output. It is a CLI pipeline tool only.

---

## 3. Repository layout

```
archmapper/
├── .env                          # gitignored — secrets and config
├── .env.example                  # committed — full variable reference
├── .gitignore                    # project/, architecture/, .env, dist/
├── AGENTS.md                     # stub redirect for non-Claude agents
├── CLAUDE.md                     # this file
├── LICENSE                       # MIT
├── README.md                     # end-user quick start
├── package.json
├── tsconfig.json
├── vitest.config.ts
│
├── architecture/                 # gitignored — all pipeline outputs
│   └── <PROJECT_NAME>/
│       ├── raw-tree.json
│       ├── dep-graph.json
│       ├── progress.json
│       ├── architecture.json
│       └── specs/
│
├── docs/                         # human-facing documentation
│   └── DEPENDENCIES.md           # dependency evaluation audit trail
│
├── project/                      # gitignored — drop analyzed codebases here
│
├── prompts/                      # LLM prompt templates
│   ├── file-analysis.md          # system prompt for Sonnet (file-level analysis)
│   └── module-synthesis.md       # system prompt for Opus (folder-level synthesis)
│
├── scripts/                      # pipeline entry points
│   └── orchestrator.ts           # main CLI: run the full pipeline
│
├── src/                          # TypeScript source
│   ├── config.ts                 # eager config singleton (imports dotenv, exports config)
│   ├── config.loader.ts          # pure config loading logic (testable without dotenv)
│   ├── logger.ts                 # structured JSON logger (single module)
│   ├── llm-client.ts             # single Anthropic client module (both models)
│   ├── pipeline/
│   │   ├── file-phase.ts         # file analysis runner (Sonnet)
│   │   ├── folder-waves.ts       # wave computation and module synthesis (Opus)
│   │   ├── static-analysis.ts    # dree + dependency-cruiser wrappers
│   │   └── progress.ts           # checkpoint read/write (atomic)
│   └── types/
│       └── schema.ts             # FileAnalysisSchema, ModuleAnalysisSchema, ArchitectureSchema (Zod)
│
├── standards/                    # operational rules for ArchMapper development
│   ├── README.md
│   ├── analysis/reading-architecture.md
│   ├── architecture/pipeline.md
│   ├── architecture/reverse-engineering.md
│   ├── debugging/process.md
│   ├── documentation/writing.md
│   ├── environment.md
│   ├── git/branches.md
│   ├── git/commits.md
│   ├── methodology/code-quality.md
│   ├── methodology/workflow.md
│   ├── security/llm.md
│   ├── security/supply-chain.md
│   ├── testing/integration.md
│   ├── testing/unit.md
│   └── typescript.md
│
└── tests/
    ├── unit/                     # mirrors src/ structure
    └── integration/              # pipeline integration tests with temp dirs
```

---

## 4. Key commands

```bash
npm test                          # run all tests (vitest)
npm run test:watch                # run tests in watch mode
npm run typecheck                 # TypeScript type check (no emit)
npm run build                     # compile TypeScript to dist/
npm run analyze                   # run the full pipeline (reads .env)
npm run analyze -- --force        # re-run even if progress.json exists
npm run analyze -- --retry-failed # retry items in progress.json failed[]
```

**Test runner:** [Vitest](https://vitest.dev/) — TypeScript-native, fast, compatible with the `describe`/`it`/`expect` API. Configured in `vitest.config.ts`.

**Logging:** All pipeline modules use a structured JSON logger (e.g. `pino` or a lightweight custom module in `src/logger.ts`). Every log statement emits a JSON object with `level`, `message`, `timestamp`, and contextual fields. No `console.log` or `console.error` in committed code — they bypass structured output and cannot be filtered by level.

**Baseline rule:** Run `npm test` before touching any code. Do not implement on a broken baseline.

---

## 5. Environment variables

Full reference and startup validation rules: [standards/environment.md](standards/environment.md)

Quick summary:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | — | Never log; never commit |
| `PROJECT_NAME` | **Yes** | — | Letters, numbers, underscores (`^[A-Za-z0-9_]+$`) |
| `FILE_MODEL` | No | `claude-sonnet-4-6` | Model for file-level analysis |
| `SYNTHESIS_MODEL` | No | `claude-opus-4-7` | Model for folder synthesis + final architecture |
| `SCAN_ROOT` | No | `project` | Path to analyze |
| `USE_BATCHES` | No | `false` | Enable Message Batches |
| `MAX_TOKENS` | No | `4096` | Per-response token ceiling |
| `EXCLUDE_PATTERNS` | No | `node_modules,dist,build,.git` | Comma-separated exclusion patterns |
| `NODE_ENV` | No | `development` | Affects log level defaults |
| `LOG_LEVEL` | No | Per `NODE_ENV` | Override: `DEBUG` \| `INFO` \| `WARNING` \| `ERROR` |

`process.env` is accessed in exactly **one file**: `src/config.ts`. No other file reads environment variables directly.

---

## 6. LLM safety rules — non-negotiable

These rules apply on every change touching LLM calls, prompts, or output handling:

1. **Single client module.** All Anthropic API calls go through `src/llm-client.ts`. No other module instantiates `new Anthropic()`.

2. **Zod validation before persistence.** Every LLM response is parsed through the relevant schema (`FileAnalysisSchema`, `ModuleAnalysisSchema`) via `.safeParse()` before being written to `architecture.json`. Raw output never touches the artifact store.

3. **No secrets in logs.** `ANTHROPIC_API_KEY` must not appear in any log statement, error message, or output artifact — ever.

4. **No file content in logs.** Log the file path and byte count, not the content. Analyzed source code is never logged.

5. **Anti-injection prompt structure.** Analyzed file content is wrapped in `<source_file path="...">...</source_file>` context blocks, never injected as raw instructions. The system prompt contains an explicit anti-injection instruction.

6. **Copyright constraint.** The mapping agent system prompt prohibits reproducing verbatim source code from analyzed files, except for naming publicly exported identifiers. This constraint must be present in every file-phase and folder-wave request.

7. **`max_tokens` on every call.** Never make an Anthropic API call without the `max_tokens` parameter.

8. **Path traversal protection.** Every file read goes through `assertWithinScanRoot()` before the file is opened.

Full rules: [standards/security/llm.md](standards/security/llm.md)

---

## 7. Pipeline rules — non-negotiable

1. **Arrays, not Sets, in `progress.json`.** `completed`, `failed`, and `pending` are `string[]`. `Set` is not JSON-serializable and produces `{}` silently.

2. **Atomic writes.** `progress.json` is written via tmp-file-then-rename. A crash mid-write must not corrupt the checkpoint.

3. **Bottom-up wave order.** Folder synthesis respects wave order: leaf folders in Wave 0, then parents. A folder is never synthesized before all its children are done.

4. **Batch results by `custom_id`.** Anthropic does not guarantee batch result order. Match by `custom_id` (the file path), never by array index.

5. **Fail per item, not per run.** A Zod parse failure or LLM error on one file moves that file to `failed[]` and the pipeline continues. No single item failure aborts the entire run.

6. **`PROJECT_NAME` is alphanumeric plus underscores.** Validate with `^[A-Za-z0-9_]+$` at startup. Fail fast with a clear error if invalid.

Full specification: [standards/architecture/pipeline.md](standards/architecture/pipeline.md)

---

## 8. Forbidden patterns (always)

| Pattern | Why |
|---|---|
| `process.env.X` outside `src/config.ts` | Bypasses startup validation |
| `any` type without documented exception | Disables the type system at the boundary that needs it most |
| `Set<string>` in any persisted structure | Not JSON-serializable; produces `{}` silently |
| Raw LLM output written to `architecture.json` | Untrusted data enters the artifact store |
| `ANTHROPIC_API_KEY` in any log or output | Key exposure |
| File content in any log statement | Leaks analyzed source code |
| Analyzing a folder before its children are done | Produces incorrect synthesis |
| Matching batch results by array index | Order is not guaranteed |
| `git add -A` or `git add .` | Risk of committing `.env`, `architecture/` artifacts, or `project/` source |
| Committing without a ticket ID in the subject | No traceability |
| `console.log` or `console.error` in committed code | Bypasses structured logger |
| Verbatim source code in `architecture.json` or spec cards | Copyright violation |

---

## 9. Methodology summary

ArchMapper development follows TDD. The full workflow is in [standards/methodology/workflow.md](standards/methodology/workflow.md). Summary:

1. **Baseline:** Run `npm test` before any code change. Confirm green.
2. **Outcome map:** Before the failing test, enumerate every outcome and design every log entry.
3. **Red:** Write a failing test that captures the exact requirement.
4. **Green:** Implement the minimum to make it pass.
5. **Typecheck:** `npm run typecheck` must be clean.
6. **Refactor:** Improve structure without changing behaviour.
7. **Docs:** Update all documents fired by the change trigger table.
8. **Security review:** Load `standards/security/llm.md` for any LLM-touching change.
9. **Commit:** One commit per ticket, `AM-NNN` prefix, specific file staging.

---

## 10. Standards — load when

| Standard | File | Load when |
|---|---|---|
| Workflow | [standards/methodology/workflow.md](standards/methodology/workflow.md) | Starting any ticket, bug fix, or refactor |
| Code quality | [standards/methodology/code-quality.md](standards/methodology/code-quality.md) | Writing new code, reviewing a PR, refactoring |
| TypeScript | [standards/typescript.md](standards/typescript.md) | Writing or reviewing any `.ts` file |
| Environment | [standards/environment.md](standards/environment.md) | Adding or changing any environment variable |
| Pipeline | [standards/architecture/pipeline.md](standards/architecture/pipeline.md) | Any pipeline work: scan, file phase, folder waves, batches, resume, artifacts |
| Reverse-engineering | [standards/architecture/reverse-engineering.md](standards/architecture/reverse-engineering.md) | Writing or modifying the mapping agent prompt, analysis schemas, or output quality criteria |
| Unit tests | [standards/testing/unit.md](standards/testing/unit.md) | Writing or reviewing any unit test |
| Integration tests | [standards/testing/integration.md](standards/testing/integration.md) | Writing or reviewing any integration or pipeline test |
| LLM security | [standards/security/llm.md](standards/security/llm.md) | Any LLM call, prompt, batch request, output validation, or file-read path |
| Supply chain | [standards/security/supply-chain.md](standards/security/supply-chain.md) | Adding, updating, or evaluating any dependency |
| Commit messages | [standards/git/commits.md](standards/git/commits.md) | Writing any commit message |
| Branch naming | [standards/git/branches.md](standards/git/branches.md) | Creating a new branch |
| Documentation | [standards/documentation/writing.md](standards/documentation/writing.md) | Creating or updating any document in `docs/` or `standards/` |
| Debugging | [standards/debugging/process.md](standards/debugging/process.md) | Any bug, crash, failing test, or regression |
| Analysis | [standards/analysis/reading-architecture.md](standards/analysis/reading-architecture.md) | Answering questions about a reverse-engineered codebase |

Full index with descriptions: [standards/README.md](standards/README.md)

---

## 11. Definition of done — checklist

A ticket is not done until every item below is satisfied:

- [ ] `npm test` → all green (baseline was green before; still green after)
- [ ] `npm run typecheck` → clean
- [ ] No `any`, no `as` on unvalidated data, no `// @ts-ignore`
- [ ] Every LLM response goes through Zod `.safeParse()` before persistence
- [ ] `progress.json.completed` is `string[]`, never `Set`
- [ ] No `ANTHROPIC_API_KEY` or file content in any log statement
- [ ] Outcome map was produced before implementation — every outcome has a log statement
- [ ] All affected documents updated (trigger table checked)
- [ ] Security review completed (for any LLM-touching change)
- [ ] Ticket requirements all delivered
- [ ] Diff is clean — no debug artefacts, no out-of-scope changes
- [ ] Commit staged with specific files (`git add <file> <file>`, never `git add -A`)
- [ ] Commit subject: `AM-NNN Imperative description` (≤ 72 chars)
- [ ] Co-author line present if AI assisted

---

## 12. Maintainer

Owner: Yannick Le Guennec (The Wise Duck Dev)
Repository: `archmapper`
License: MIT. See `LICENSE`.

---

**Last updated:** 2026-04-06
