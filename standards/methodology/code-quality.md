# Code Quality Standard

> The principles that govern every line of code written for ArchMapper: SOLID, DRY, KISS, YAGNI, and the rules for comments, naming, and reuse. These are not suggestions — they are enforced on every change.

**Load when:** Writing new code, reviewing a pull request, refactoring, or evaluating a design decision.
**Scope:** ArchMapper development only.

---

## Why these principles matter

Code is written once and read many times — by other developers, by AI agents, by your future self trying to fix a broken pipeline run at 11pm. Every shortcut taken in the name of speed creates a debt that compounds. These principles exist to keep ArchMapper readable, testable, and maintainable at scale.

The test: *"Could a competent developer who has never seen this code understand what this function does, why it exists, and how to change it safely — in under five minutes?"* If the answer is no, the code needs improvement regardless of whether the tests pass.

---

## SOLID

### Single Responsibility Principle

**Rule:** One file, one class, one function — one clear job.

**What it looks like in ArchMapper:**
- `orchestrator.ts` coordinates the pipeline phases. It does not call dree, parse LLM output, or write files.
- `batch-client.ts` submits and polls Anthropic message batches. It does not build prompts or validate Zod schemas.
- `validateProjectName()` validates a project name. It does not read `.env` — that is `config.ts`.

**Red flags:**
- A function that takes five optional parameters each controlling a different behaviour.
- A module that builds the tree, calls the LLM, validates output, and writes files.
- An orchestrator that has direct knowledge of Anthropic API request shapes.

**Fix:** Extract. If a function does two things, split it into two functions. If a module handles two concerns, split it into two modules.

---

### Open/Closed Principle

**Rule:** Modules should be open for extension, closed for modification.

**What it looks like in ArchMapper:**
- Adding sync vs batch mode should extend the file-phase runner, not modify existing working code.
- Adding a new static analysis tool should add a new extractor module, not edit the orchestrator.

---

### Liskov Substitution Principle

**Rule:** If a function accepts an interface, it must work correctly with any valid implementation. The mock Anthropic client used in tests must satisfy the same interface as the real one.

---

### Interface Segregation Principle

**Rule:** Keep contracts narrow and specific. The orchestrator does not import the entire `anthropic` package — it receives only the minimal client interface it needs.

---

### Dependency Inversion Principle

**Rule:** High-level modules depend on abstractions, not concrete implementations.

**What it looks like in ArchMapper:**
- `analyzeFile()` receives an `LlmClient` interface — it does not instantiate `new Anthropic()` directly. This is why the LLM is mockable in tests without touching the analysis logic.
- The progress writer receives a `writeFile` function — it does not call `fs.writeFileSync` directly. This makes the writer testable without touching the filesystem.

---

## DRY — Don't Repeat Yourself

**Rule:** Every piece of knowledge must have a single, authoritative representation in the codebase.

**What duplication looks like in ArchMapper:**

```typescript
// BAD — the same path-safety check in two places
// In file-phase.ts:
if (!filePath.startsWith(scanRoot)) throw new Error('Path outside scan root')

// In folder-wave.ts:
if (!folderPath.startsWith(scanRoot)) throw new Error('Path outside scan root')
```

The fix is a shared `assertWithinScanRoot(path, scanRoot)` utility. If the validation rule changes, it changes in one place.

**DRY applies to:**
- Validation logic (extract to shared utility functions)
- Zod schemas (one schema per data shape — do not redefine the same shape twice)
- Prompt templates (one template file in `prompts/`, not inline strings scattered through scripts)
- Test setup (extract to shared helpers or `beforeAll` fixtures)
- Documentation (one canonical source — do not repeat facts across multiple files)

**DRY does not mean:** creating an abstraction for three lines of code that happen to look similar but represent different concepts. Before extracting, ask: "If this changes in one place, must it change in the other?" If no → they are not duplicates.

---

## KISS — Keep It Simple

**Rule:** The simplest solution that correctly solves the problem is the right solution. Complexity is a cost, not a feature.

**What complexity looks like (avoid these):**
- A progress tracker with ten optional configuration parameters for hypothetical scenarios
- Three levels of abstraction for a function called from one place
- A generic utility that handles seventeen edge cases but is only used once

