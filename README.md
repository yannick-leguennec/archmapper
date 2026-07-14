# ArchMapper

[![CI](https://github.com/yannick-leguennec/archmapper/actions/workflows/ci.yml/badge.svg)](https://github.com/yannick-leguennec/archmapper/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)

A fully automated, resumable, bottom-up reverse-engineering pipeline for any codebase. Drop source code in, get structured architectural documentation out.

## What it does

ArchMapper analyzes a codebase and produces:

- **File-level analysis** — purpose, exports, imports, design patterns, key abstractions for every source file
- **Module-level synthesis** — bottom-up folder summaries built from child analyses (leaves first, then parents)
- **Architecture document** — a single `architecture.json` with the complete structural understanding
- **Spec cards** — one Markdown file per module for human reading

ArchMapper uses Claude Sonnet 5 for high-volume file analysis and Claude Opus 4.8 for deeper module synthesis. It never reproduces source code — only architectural documentation.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=your_actual_api_key
PROJECT_NAME=my_project
```

Get an API key at [console.anthropic.com](https://console.anthropic.com/). See [.env.example](.env.example) for all configuration options.

### 3. Place your codebase

Drop the codebase you want to analyze into the `project/` directory (or configure `SCAN_ROOT` to point elsewhere).

### 4. Run the pipeline

```bash
npm run analyze
```

The pipeline is **resumable** — if it crashes or is interrupted, re-run the same command and it continues from where it stopped.

### CLI options

```bash
npm run analyze                    # normal run (resumes if progress exists)
npm run analyze -- --force         # delete progress, start completely fresh
npm run analyze -- --retry-failed  # retry items that failed last time
```

## Output

All output is written to `architecture/<PROJECT_NAME>/`:

```
architecture/<PROJECT_NAME>/
├── raw-tree.json         # file tree (from dree)
├── dep-graph.json        # dependency graph (from dependency-cruiser, if available)
├── progress.json         # resume checkpoint
├── architecture.json     # complete analysis (files + modules + summary)
└── specs/                # one Markdown spec card per module
    ├── src.md
    ├── src_api.md
    └── ...
```

> **`dependency-cruiser` is optional.** It is not declared in `package.json`. If you want richer file-phase prompts (with import/require dependency edges available as context), install it locally:
>
> ```bash
> npm install -D dependency-cruiser
> ```
>
> Without it, the pipeline logs a one-line warning and skips writing `dep-graph.json`. Everything else works the same way.

## Using the output

The `architecture.json` file is designed to be **directly consumed by an LLM** as context for downstream analysis. Two common patterns:

**Ask an LLM to reason over the architecture.** Paste `architecture.json` into a Claude conversation along with a question like:

- *"What modules in this codebase have the most cross-cutting concerns, and where might tech debt be hiding?"*
- *"If I want to add feature X, which files and modules will I need to touch?"*
- *"Walk me through the dependency flow from the CLI entry point to the data layer."*

Because the bottom-up wave methodology grounds every level of the analysis in verified facts from the level below, the model can answer with specificity instead of guessing — no hallucinated imports, no invented module relationships.

**Hand a coding agent a structured map.** When pointing an autonomous coding agent (Claude Code, Cursor, etc.) at an unfamiliar codebase, prepend `architecture.json` to the agent's context. The agent now has a structural map before writing any code, which dramatically reduces hallucinated cross-references.

**Spec cards.** The `specs/<module>.md` files are for human reading. Each one shows a module's purpose, public API, design patterns, cross-cutting concerns, and direct children. They are stable Markdown — diff-friendly, version-controllable, and easy to embed in onboarding docs.

For the schema and field-by-field semantics, see [`standards/analysis/reading-architecture.md`](standards/analysis/reading-architecture.md).

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | — | Your Anthropic API key |
| `PROJECT_NAME` | **Yes** | — | Name for this run (letters, numbers, underscores) |
| `FILE_MODEL` | No | `claude-sonnet-5` | Model for file analysis |
| `SYNTHESIS_MODEL` | No | `claude-opus-4-8` | Model for folder synthesis |
| `SCAN_ROOT` | No | `project` | Directory to analyze |
| `USE_BATCHES` | No | `false` | Use Message Batches API (50% cheaper) |
| `EXCLUDE_PATTERNS` | No | `node_modules,dist,build,.git` | Patterns to exclude |
| `MAX_TOKENS` | No | `4096` | Max tokens per LLM response |

Both model env vars accept any current Anthropic model identifier — see the [Anthropic models overview](https://docs.anthropic.com/en/docs/about-claude/models/overview) for the latest names. The cost summary recognizes the current Claude 4 lineup; unknown models fall back to Sonnet rates.

## Cost

ArchMapper tracks token usage and cost for every run. The cost summary at the end shows a detailed breakdown:

- **Sonnet** (file analysis): $3 / 1M input tokens, $15 / 1M output tokens
- **Opus** (module synthesis): $5 / 1M input tokens, $25 / 1M output tokens
- **Prompt caching** automatically reduces repeat system prompt costs by ~90%
- **Batch mode** (`USE_BATCHES=true`) halves per-request cost (50% discount)

**Budget anchor:** a typical TypeScript repository of ~500 source files runs at roughly **$2 to $5** with batches and caching enabled, climbing to **$10 to $20** for a 5,000-file codebase. Very large codebases (10,000+ files) are still affordable on a personal Anthropic account, but worth running with `USE_BATCHES=true` from the start.

Pricing is current as of the latest model release. See [Anthropic's pricing page](https://www.anthropic.com/pricing) for the canonical rates.

## Limitations and non-goals

ArchMapper is intentionally narrow in scope. Things it **does not** do:

- **Runtime analysis.** Only static structure is analyzed. ArchMapper says nothing about performance, memory, concurrency, or observed behavior under load.
- **Security audit.** It surfaces structure, not vulnerabilities. A clean `architecture.json` does not imply secure code.
- **Replace code review.** The output describes *what* the code is, not whether it is correct or well-written.
- **Verbatim source code.** By design, the mapping agent never reproduces source code in its output, except to name publicly exported identifiers (function names, class names, type names). If you need the source, read the source.
- **Free.** Every run costs Anthropic API tokens. See the Cost section above for budgeting.

Quality varies by language. ArchMapper has been validated most extensively on TypeScript and JavaScript repositories. It works on any language, but the file-level analysis depth depends on how well Claude Sonnet recognizes the language's idioms.

Generated files (Prisma client, protobuf stubs, OpenAPI types) are analyzed with reduced depth — the mapping agent flags them as generated and notes their mechanical nature.

## Troubleshooting

**"Missing required environment variable"** — Your `.env` is missing `ANTHROPIC_API_KEY` or `PROJECT_NAME`. Copy `.env.example` and fill in both.

**"Invalid PROJECT_NAME"** — `PROJECT_NAME` must contain only letters, numbers, and underscores. No spaces, no hyphens.

**"SCAN_ROOT does not exist"** — The `project/` directory is empty (or `SCAN_ROOT` points to a missing path). Drop a codebase under `project/` or update `SCAN_ROOT` in `.env`.

**Anthropic API rate limits** — Either wait, slow down, or enable batch mode (`USE_BATCHES=true`). Batches are submitted asynchronously and avoid sync rate limits entirely.

**Items in `failed[]`** — Some files failed Zod validation or hit an Anthropic API error. Re-run with `--retry-failed` to give them another chance. If the same items keep failing, inspect them: very large files (>100KB) sometimes need their own configuration, and files with extreme structure (entire file is one giant generated function) may need to be excluded via `EXCLUDE_PATTERNS`.

**Pipeline crashes mid-run** — Just re-run `npm run analyze`. The atomic `progress.json` checkpoint resumes from the last completed item.

**"Pipeline already complete"** — A previous run finished. Use `--force` to re-run from scratch, or just inspect the existing `architecture/<PROJECT_NAME>/` output.

**Cost is higher than expected** — Confirm `USE_BATCHES=true` (50% off) and that prompt caching is working (the cost summary at the end of a run shows cached tokens). Repeated runs on the same codebase should be cheap because the system prompt is cached.

## Development

```bash
npm test              # run all tests (vitest)
npm run test:watch    # run tests in watch mode
npm run typecheck     # TypeScript type check
npm run build         # compile to dist/
```

See [CLAUDE.md](CLAUDE.md) for the full development guide and standards. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to file issues and propose changes.

## License

MIT. See [LICENSE](LICENSE).
