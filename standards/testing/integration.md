# Integration Test Standard

> An integration test proves that ArchMapper's pipeline components work correctly as a wired system: orchestration logic, filesystem reads, Zod validation, progress checkpointing, and output writing — with the Anthropic client mocked and real temporary directories on disk.

**Load when:** Writing or reviewing any test that exercises the pipeline end-to-end, a full phase (file analysis or folder waves), batch submission/polling, or progress resume logic.
**Scope:** ArchMapper development only.

---

## Definition

An integration test exercises the **full execution path** for one pipeline phase or feature: real filesystem, real Zod schemas, real `progress.json` writes — with the Anthropic API client replaced by a controlled mock.

**What an integration test proves:**
- The file-phase runner correctly enumerates files and produces `FileAnalysis` for each.
- The folder-wave runner correctly computes wave order and produces `ModuleAnalysis`.
- The resume logic correctly skips already-completed items from `progress.json`.
- The batch client correctly submits requests and matches results by `custom_id`.
- The output writer correctly merges results into `architecture.json` and checkpoints `progress.json`.
- Zod validation failures are recorded in `failed[]` without crashing the pipeline.

**What an integration test does NOT prove:**
- That the Anthropic API returns correct structured output (the mock controls that).
- That dree or dependency-cruiser work correctly (use their own test suites; treat their output as fixtures).
- That the real Anthropic batch API is functional (no real API calls in CI).

---

## The temp-directory pattern — ArchMapper's integration baseline

Every integration test suite that touches the filesystem follows this exact setup:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { runFilePhase } from '../../src/pipeline/file-phase'
import type { LlmClient } from '../../src/types/llm-client'

// One fresh temp directory per test FILE — never per test case
let tempDir: string
let outputDir: string

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archmapper-test-'))
  outputDir = path.join(tempDir, 'architecture', 'TestProject')
  fs.mkdirSync(outputDir, { recursive: true })
})

afterAll(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

// Mock LLM client — returns controlled FileAnalysis-shaped JSON
const mockLlmClient: LlmClient = {
  async sendMessage(_params) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          path: 'placeholder',  // overridden per test
          purpose: 'A test file',
          exports: ['testExport'],
          imports: [],
          patterns: [],
        })
      }]
    }
  }
}
```

**Rules for this pattern:**
- `fs.mkdtempSync` is called **once per test file** in `beforeAll`, not once per test case.
- The temp directory is cleaned up in `afterAll`.
- Never write to the actual `architecture/` or `project/` directories from tests — always use a temp directory.
- The mock LLM client returns valid `FileAnalysis`-shaped JSON. Sad-path tests override it to return invalid JSON or throw.

---

## Isolation rules

### What MUST be mocked

| Dependency | Why | How |
|---|---|---|
| Anthropic API client | Never hit a real provider in automated tests — expensive, flaky, requires credentials | Pass `mockLlmClient` to pipeline functions via injection |
| Anthropic Message Batches API | Batch polling involves real network calls and async delays | Mock the batch submitter; return controlled JSONL results |

### What must NOT be mocked

| Dependency | Why |
|---|---|
| Node.js `fs` module (in integration tests) | The filesystem write/read behavior is what is being tested |
| Zod schemas | Validation is logic, not infrastructure — must execute for real |
| Path computation and wave ordering | Core pipeline logic — must run for real |
| Progress checkpoint read/write | Resume behavior is what is being tested |

---

## What every integration test suite must cover

### 1. Happy path

The phase/feature runs successfully. Assert on:
- Correct `architecture.json` content after the run.
- Correct `progress.json` state (all items in `completed[]`, phase = next phase or `done`).
- Correct file count processed.
- Correct wave order (for folder-wave tests).

### 2. Resume behavior

The phase restarts after a simulated crash. Assert on:
- Items already in `progress.json.completed` are skipped (mock LLM is not called again for them).
- Items in `progress.json.pending` are processed.
- `architecture.json` is correctly merged from both prior and new results.

### 3. Zod validation failures

The mock LLM client returns invalid JSON for one file. Assert on:
- The invalid file is in `progress.json.failed[]`.
- The valid files are in `progress.json.completed[]`.
- The pipeline does not crash — it continues to the next file.
- `architecture.json` contains results for the valid files only.

### 4. Batch mode (when USE_BATCHES=true)

- Requests are built with the correct `custom_id` (relative file path).
- Results are matched by `custom_id`, not by index.
- A batch-level error for one item moves it to `failed[]` without affecting others.

---

## Rules

1. **One describe block per pipeline phase or feature.** `file-phase.integration.test.ts` tests the file phase. `folder-waves.integration.test.ts` tests folder wave ordering. Mirror the source file layout.

2. **Assert on both the in-memory result and the persisted artifact.** A test that only checks the return value misses write regressions. After any pipeline step, read `progress.json` and `architecture.json` from disk to verify persistence.

3. **Seed the temp directory with realistic fixtures.** Create source files with real content that the mock LLM will "analyze." Don't use empty files — the pipeline reads file content to build prompts.

4. **Test the resume path explicitly.** Write a `progress.json` with some items already completed, run the phase, and verify only the remaining items are processed.

5. **Parity rule.** If you remove an integration test, a unit test must already cover the same contract. Never leave a contract untested at both layers simultaneously.

---

## Forbidden patterns

| Pattern | Why it fails |
|---|---|
| Real Anthropic API calls | Flaky, expensive, requires credentials; breaks offline and CI environments |
| Writing to the real `architecture/` directory from tests | Pollutes the repo with test artifacts; state bleeds between runs |
| Testing only the happy path | Resume bugs, Zod failure handling bugs, and batch matching bugs are only caught by sad-path tests |
| Reading `progress.json` only from memory without checking disk | The write behavior is what is being tested — read from disk |
| Creating fixtures per test case instead of per test file | Slow; creates order-dependent state if cleanup fails |
| Hardcoded absolute paths in fixture setup | Breaks on different machines and CI environments |
| Leaving temp directories uncleaned | Accumulates gigabytes of test artifacts across runs |

---

## Error path requirement

Every integration test suite must cover:

```
File phase test suite
├── Happy path — all files analyzed and merged           ✓ tested
├── Resume — skips completed, processes pending          ✓ tested
├── Zod failure — one file invalid, rest continue        ✓ tested
├── LLM error — mock throws, file moves to failed[]      ✓ tested
└── Empty scan root — zero files, phase completes cleanly ✓ tested

Folder waves test suite
├── Happy path — correct bottom-up wave order            ✓ tested
├── Leaf-only tree — wave 0 only                         ✓ tested
├── Nested tree — multiple waves computed correctly      ✓ tested
└── Resume — waves partially done, resumes from pending  ✓ tested
```

If any row is missing a test, the suite is incomplete.

---

## Self-check — before marking any integration test suite complete

- [ ] Is a **temp directory** used — never the real `architecture/` directory?
- [ ] Is the **Anthropic client mocked**? No real API calls.
- [ ] Is the **happy path** tested with assertions on both in-memory result and persisted files?
- [ ] Is the **resume path** tested (pre-seeded `progress.json`, verify only pending items run)?
- [ ] Is the **Zod failure path** tested (invalid LLM output, verify item moves to `failed[]`)?
- [ ] Is the **temp directory cleaned up** in `afterAll`?
- [ ] Are all fixtures created with realistic content (not empty files)?
- [ ] Is the **parity rule satisfied** — no integration test removed without a unit test covering the same contract?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
