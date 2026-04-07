# Workflow Standard

> The complete ticket-to-commit sequence for every change made to ArchMapper. Follow this sequence without exception. Every step exists because skipping it has caused real problems.

**Load when:** Starting any ticket, bug fix, or refactor.
**Scope:** ArchMapper development only.

---

## The sequence — mandatory, in order

```
PRE-WORK  → Read CLAUDE.md → Load standards → Baseline test run → Search for existing solution
OUTCOMES  → Map every outcome → Design every log entry → Security-review the map
TDD       → Write failing test → Confirm red → Implement → Confirm green → Typecheck → Refactor
DOCS      → Identify affected docs → Update all of them
SECURITY  → Run security checklist
REVIEW    → Re-read ticket → Review diff → Confirm all gates pass
COMMIT    → Load commit standard → Write message → Stage specific files
REPORT    → Produce integration report
```

Never reorder these phases. Never skip a phase because "it's a small change." The size of the change is not a reason to skip a gate — it is a reason to move through it faster.

---

## Phase 1 — Pre-work (before touching any code)

### Step 1: Read CLAUDE.md

Read `CLAUDE.md` fully at the start of every session. Do not rely on memory from a previous session — rules change, and stale mental models cause errors.

### Step 2: Load all relevant standards

Identify which standards apply to this ticket and load them before writing a line of code:

| Task type | Standards to load |
|---|---|
| Writing any new code (always) | `standards/methodology/code-quality.md` |
| Writing any `.ts` file | `standards/typescript.md` |
| Adding or changing an environment variable | `standards/environment.md` |
| Writing or modifying any LLM call, prompt, or batch request | `standards/security/llm.md` |
| Working on the pipeline (scan, file phase, folder waves, resume, artifacts) | `standards/architecture/pipeline.md` |
| Writing or modifying the mapping agent prompt, analysis schemas, or output quality criteria | `standards/architecture/reverse-engineering.md` |
| Adding a dependency | `standards/security/supply-chain.md` |
| Writing a unit test | `standards/testing/unit.md` |
| Writing an integration test | `standards/testing/integration.md` |
| Creating or updating any document | `standards/documentation/writing.md` |
| Debugging a bug or regression | `standards/debugging/process.md` |
| Creating a new branch | `standards/git/branches.md` |
| Writing a commit message | `standards/git/commits.md` |

Do not start implementation with unread relevant standards. An agent that implements before reading the applicable standard will make avoidable mistakes.

### Step 3: Baseline test run

Before touching a single file, run the full test suite:

```bash
npm test
```

**Rule:** If the baseline is not green, stop. Investigate and resolve the pre-existing failure before starting the ticket. Do not implement on a broken baseline — you will not be able to tell what you broke.

Document the baseline result: "Baseline: 47 tests, 0 failures."

### Step 4: Search for an existing solution

Before writing any new function, module, or utility, search the codebase:

```bash
grep -r "functionName" src/ scripts/
```

Ask:
- Does a function already do this?
- Can an existing utility be extended instead of duplicated?
- Does a Zod schema already model this data?

If something exists that solves or partially solves the problem → reuse or extend it. Do not build from scratch without checking. This is the DRY gate before implementation begins.

---

## Phase 2 — Outcome mapping (mandatory before any code)

### Step 5: Map every outcome and design every log entry

Before writing the failing test, enumerate every possible outcome for the logic you are about to implement. For each outcome, design the log entry.

**The 4-step process:**

**Step 5a — List every outcome**

Identify every exit point:
- Happy path (success)
- Input validation failures
- Resource not found (file missing, scan root invalid)
- External provider failure (Anthropic API, dree, dependency-cruiser)
- Zod parse failure on LLM output
- Batch polling timeout or error
- Resume/checkpoint load failure
- Security events (path traversal on scan root, invalid PROJECT_NAME)
- Edge cases (empty scan root, zero files, already-done run)

**Step 5b — Design the log entry for each outcome**

For each outcome specify:
- **Level** — DEBUG | INFO | WARNING | ERROR | CRITICAL
- **Message** — one clear sentence naming the exact outcome
- **Fields** — the identifiers, error types, and counts a debugger needs (never file contents or API keys)

**Step 5c — Security-review the map**

Ask for each entry: Does the message string contain sensitive data (API keys, file contents, full source code)? Do the fields expose internals that should not be logged?

**Step 5d — Record the map, then proceed**

Record the outcome map as a comment block above the function or in the ticket. Then write the failing test. Then implement — with every log statement already designed.

**Example outcome map:**

