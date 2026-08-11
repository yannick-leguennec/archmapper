# Environment Variables Standard

> An environment variable that is not documented is a hidden dependency. An application that crashes at runtime because a required variable is missing — with no helpful error — is an application that is hard to operate. Every variable must be declared, validated at startup, and documented.

**Load when:** Adding a new environment variable, changing an existing one, or reviewing any code that touches `process.env`.
**Scope:** ArchMapper development only.

---

## The contract — `.env.example`

`.env.example` is the authoritative list of every environment variable ArchMapper reads. It is committed to the repository. `.env` is never committed.

**Rules for `.env.example`:**
- Every variable the application reads must appear in `.env.example`.
- Required variables have a comment explaining what they control and how to obtain a value.
- Optional variables have their default value shown and a comment explaining the effect.
- When a new variable is added to code, it is added to `.env.example` in the same commit.

---

## Variable classification table

| Variable | Required | Default | Classification | Description |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | **Yes** | — | Secret | Anthropic API key for LLM calls and Message Batches |
| `PROJECT_NAME` | **Yes** | — | Config | Alphanumeric name for this analysis run; determines output directory |
| `FILE_MODEL` | No | `claude-sonnet-5` | Config | Anthropic model for file-level analysis (high volume, factual extraction) |
| `SYNTHESIS_MODEL` | No | `claude-opus-5` | Config | Anthropic model for folder synthesis and final architecture (deeper reasoning) |
| `SCAN_ROOT` | No | `project` | Config | Path to the directory to analyze (relative to repo root) |
| `USE_BATCHES` | No | `false` | Config | Set to `true` to use Anthropic Message Batches API instead of sync calls |
| `EXCLUDE_PATTERNS` | No | `node_modules,dist,build,.git` | Config | Comma-separated list of directory/file patterns to exclude from the scan |
| `MAX_TOKENS` | No | `4096` | Config | Maximum tokens per LLM response |
| `NODE_ENV` | No | `development` | Config | Runtime environment; affects log level defaults |
| `LOG_LEVEL` | No | Per NODE_ENV | Config | Override log level: DEBUG \| INFO \| WARNING \| ERROR |

---

## The single access point rule

`process.env` is accessed in exactly **one file**: `src/config.ts`. No other file reads `process.env` directly.

```typescript
// src/config.ts — the ONLY file that reads process.env

function requireEnv(name: string, description: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `  What it controls: ${description}\n` +
      `  See .env.example for setup instructions.`
    )
  }
  return value
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue
}

export const config = {
  anthropicApiKey: requireEnv('ANTHROPIC_API_KEY', 'Anthropic API key for LLM calls'),
  projectName:     requireEnv('PROJECT_NAME',      'Alphanumeric name for this analysis run'),
  model:           optionalEnv('MODEL',            'claude-sonnet-5'),
  scanRoot:        optionalEnv('SCAN_ROOT',         'project'),
  useBatches:      optionalEnv('USE_BATCHES',       'false') === 'true',
  excludePatterns: optionalEnv('EXCLUDE_PATTERNS',  'node_modules,dist,build,.git').split(','),
  maxTokens:       parseInt(optionalEnv('MAX_TOKENS', '4096'), 10),
  nodeEnv:         optionalEnv('NODE_ENV',           'development'),
  logLevel:        process.env['LOG_LEVEL'],         // undefined = use NODE_ENV default
} as const
```

**Why:** Centralising env access means validation happens once at startup. If a variable is missing or malformed, the error appears immediately with a clear message — not buried in a runtime crash during a pipeline run.

---

## Required vs optional

| Classification | Meaning | Startup behaviour if missing |
|---|---|---|
| **Required** | Application cannot function without it | Fail fast at startup with a clear error naming the variable and where to get it |
| **Optional** | Has a sensible default; application works without it | Use the documented default; log at INFO that default is in use |

---

## Validation rules for specific variables

### `PROJECT_NAME`

Must match `^[A-Za-z0-9_]+$` (letters and numbers only, no spaces, no slugging). Validated in `src/config.ts` immediately after reading:

```typescript
const rawName = requireEnv('PROJECT_NAME', 'Alphanumeric name for this analysis run')
if (!/^[A-Za-z0-9]+$/.test(rawName)) {
  throw new Error(
    `Invalid PROJECT_NAME "${rawName}": must contain only letters and numbers (A-Z, a-z, 0-9). ` +
    `No spaces, hyphens, or underscores.`
  )
}
```

### `SCAN_ROOT`

Must be a path that exists on disk. Validated by the orchestrator before the pipeline starts:

