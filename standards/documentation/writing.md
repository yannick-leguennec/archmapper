# Documentation Writing Standard

> Documentation is not a deliverable that happens after the code. It is part of the code. A feature without documentation is a feature only the original author can use. Stale documentation is worse than no documentation — it actively misleads.

**Load when:** Creating or updating any file in `docs/` or `standards/`, adding a new standard, writing a README, or at the documentation phase of the workflow (Phase 4, Steps 12–13).
**Scope:** ArchMapper development only.

---

## Philosophy

**The observable codebase principle:** Any developer or AI agent — with no prior knowledge of the project — must be able to understand what ArchMapper does, how the pipeline works, and why key decisions were made, using only the documentation in `docs/`, the standards in `standards/`, and `CLAUDE.md`. No code-diving required for architectural understanding.

**Documentation is a contract.** When the code changes, the documentation changes in the same commit. A PR that changes behaviour without updating documentation is an incomplete PR.

---

## Document types and mandatory structure

### `CLAUDE.md` (root)

The single source of truth for AI agents and developers working on ArchMapper. Structure:
- Role and mandatory reading instruction
- What ArchMapper is (purpose, non-goals)
- Repository layout (tree diagram)
- Key commands (npm scripts)
- Environment variables (summary; full details in `standards/environment.md`)
- LLM safety rules (critical, inline — not a link)
- Forbidden patterns
- Standards index (load when)

### `README.md` (root)

For end-users who want to run ArchMapper against their codebase. Structure:
- What ArchMapper does
- Quick start (install → configure `.env` → run)
- Configuration reference (link to `.env.example`)
- Output artifacts explanation
- License

### Standards files (`standards/**/*.md`)

```
# <Standard name>

> One-sentence purpose statement.

**Load when:** <exact condition>
**Scope:** ArchMapper development only.

---

## <Domain section 1>
## <Domain section 2>
...
## Forbidden patterns
## Self-check
```

Every standard ends with `**Last updated:** YYYY-MM-DD` and `**Applies to:** ArchMapper development only`.

---

## Tone and audience rules

### Write for the stranger at 2am

Every document must be understandable by a competent developer or AI agent who has never seen ArchMapper, at 2am, during an incident, with no other context.

### Plain English, no jargon

| Bad | Good |
|---|---|
| "The system leverages a bottom-up synthesis paradigm" | "ArchMapper analyzes leaf folders first, then their parents, so each synthesis has complete child context" |
| "Utilise the abstraction layer" | "Use the `LlmClient` interface" |
| "Aforementioned variable" | Repeat the variable name |

### One fact, one place

Every fact must have a single authoritative source. If the same information appears in two documents, one will eventually become wrong.

```markdown
// Bad — duplicated fact
// In CLAUDE.md: "PROJECT_NAME must be alphanumeric"
// In environment.md: "PROJECT_NAME must be alphanumeric"

// Good
// In CLAUDE.md: "See standards/environment.md for PROJECT_NAME rules"
// environment.md is the authoritative source
```

### Active voice, present tense

Describe what the system *does*, not what it *was designed to do*.

| Bad | Good |
|---|---|
| "The orchestrator was designed to coordinate" | "The orchestrator coordinates" |
| "This will be handled by the pipeline" | "The pipeline handles this" |

---

## Mandatory update triggers

These are not optional. Every trigger below requires a documentation update in the same PR as the code change.

| Change | Documents to update |
|---|---|
| New or removed file in `src/` or `scripts/` | Directory structure in `CLAUDE.md` |
| New or changed env variable | `standards/environment.md`, `.env.example` |
| New standard added | `standards/README.md`, `CLAUDE.md §Standards` |
| New pipeline behavior or phase | `standards/architecture/pipeline.md` |
| New or changed mapping agent prompt, pattern vocabulary, or analysis schema | `standards/architecture/reverse-engineering.md` |
| New TypeScript schema type | `standards/architecture/pipeline.md §4` |
| New CLI option or npm script | `README.md`, `CLAUDE.md §Key commands` |
| New LLM security rule | `standards/security/llm.md` |
| New methodology rule or pattern | `CLAUDE.md`, `standards/methodology/workflow.md` |
| New dependency added | `docs/DEPENDENCIES.md` |

If a change is purely internal and truly affects no contracts, structure, or policies — state explicitly: *"Doc check: no triggers fired."* Silence is not acceptable.

---

## Freshness rules

**The staleness test:** Read the document. Does it accurately describe the current state of the code? If any sentence describes something that is no longer true, the document is stale and must be updated before the next PR merges.

**Who owns updates:** The developer making the code change owns the corresponding documentation update. It is not a follow-up ticket. It is not someone else's job. It is part of the same commit.

**Stale documentation is a bug.** It is reported, tracked, and fixed like a code bug.

---

## What belongs where

| Content | Correct location |
|---|---|
| How to use ArchMapper | `README.md` |
| Agent/developer rules for building ArchMapper | `CLAUDE.md` |
| Operational standards | `standards/` |
| Pipeline architecture specification | `standards/architecture/pipeline.md` |
| Environment variable reference | `standards/environment.md` |
| Dependency audit records | `docs/DEPENDENCIES.md` |
| In-progress notes | Never committed |

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| `TODO: update this` in a committed document | Committed TODOs are bugs that never get fixed |
| Copying a fact from one document to another | Creates two sources of truth; one will become wrong |
| "See the code for details" | Documentation that delegates to code is no documentation |
| Present tense mixed with past/future in the same section | Confuses what is current vs historical vs planned |
| Acronyms without definition on first use | Reader must look up the acronym to understand the sentence |
| Documentation written after the PR is merged | Too late — merge gate should have caught this |

---

## Self-check

- [ ] Does every changed document accurately describe the current state of the code?
- [ ] Were all trigger-table rows checked — and every fired trigger acted on?
- [ ] Is every fact stated in exactly one place?
- [ ] Is the writing plain English, active voice, present tense?
- [ ] Are there any TODOs or "see the code" deflections?
- [ ] Could a stranger at 2am understand this without opening a source file?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