```
analyzeFile(filePath: string)

Outcome                   Level    Message                                         Fields
────────────────────────────────────────────────────────────────────────────────────────────
File analyzed             INFO     File analysis complete                          path, tokens_used
File not found            WARNING  File analysis skipped: file not found           path
LLM call failed           ERROR    File analysis failed: LLM provider error        path, error_type, status_code
Zod parse failed          ERROR    File analysis failed: LLM output invalid        path, error_type, raw_preview
Path traversal attempt    CRITICAL File analysis blocked: path outside scan root   path, scan_root
Already completed         DEBUG    File analysis skipped: already in progress.json path
```

---

## Phase 3 — TDD implementation

### Step 6: Write the failing test

Write the test **before** writing any implementation. The test defines what "done" means.

- The test must be specific: it asserts on the exact behaviour the ticket requires.
- Load the relevant test standard before writing (`standards/testing/unit.md` or `standards/testing/integration.md`).
- For a bug fix: write a test that reproduces the bug exactly. See `standards/debugging/process.md`.

### Step 7: Confirm the test is red

Run the test. Verify it fails for the right reason — not because of a syntax error or a missing import, but because the functionality does not exist yet.

```bash
npm test -- --testPathPattern=affected.test
```

A test that passes before implementation is a test that proves nothing.

### Step 8: Implement — minimum to make it pass

Write only what is needed to make the failing test pass. No more.

- Do not add features the ticket did not ask for (YAGNI).
- Do not refactor surrounding code (separate ticket).
- Every log statement must match the outcome map from Step 5. No undesigned logs; no missing logs.

### Step 9: Confirm green

```bash
npm test
```

All tests must pass — not just the new one. If other tests broke, the implementation is wrong. Fix the implementation, not the other tests.

### Step 10: Run the type checker

```bash
npm run typecheck
```

Green tests with type errors is not done. Fix all type errors before proceeding. Do not use `// @ts-ignore` or `as any` to suppress errors — fix the underlying issue.

### Step 11: Refactor if needed

With green tests and a clean type check, refactor if the implementation is messy. Refactoring means improving the structure without changing behaviour.

Rules for refactoring:
- Re-run `npm test` after every significant change.
- Do not add new functionality during a refactor.
- If the refactor reveals a design problem that requires a larger change → create a new ticket.

---

## Phase 4 — Documentation update (mandatory before review)

### Step 12: Identify all affected documents

Use this table to find every document that must be updated:

| What changed | Documents to update |
|---|---|
| New or removed file in `src/` or `scripts/` | Directory structure section in `CLAUDE.md` |
| New or changed env variable | `standards/environment.md`, `.env.example` |
| New standard added | `standards/README.md`, `CLAUDE.md §Standards` |
| New pipeline behavior or phase | `standards/architecture/pipeline.md` |
| New TypeScript schema type | `standards/architecture/pipeline.md §4` |
| New or changed CLI option | `README.md`, `CLAUDE.md §Key commands` |
| New LLM security rule | `standards/security/llm.md` |
| New methodology rule | `CLAUDE.md`, `standards/methodology/workflow.md` |

If a document is not in this table but is clearly affected — update it.

If the change is purely internal and truly affects no contracts, structure, or policies — state that explicitly: *"Doc check: no triggers fired."* Silence is not acceptable.

### Step 13: Update every affected document

Update them fully — not a placeholder, not a TODO. A doc update that says "see implementation" is not a doc update.

---

## Phase 5 — Security review

### Step 14: Load and run the security checklist

```
Load: standards/security/llm.md
```

For any change touching the LLM integration, prompt templates, batch handling, or file-read path:
- Is user-controlled content (analyzed file contents) wrapped in a labelled context block?
- Does every LLM response go through Zod before touching `architecture.json`?
- Are there any new log statements that could emit API keys, file contents, or full source code?
- Does the prompt still contain the verbatim-code-reproduction prohibition?

Sign off explicitly: *"Security review: passed. N/A items: [list]. No blockers."*

---

## Phase 6 — Review gate

### Step 15: Re-read the ticket

Read the original ticket requirements one by one. For each item ask: "Is this implemented, tested, and documented?" If any item is not complete → implement it before proceeding.

### Step 16: Review the full diff

```bash
git diff
```

Read every line. Ask:
- Is there anything unexpected here?
- Are there any debug artefacts (`console.log`, temporary stubs, commented-out code)?
- Is there anything that changes behaviour beyond what the ticket asked?

If yes to any → fix before committing.

### Step 17: Confirm all gates

