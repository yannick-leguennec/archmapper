# Commit Message Standard

> A commit message is a permanent record. It is read more often than it is written — during bisect, blame, incident response, code review, and onboarding. Every commit message must make the next reader's job easier, not harder.

**Load when:** Writing any commit message.
**Scope:** ArchMapper development only.

---

## Format

```
AM-NNN Imperative description (72 characters max including the ID)

- What changed and why — one bullet per logical change
- Why this approach was chosen over alternatives, if non-obvious
- Any side effects or follow-up tickets created

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

### The three parts

**Subject line** — required, always.
**Body** — required when the change is non-trivial. Optional only for single-line fixes where the subject is completely self-explanatory.
**Co-author line** — required whenever an AI assistant contributed to the implementation.

---

## Subject line rules

### Rule 1: Ticket ID first

Every commit is tied to a GitHub Issue. The ID comes first.

```
AM-028 Add atomic write for progress.json checkpoint
```

No ticket? Do not commit. Create an issue first — even for a one-line fix. An unlabelled commit cannot be bisected, reverted cleanly, or audited.

### Rule 2: Imperative mood

Write as if completing the sentence: *"If applied, this commit will…"*

| Bad | Good |
|---|---|
| `Added atomic write` | `Add atomic write for progress.json checkpoint` |
| `Fixes crash in orchestrator` | `Fix crash when scan root contains zero source files` |
| `Batch polling` | `Add exponential backoff to batch polling loop` |

**Approved imperative verbs:**

| Verb | Use case |
|---|---|
| `Add` | New feature, new file, new capability |
| `Fix` | Bug fix — something was broken |
| `Update` | Change to existing functionality that is not a bug fix |
| `Remove` | Delete a feature, file, or dead code |
| `Refactor` | Restructure without changing behaviour |
| `Extract` | Pull a utility out of a larger module |
| `Rename` | File or identifier rename |

### Rule 3: 72-character limit, including the ticket ID

```
AM-028 Add atomic write for progress.json checkpoint
^───────────────────────────────────────────────────^
72 characters maximum
```

If you cannot describe the change in 72 characters, the commit is probably doing too many things. Split it.

### Rule 4: No period at the end of the subject line

### Rule 5: No vague subjects

| Bad | Good |
|---|---|
| `AM-028 Fix bug` | `AM-028 Fix crash when scan root contains zero source files` |
| `AM-028 Updates` | `AM-028 Update folder-wave ordering to handle single-file directories` |
| `AM-028 WIP` | Never commit WIP |

---

## Body rules

### When to include a body

Always include a body unless the subject line is completely self-explanatory and the change is a single, obvious action.

When in doubt — include the body. A future reader finding it unnecessary is a minor annoyance. A future reader needing it and finding it absent is a real cost.

### What belongs in the body

- **What changed** — which files, which logic, what behaviour
- **Why this approach** — if there was a non-obvious choice, explain it; alternatives considered
- **Side effects** — anything else affected; follow-up tickets created

### What does NOT belong in the body

- How the code works (the code shows that)
- Narration of implementation steps
- Content that belongs in `docs/` or `standards/` — put it there instead

### Formatting

- Blank line between subject and body — required
- Bullet points with `-` prefix
- No line longer than 72 characters in the body
- Plain English — no jargon, no abbreviations

### Example

```
AM-031 Add Zod validation for folder-wave LLM output

- Adds ModuleAnalysisSchema.safeParse() call before merging into
  architecture.json; failures recorded in progress.json failed[]
- Chosen over try/catch on JSON.parse: Zod gives field-level error
  details which are logged for debugging
- Follow-up: AM-032 will add --retry-failed CLI flag to reprocess
  items in the failed[] array

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

---

## Breaking changes

If a commit changes the `architecture.json` schema, `progress.json` shape, or any behaviour that requires coordinated updates, mark it explicitly:

```
AM-035 Remove 'notes' field from FileAnalysis schema

- Removes the optional notes field; LLM prompts updated to not
  request it
- Existing architecture.json files with a notes field will still
  parse (Zod strips extra fields); no migration needed for existing
  checkpoints

BREAKING CHANGE: architecture.json files generated before this
commit have a different schema. Regenerate with --force to update.
```

---

## Co-author line

Whenever an AI assistant contributed meaningfully to the implementation, include the co-author line as the last line of the message, after a blank line:

```
Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

"Contributed meaningfully" means: wrote code, designed logic, or produced the test. It does not apply to asking Claude to explain something or review a sentence.

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| Commit without a ticket ID | No traceability — cannot bisect, revert, or audit |
| `git add -A` or `git add .` without reviewing what is staged | Risk of committing `.env`, `architecture/` artifacts, or `project/` source code |
| Subject line in past tense | Convention violation — use imperative |
| Subject line over 72 characters | Truncated in most tools |
| Vague subject: "fix bug", "updates", "WIP" | Zero diagnostic value |
| Body that narrates how the code works | Belongs in code comments, not commit messages |
| Amending a commit that has been pushed to a shared branch | Rewrites shared history |
| Missing co-author line when AI assisted | Inaccurate attribution |

---

## Self-check

- [ ] Does the subject line start with the ticket ID (`AM-NNN`)?
- [ ] Is the verb imperative?
- [ ] Is the subject line 72 characters or fewer?
- [ ] No period at the end of the subject?
- [ ] Is there a body (unless the change is a single obvious action)?
- [ ] Does the body explain WHY, not HOW?
- [ ] Are there any debug artefacts, secrets, or unrelated files staged?
- [ ] If a breaking change: is `BREAKING CHANGE:` in the body?
- [ ] If AI assisted: is the co-author line present?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
