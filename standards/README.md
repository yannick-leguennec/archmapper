# ArchMapper — Standards

Operational rules for building ArchMapper. Each file in this directory covers one specific concern and is loaded on demand — only when the task at hand requires it.

**Scope:** All standards in this directory apply exclusively to the development of ArchMapper itself. They do not govern what happens inside analyzed repositories.

**Usage:** `CLAUDE.md §Load when` specifies when to load each standard. Load the file, read it fully, then proceed with the task.

---

## Index

| Domain | Standard | File | Load when |
|--------|----------|------|-----------|
| Methodology | Ticket-to-commit workflow | [methodology/workflow.md](methodology/workflow.md) | Starting any ticket, bug fix, or refactor |
| Methodology | Code quality principles | [methodology/code-quality.md](methodology/code-quality.md) | Writing new code, reviewing a PR, or refactoring |
| TypeScript | TypeScript language standard | [typescript.md](typescript.md) | Writing or reviewing any `.ts` file |
| Environment | Environment variables standard | [environment.md](environment.md) | Adding or changing any environment variable |
| Architecture | Pipeline architecture standard | [architecture/pipeline.md](architecture/pipeline.md) | Working on any part of the analysis pipeline (scan, file phase, folder waves, batches, resume, artifacts) |
| Architecture | Reverse-engineering methodology | [architecture/reverse-engineering.md](architecture/reverse-engineering.md) | Writing or modifying the mapping agent prompt, analysis schemas, output quality criteria, or pattern vocabulary |
| Testing | Unit test standard | [testing/unit.md](testing/unit.md) | Writing or reviewing any unit test |
| Testing | Integration test standard | [testing/integration.md](testing/integration.md) | Writing or reviewing any integration or pipeline test |
| Security | LLM & pipeline security | [security/llm.md](security/llm.md) | Any LLM call, prompt construction, batch request, output validation, or file-read path feeding a prompt |
| Security | Supply chain | [security/supply-chain.md](security/supply-chain.md) | Adding, updating, or evaluating any dependency |
| Git | Branch naming standard | [git/branches.md](git/branches.md) | Creating a new branch |
| Git | Commit message standard | [git/commits.md](git/commits.md) | Writing any commit message |
| Documentation | Writing standard | [documentation/writing.md](documentation/writing.md) | Creating or updating any document in `docs/` or `standards/` |
| Debugging | Universal debug process | [debugging/process.md](debugging/process.md) | Any bug, crash, failing test, or regression |
| Analysis | Reading & analyzing architecture output | [analysis/reading-architecture.md](analysis/reading-architecture.md) | Answering questions about a reverse-engineered codebase, architectural review, or improvement recommendations |

---

## How to add a new standard

1. Create the file in the appropriate subfolder (or create a new subfolder for a new domain).
2. Choose the template that matches the standard type:

**Implementation standard** — testing, security, error handling, pipeline behavior:
   - **Definition** — what this standard covers and what it proves
   - **Isolation rules** — what must / must not be mocked or bypassed
   - **Mandatory structure** — the required format or sequence
   - **Rules** — numbered, specific, verifiable
   - **Forbidden patterns** — named anti-patterns with one-line explanations
   - **Error path requirement** — explicit sad-path coverage rules
   - **Self-check** — yes/no checklist before marking work complete

**Convention/process standard** — git, naming, documentation, workflow (how to do things):
   - **Definition** — what this standard governs and why it exists
   - **Rules** — numbered, specific, verifiable (with examples)
   - **Forbidden patterns** — named anti-patterns with one-line explanations
   - **Self-check** — yes/no checklist before marking work complete

Every standard, regardless of type, must end with `**Last updated:** YYYY-MM-DD` and `**Applies to:** ArchMapper development only`.

3. Add one row to the index table above.
4. Add one line to `CLAUDE.md §Standards` referencing the new standard and its load condition.

That is all. No other files need to change.

---

**Last updated:** 2026-04-06