- [ ] `npm test` → all green
- [ ] `npm run typecheck` → clean
- [ ] No `any`, no `as` on unvalidated data, no `// @ts-ignore` in the diff
- [ ] All affected documentation updated
- [ ] Security review passed
- [ ] Ticket requirements all delivered
- [ ] Diff contains no debug artefacts or out-of-scope changes
- [ ] Outcome map was produced before implementation — every outcome has a log statement
- [ ] Every new LLM call has: started (DEBUG), completed (INFO), failed (ERROR)
- [ ] Every new batch submission has: submitted (INFO), polling (DEBUG), completed (INFO), failed (ERROR)
- [ ] Every ERROR log has `error_type` and all relevant resource identifiers
- [ ] No `console.log` or `console.error` in the diff (use the structured logger)
- [ ] No sensitive data (API keys, file contents, source code) in any log message or field
- [ ] If `package.json` changed: 9-criterion evaluation completed, owner approval obtained
- [ ] If new environment variable: added to `src/config.ts`, `.env.example`, and `standards/environment.md`

Do not proceed to commit if any gate is open.

---

## Phase 7 — Commit

### Step 18: Load the commit standard

```
Load: standards/git/commits.md
```

**Critical rule:** The agent must NOT run `git add` or `git commit` itself unless the developer explicitly instructs it. Produce ready-to-run commands for the developer to copy-paste.

### Step 19: Write the commit message

Full format rules are in `standards/git/commits.md`. Summary:

```
AM-NNN Imperative description (≤ 72 chars total)

- What changed and why — one bullet per logical change
- Why this approach over alternatives, if non-obvious
- Any follow-up tickets created

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### Step 20: Stage specific files

```bash
git add src/orchestrator.ts tests/orchestrator.test.ts standards/architecture/pipeline.md
```

Never `git add -A` or `git add .` — these can accidentally stage `.env`, `architecture/` output artifacts, or the contents of `project/`.

---

## Phase 8 — Integration report

### Step 21: Produce the report

After every commit, produce a short integration report:

```
## Integration report — AM-042

**What was built:** Atomic write for progress.json using tmp-file-then-rename
to prevent checkpoint corruption on crash.

**Tests added:**
- progress.test.ts: 3 tests covering write, crash-safe rename, and resume-from-partial.

**Docs updated:**
- standards/architecture/pipeline.md §5: atomic write rule updated.

**Security review:** Passed. No new LLM calls or log statements added.

**Open items / follow-up tickets:**
- AM-043: Add --retry-failed flag to reprocess Zod-failed items.
```

---

## PDCA — the quality loop

| Phase | What happens |
|---|---|
| **Plan** | Ticket defines scope, acceptance criteria, and affected standards. |
| **Do** | TDD: failing test → green → refactor. One commit per ticket. |
| **Check** | Review gate: ticket re-read, diff reviewed, all gates confirmed. |
| **Act** | Commit closes the loop. Any new pattern surfaced during review is recorded permanently in CLAUDE.md and the relevant standard. |

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| Implementing before reading the applicable standard | Avoidable mistakes baked into the implementation |
| Starting implementation on a red baseline | Cannot distinguish new failures from pre-existing ones |
| Writing implementation before the failing test | No proof the test validates anything meaningful |
| Committing with failing tests | Broken baseline for the next developer |
| Skipping the documentation update step | Stale docs are bugs that mislead future agents and developers |
| Skipping the outcome mapping step | Silent failure paths ship undetected; logs are missing or wrong |
| Skipping the security review | Security regressions ship undetected |
| `console.log` or `console.error` in committed code | Bypasses level filtering, sanitisation, and structured format |
| `git add -A` without reviewing what is staged | Risk of committing secrets, build artefacts, or scanned source code |
| Agent running git without explicit developer instruction | Developer loses control of the commit history |

---

## Self-check — before marking a ticket complete

- [ ] Was `npm test` run before any code was written? Baseline confirmed green?
- [ ] Was the codebase searched for an existing solution before building?
- [ ] Was an outcome map produced before the failing test was written?
- [ ] Does every outcome in the map have a corresponding log statement?
- [ ] Was a failing test written and confirmed red before implementation?
- [ ] Do all tests pass after implementation?
- [ ] Does `npm run typecheck` pass cleanly?
- [ ] Are all affected documents updated?
- [ ] Was the security review completed with no open items?
- [ ] Was the ticket re-read and every requirement confirmed delivered?
- [ ] Is the diff clean — no debug artefacts, no out-of-scope changes?
- [ ] Is the integration report complete?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
