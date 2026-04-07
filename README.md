# ArchMapper

A fully automated, resumable, bottom-up reverse-engineering pipeline for any codebase. Drop source code in, get structured architectural documentation out.

## What it does

ArchMapper analyzes a codebase and produces:

- **File-level analysis** — purpose, exports, imports, design patterns, key abstractions for every source file
- **Module-level synthesis** — bottom-up folder summaries built from child analyses (leaves first, then parents)
- **Architecture document** — a single `architecture.json` with the complete structural understanding
- **Spec cards** — one Markdown file per module for human reading

ArchMapper uses Claude Sonnet for high-volume file analysis and Claude Opus for deeper module synthesis. It never reproduces source code — only architectural documentation.

## Quick start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Copy the example and fill in your API key:

```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=your_actual_api_key
PROJECT_NAME=my_project
```

See [.env.example](.env.example) for all configuration options.

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

## Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | — | Your Anthropic API key |
| `PROJECT_NAME` | **Yes** | — | Name for this run (letters, numbers, underscores) |
| `FILE_MODEL` | No | `claude-sonnet-4-6` | Model for file analysis |
| `SYNTHESIS_MODEL` | No | `claude-opus-4-6` | Model for folder synthesis |
| `SCAN_ROOT` | No | `project` | Directory to analyze |
| `USE_BATCHES` | No | `false` | Use Message Batches API (50% cheaper) |
| `EXCLUDE_PATTERNS` | No | `node_modules,dist,build,.git` | Patterns to exclude |
| `MAX_TOKENS` | No | `4096` | Max tokens per LLM response |

## Development

```bash
npm test              # run all tests (vitest)
npm run test:watch    # run tests in watch mode
npm run typecheck     # TypeScript type check
npm run build         # compile to dist/
```

See [CLAUDE.md](CLAUDE.md) for the full development guide and standards.

## Cost

ArchMapper tracks token usage and cost for every run. At the end of a run, it prints a detailed breakdown:

- **Sonnet** (file analysis): $3/1M input, $15/1M output
- **Opus** (module synthesis): $5/1M input, $25/1M output
- **Prompt caching** reduces repeat system prompt costs by ~90%
- **Batch mode** (`USE_BATCHES=true`) reduces per-request cost by 50%

## License

Proprietary — all rights reserved. See [LICENSE](LICENSE).