**What simplicity looks like (aim for these):**
- A resume loader: read the file, parse with Zod, return the state (or default)
- A file enumerator: walk the tree, filter by extension, return sorted paths
- A batch submitter: build requests, call the API, record the batch ID

**The test:** If a junior developer cannot understand a function in five minutes of reading, it is not simple enough. Rewrite the function, not the junior developer's mental model.

**KISS and performance:** Do not optimise prematurely. A simple O(n) solution that works is better than a complex O(log n) solution that is hard to understand. Profile first. Optimise only what is measured to be slow.

---

## YAGNI — You Aren't Gonna Need It

**Rule:** Only build what the current ticket explicitly requires. If a feature, abstraction, configuration option, or generalisation is not needed right now, do not build it.

**Why:** Speculative code must be read, understood, tested, and maintained on every future change. Code that "might be useful someday" is code that definitely creates complexity today.

**What YAGNI violations look like:**

```typescript
// BAD — the ticket asked for Anthropic; this generalises to any LLM provider speculatively
class LlmProviderRegistry {
  private providers: Map<string, LlmProvider> = new Map()
  register(name: string, p: LlmProvider) { ... }
  get(name: string): LlmProvider { ... }
  list(): string[] { ... }
  unregister(name: string) { ... }  // no ticket asked for this
}

// GOOD — the ticket asks to support one provider with a configurable model
function createAnthropicClient(apiKey: string, model: string): Anthropic {
  return new Anthropic({ apiKey })
}
```

When a second provider is needed, the function will be extended then. The simpler form is easier to extend correctly than the over-engineered registry is to understand.

---

## Code comments

**When to comment:** Only when the code cannot speak for itself.

**Good comment candidates:**
- A workaround for a known limitation of dree or dependency-cruiser
- A business rule not evident from variable names (`// Anthropic batch results are matched by custom_id, not array index`)
- A constraint imposed by an external system
- A "why not" note explaining why an obvious approach was deliberately rejected

**Bad comment candidates:**
```typescript
// BAD — narrates what the code obviously does
// Increment the counter
count++

// BAD — restates the function name
// Returns the config
function getConfig() { ... }

// BAD — commented-out code
// const old = legacyAnalyze(file)

// BAD — placeholder without a ticket
// TODO: handle edge case
```

**Commented-out code:** Remove it. If it was useful, git history has it. Commented-out code in a commit signals unfinished thinking.

---

## Reuse before building

Before writing any new function, module, or utility:

1. **Search the codebase.** Does something already do this? Can it be extended?
2. **Check Node.js stdlib.** Does `node:fs`, `node:path`, `node:crypto`, or another built-in module solve this?
3. **Check existing dependencies.** Does a package already in `package.json` solve this?
4. **Only then build.** If the answer to all three is no — build it.

---

## Observability

**Logs are part of the design, not an afterthought.**

A pipeline function that does not log its failure paths is incomplete code. A silent catch block is not defensive programming; it is a bug waiting to be invisible.

**Logger module:** All log output goes through `src/logger.ts` — the single structured logger module. It emits JSON objects with `level`, `message`, `timestamp`, and contextual fields. Every pipeline module creates a bound logger: `const log = logger.child({ source: 'file-phase.ts' })`. Never call the root logger directly; never use `console.log` or `console.error`.

**Log levels (use these consistently):**

| Level | When to use |
| --- | --- |
| `DEBUG` | Operation started, intermediate state (e.g. "Building prompt for src/api.ts") |
| `INFO` | Operation completed successfully (e.g. "File analysis complete", "Batch submitted") |
| `WARNING` | Recoverable problem (e.g. "File not found, skipping", "Batch result has unknown custom_id") |
| `ERROR` | Operation failed but pipeline continues (e.g. "Zod parse failed", "LLM provider error") |
| `CRITICAL` | Security violation (e.g. "Path traversal blocked", "API key detected in output") |

**What this means in practice:**
- Before writing any function, enumerate every outcome (success, error, edge cases) and design the log entry for each. This is the outcome map — it is produced before the failing test. See `standards/methodology/workflow.md §Phase 2`.
- Every failure path emits a log at the correct level. Every Anthropic API call logs start (DEBUG), success (INFO), and failure (ERROR). Every Zod parse failure logs the path and a preview of the raw response.
- Log messages must be specific, plain English, and immediately understandable. "Error" is not a message. "File analysis failed: LLM output missing required field 'purpose'" is a message.
- No log statement ever contains: API keys, full file contents, or the full raw text of an analyzed source file.