```typescript
if (!fs.existsSync(config.scanRoot)) {
  throw new Error(`SCAN_ROOT does not exist: ${config.scanRoot}`)
}
```

### `ANTHROPIC_API_KEY`

Never logged, never included in any error message, never written to any output artifact. If the API key appears in a log or output file, that is a security incident. See `standards/security/llm.md`.

---

## Naming convention

All environment variables use `UPPER_SNAKE_CASE`.

| Pattern | Example | Rule |
|---|---|---|
| API keys | `ANTHROPIC_API_KEY` | `<PROVIDER>_API_KEY` |
| Feature flags | `USE_BATCHES` | `USE_` prefix for boolean flags |
| Path config | `SCAN_ROOT` | Descriptive noun |
| Model identifiers | `MODEL` | Short noun |
| Comma-separated lists | `EXCLUDE_PATTERNS` | Plural noun |

---

## `.env.example` template

```bash
# ─── Required ─────────────────────────────────────────────────────────────────

# Your Anthropic API key. Obtain from https://console.anthropic.com/
# Never commit this value.
ANTHROPIC_API_KEY=your_api_key_here

# Name for this analysis run. Used as the output directory name under architecture/.
# Must contain only letters and numbers (no spaces, hyphens, or underscores).
# Example: MyProject, webapp2024, analysisBeta
PROJECT_NAME=MyProject

# ─── Optional ─────────────────────────────────────────────────────────────────

# Anthropic model for file-level analysis (high volume, factual extraction).
# Default: claude-sonnet-5
# FILE_MODEL=claude-sonnet-5

# Anthropic model for folder synthesis and final architecture (lower volume, deeper reasoning).
# Default: claude-opus-5
# SYNTHESIS_MODEL=claude-opus-5

# Path to the directory to analyze (relative to repo root, or absolute).
# Default: project
# SCAN_ROOT=project

# Set to true to use Anthropic Message Batches API (async, lower cost at scale).
# Default: false (sync mode)
# USE_BATCHES=false

# Comma-separated directory/file patterns to exclude from the scan.
# Default: node_modules,dist,build,.git
# EXCLUDE_PATTERNS=node_modules,dist,build,.git

# Maximum tokens per LLM response.
# Default: 4096
# MAX_TOKENS=4096

# Runtime environment. Affects default log level.
# Values: development | test | production
# Default: development
# NODE_ENV=development

# Minimum log level to emit. Overrides NODE_ENV default.
# Values: DEBUG | INFO | WARNING | ERROR
# Optional — defaults: development=DEBUG, production=INFO
# LOG_LEVEL=
```

---

## Adding a new environment variable — process

1. Decide: required or optional? What is the default?
2. Add the variable to `src/config.ts` using `requireEnv` or `optionalEnv`.
3. Add the variable to `.env.example` with a comment explaining purpose, values, and how to obtain.
4. Add the variable to the classification table in this file.
5. If the variable is a secret: ensure it is excluded from all logs and output artifacts.

All steps happen in the same commit. A variable added to code without an `.env.example` entry is incomplete.

---

## Secrets management

`ANTHROPIC_API_KEY` is the only secret variable in ArchMapper's current scope. Rules:
- Never log it, even partially (e.g. first 4 characters).
- Never include it in error messages.
- Never write it to `architecture/`, `progress.json`, or any output file.
- In production, prefer injecting it via the deployment environment (CI secrets, OS keychain) rather than a `.env` file on disk.

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| `process.env.X` accessed outside `src/config.ts` | Bypasses startup validation; variable list becomes invisible |
| New variable added to code without `.env.example` entry | Hidden dependency — next developer cannot set up the environment |
| Required variable without startup validation | Application fails at runtime, not at startup |
| `ANTHROPIC_API_KEY` in any log statement or output file | Security incident — key exposure |
| Secret value committed to `.env.example` | Secrets in the repository — use `your_api_key_here` as placeholder |
| `PROJECT_NAME` containing non-alphanumeric characters | Breaks the `architecture/<PROJECT_NAME>/` directory naming convention |
| Undocumented default | Optional variables must document their default in `.env.example` |

---

## Self-check

- [ ] Is every new variable added to `src/config.ts` via `requireEnv` or `optionalEnv`?
- [ ] Is every new variable added to `.env.example` with a descriptive comment?
- [ ] Is the variable added to the classification table in this file?
- [ ] Is `process.env` accessed nowhere outside `src/config.ts`?
- [ ] If the variable is optional — is the default clearly documented?
- [ ] If the variable contains a secret — is it excluded from all logs and output artifacts?
- [ ] Is `.env` absent from the diff (never committed)?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
