# Debugging Process Standard

> A disciplined debugging process eliminates guesswork, prevents accidental regressions, and ensures fixes address root causes rather than symptoms. Load this standard every time you investigate unexpected behaviour — whether in the pipeline, a test, or a crash.

**Load when:** Investigating any unexpected behaviour, a failing test, a crash, a wrong output in `architecture.json`, or a corrupted `progress.json`.
**Scope:** ArchMapper development only.

---

## Definition

A debugging session is complete when:
1. The bug is **reproduced** reliably in a minimal case.
2. The **root cause** is identified (not just the symptom).
3. A **failing test** capturing the bug exists.
4. The fix makes the test pass without breaking any other test.
5. No debug artefacts (console statements, temporary stubs) remain in committed code.

---

## Mandatory sequence — follow in order

### Step 1 — Read the full error

Before touching any code:
- Read the complete error message, stack trace, or failing assertion. Do not skim.
- Identify: error type, file, line number, call chain.
- For pipeline errors: check `progress.json` — which phase was active? Which files are in `failed[]`?
- Ask: "What is the system actually saying, not what do I think it is saying?"

Common traps:
- The error points to `architecture.json` deserialization, but the root cause is in the LLM output validator.
- "Cannot read properties of undefined" — find *why* the value is `undefined`, not just where.
- A Zod validation error lists the failing field — trace back to where that field should have been set in the prompt.

### Step 2 — Reproduce the bug first

Never attempt a fix before reliably reproducing the bug. A bug you cannot reproduce is a bug you do not understand.

- **Reproduce in the smallest possible context.** Can you trigger it with a single test file rather than a full pipeline run?
- **Confirm the reproduction is reliable.** If it only fails sometimes, the bug is likely timing- or state-dependent.
- **Reproduce in a test if possible.** Write a failing test that captures exactly the broken behaviour. This test becomes your definition of "fixed."

If you cannot reproduce the bug, stop. Do not guess. Investigate why reproduction fails before proceeding.

### Step 3 — Check recent changes

Before deep-diving, run:

```bash
git log --oneline -20
git diff HEAD~1
```

If the bug is a regression — behaviour that worked before — use bisection (see §Bisection). The fix is often obvious once you see what changed.

### Step 4 — Form one hypothesis at a time

State a specific, falsifiable hypothesis before making any change:

> "I think the bug is caused by X because Y. If I am right, changing Z will fix it."

- Test **one hypothesis at a time**. Change one thing, observe the result, then decide the next step.
- If the hypothesis is wrong, revert the change and form a new one. Do not accumulate speculative changes.
- If you have been wrong three times in a row, step back. Your mental model of the system is incorrect — re-read the code rather than guessing further.

### Step 5 — Find the root cause (5 Whys)

Ask "why" recursively until you reach a cause that cannot be reduced further.

**ArchMapper example:**

1. Why did `architecture.json` contain no `modules` entries? → The folder-wave phase did not run.
2. Why did the folder-wave phase not run? → `progress.json.phase` was already `done`.
3. Why was `phase` already `done`? → The file phase wrote `done` instead of `folders` at completion.
4. Why was the wrong phase written? → A typo in the phase transition: `'done'` instead of `'folders'`.
5. Why was there no test catching this? → The phase transition was not covered by the integration test.

Root cause: missing test coverage for phase transitions. Fix: correct the typo AND add a test for the `files → folders → done` transition sequence.

### Step 6 — Write the failing test before the fix

TDD applied to bugs:
1. Write a test that fails exactly because of the bug.
2. Confirm it is red.
3. Implement the fix.
4. Confirm the test turns green.
5. Confirm no other tests broke.

This sequence proves the fix is correct, not just that the bug stopped appearing temporarily.

### Step 7 — Apply the minimal fix

The fix must address the root cause only. Do not:
- Refactor surrounding code while fixing the bug (separate ticket).
- Add unrelated improvements (YAGNI).
- Change anything you cannot directly link to the root cause.

### Step 8 — Verify no regression

```bash
npm test
npm run typecheck
```

A fix that breaks three other things is not a fix.

### Step 9 — Remove all debug artefacts

Before committing, scan for and remove:
- `console.log`, `console.error`, `console.debug` added during investigation.
- Temporary `return` statements or stubbed values.
- Commented-out code added speculatively.

Run `git diff` and read every line before staging.

---

## Bisection — for regressions

When a behaviour worked before and broke at some unknown commit:

```bash
git bisect start
git bisect bad                     # current commit is broken
git bisect good <last-known-good>  # specify the last good commit
git bisect run npm test -- --testPathPattern=affected.test
git bisect reset                   # clean up when done
```

Use bisection whenever the regression window is more than 2–3 commits.

---

## ArchMapper-specific debugging checklist

For pipeline bugs, check these before starting the 5-Whys:

| Symptom | First check |
|---|---|
| `architecture.json` is empty or missing entries | Was `progress.json.phase` already `done`? Did Zod validation fail silently? |
| Pipeline exits immediately without processing files | Is `SCAN_ROOT` valid and non-empty? Is `PROJECT_NAME` alphanumeric? |
| Batch results missing or mismatched | Are batch results matched by `custom_id`? Is the JSONL being parsed correctly? |
| `progress.json` is `{}` or malformed | Was a `Set` persisted instead of an array? Was a non-atomic write interrupted? |
| Folder analysis missing or in wrong order | Are leaves computed before parents? Check the wave computation logic. |
| LLM output rejected by Zod on every file | Is the prompt returning the expected JSON structure? Log the raw response (truncated). |

---

## Escalation — when to stop and ask

Escalate (open a ticket or ask the owner) when:
- You have falsified 3+ hypotheses and the root cause is still unknown.
- The fix requires changing the `progress.json` or `architecture.json` schema.
- The bug requires touching the Anthropic batch API in a way that could affect in-flight runs.
- You suspect the bug is in a third-party library (dree, dependency-cruiser, Anthropic SDK).

When escalating, always provide:
- Exact reproduction steps.
- What you have tried and why each attempt failed.
- Your current best hypothesis and why you think it might be wrong.

---

## Forbidden patterns

| Pattern | Why it fails |
|---|---|
| Fixing without reproducing | You do not know what you fixed; the bug will recur |
| Multiple changes at once | Cannot determine which change fixed the bug |
| Silent `catch {}` to make the error disappear | Hides the bug without addressing it |
| Skipping the failing test | No proof the fix worked; next change will silently reintroduce the bug |
| Committing debug logs | `console.log('HERE')` in production code can leak analyzed source code |
| Refactoring while fixing | Two changes in one commit = two possible sources of regression |

---

## Self-check — before marking a bug fixed

- [ ] Is the bug **reproduced** reliably before the fix was applied?
- [ ] Is the **root cause** identified (not just the symptom)?
- [ ] Is there a **failing test** that was red before the fix and is green after?
- [ ] Does `npm test` pass in full after the fix?
- [ ] Does `npm run typecheck` pass?
- [ ] Are all **debug artefacts** removed?
- [ ] Is the fix **minimal** — no unrelated refactoring mixed in?
- [ ] If this was a regression, was **bisection** used or was the offending commit identified?
- [ ] Is the fix documented in the commit message with a clear "why"?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