---

## TypeScript

**The type system is a design tool, not a formality.** A function signature that tells the reader exactly what it accepts and returns is documentation that cannot go stale.

Full rules are in `standards/typescript.md`. **Load it before writing any `.ts` file.** Principles summarised:

- **No `any`, no `as` on unvalidated data.** Use `unknown` for genuinely unknown values (LLM responses, file read contents), then narrow with Zod before use.
- **`async/await` only.** No `.then()/.catch()` chains.
- **Named exports only.** No `export default`.
- **Fix type errors — do not suppress them.** `// @ts-ignore` hides real problems.

---

## Error handling

**Every failure path must be handled explicitly, classified, and logged.**

Full rules are in `standards/security/llm.md` (for LLM-path errors) and in this project's error handling conventions. Principles:

- **Classify every error.** Is it a validation failure, a provider error, a filesystem error, a checkpoint corruption? A catch block that does not name the class of error cannot be monitored or debugged.
- **Every catch block emits a log.** A silent `catch {}` is forbidden.
- **The pipeline does not crash on a single item failure.** Zod parse failures, single-file LLM errors, and batch-level errors are logged and recorded in `failed[]`, then the pipeline continues.

---

## Forbidden patterns

| Pattern | Principle violated |
|---|---|
| Function with more than one clear responsibility | Single Responsibility |
| Copy-pasted logic with minor variations | DRY |
| Five-parameter function with optional flags controlling different behaviours | KISS + Single Responsibility |
| Abstraction used in exactly one place | YAGNI + KISS |
| Comment that restates what the code does | Code comments rule |
| Commented-out code in a commit | Code comments rule |
| `// TODO` without a ticket number | Code comments rule |
| Building a generic registry when the ticket asks for one provider | YAGNI |
| New module that duplicates an existing one | DRY + Reuse first |
| `any` type used to avoid designing a proper interface | KISS (false economy) |
| Silent catch block — no log emitted | Observability — invisible failure path |
| `console.log` instead of structured logger | Observability — bypasses level filtering |
| Log message that says "Error" with no specifics | Observability — useless at incident time |
| `Set<string>` in a persisted progress structure | Architecture/pipeline rule — breaks JSON serialization |
| Generic name: `data`, `result`, `item`, `obj`, `temp` | Naming — no domain meaning |
| Abbreviation not in the permitted set | Naming — comprehension cost |

---

## Self-check — before marking any implementation complete

**Design**
- [ ] Does each function, file, and module have exactly one clear responsibility?
- [ ] Is there any logic that exists in two or more places that could be extracted?
- [ ] Is there any abstraction that is only used once? Could it be inlined?
- [ ] Is there any code written for a hypothetical future requirement?
- [ ] Was the codebase searched for an existing solution before building?
- [ ] Can a junior developer understand every function in this diff in five minutes?

**TypeScript** (load `standards/typescript.md`)
- [ ] `npm run typecheck` passes cleanly — no errors, no suppressions?
- [ ] No `any`, no `as` on unvalidated data, no `// @ts-ignore`?
- [ ] All LLM/external responses validated through Zod before TypeScript types are applied?
- [ ] All async code uses `async/await` — no `.then()/.catch()` chains?
- [ ] Named exports only — no `export default`?

**Security** (load `standards/security/llm.md`)
- [ ] All LLM outputs validated through Zod before touching architecture.json?
- [ ] No API keys, file contents, or source code in any log field?
- [ ] Does the system prompt still contain the verbatim-code-reproduction prohibition?

**Observability**
- [ ] Was an outcome map produced before implementation? Does every outcome have a log statement?
- [ ] No bare `console.log` — all logging goes through the structured logger?

**Testing** (load `standards/testing/unit.md` or `standards/testing/integration.md`)
- [ ] Was a failing test written before implementation and confirmed red?
- [ ] Does every acceptance criterion have at least one test that would fail without the implementation?

**Comments**
- [ ] Do all comments explain *why*, not *what*?
- [ ] Is there any commented-out code in the diff?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
