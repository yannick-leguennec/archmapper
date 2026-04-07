# Branch Naming Standard

> A branch name is a navigation label. It tells any developer — including future you — what the branch is for, which ticket it implements, and what kind of change it carries.

**Load when:** Creating a new branch.
**Scope:** ArchMapper development only.

---

## Branch model

```
main   ← stable; receives PRs from feature branches
  └── feat/AM-NNN-description   ← one per ticket
  └── fix/AM-NNN-description
  └── chore/short-description
  └── docs/short-description
```

`main` is the single permanent branch. All feature branches merge directly to `main` via pull request. Direct commits to `main` are not permitted.

---

## Branch naming format

```
<type>/AM-NNN-<short-description>
```

- **`<type>`** — one of the permitted types (see table below)
- **`AM-NNN`** — the GitHub Issue number
- **`<short-description>`** — 2–5 lowercase words, hyphen-separated, imperative form

### Examples

```
feat/AM-028-add-atomic-progress-write
fix/AM-027-fix-batch-custom-id-matching
refactor/AM-025-extract-llm-client
chore/update-dependencies
docs/add-pipeline-standard
```

---

## Permitted types

| Type | When to use | Ticket required |
|---|---|---|
| `feat` | New capability or pipeline feature | Yes |
| `fix` | Bug fix | Yes |
| `refactor` | Internal restructure, no behaviour change | Yes |
| `security` | Security control or vulnerability fix | Yes |
| `chore` | Maintenance: dep updates, config, CI adjustments | No — use a short description |
| `docs` | Documentation only — no code change | No — use a short description |

No other types are permitted.

---

## Rules

**1. One branch per ticket.** A branch maps to exactly one GitHub Issue and produces exactly one commit. If you find yourself implementing two tickets on the same branch, stop — create a second branch for the second ticket.

**2. Branch off `main`.** Always branch from the current tip of `main`. Never branch from another feature branch.

**3. Short description must be lowercase, hyphen-separated, and imperative.** No camelCase, no underscores, no uppercase.

| Bad | Good |
|---|---|
| `feat/AM-028-AtomicWrite` | `feat/AM-028-add-atomic-progress-write` |
| `fix/batchCrash` | `fix/AM-027-fix-batch-custom-id-matching` |
| `wip` | `feat/AM-030-add-folder-wave-batching` |

**4. No long-lived branches.** A branch lives from creation until its PR merges. If a branch is open for more than 2 working days, it is either blocked (resolve the blocker) or scope-crept (split the work).

**5. Delete the branch after merge.** After the PR merges, delete the branch. Merged branches that linger suggest in-progress work.

**6. No direct commits to `main`.** `main` receives code only through merged pull requests.

---

## Chore and docs branches (no ticket)

```
chore/update-zod-3-24
chore/add-ci-cache
docs/update-pipeline-standard
```

These still require a pull request — they just do not have a ticket ID in the branch name.

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| `wip`, `test`, `fix2`, `temp` | Meaningless; impossible to navigate |
| Branch without a type prefix | Cannot be filtered; type is invisible in `git branch` output |
| Branching from another feature branch | Creates fragile merge order dependencies |
| Long-lived branches accumulating multiple commits | Scope creep; merge conflicts compound |
| Uppercase letters or underscores in description | Inconsistent; hurts tab completion |
| PR that bypasses `main` protection | All changes go through PR review |

---

## Self-check

- [ ] Does the branch name start with a permitted type?
- [ ] Does the name include the ticket ID (if applicable)?
- [ ] Is the short description lowercase, hyphen-separated, and imperative?
- [ ] Is the branch based on the current tip of `main`?
- [ ] Does this branch contain work for exactly one ticket?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
