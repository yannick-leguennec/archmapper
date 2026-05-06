# Contributing to ArchMapper

Thanks for considering a contribution. ArchMapper is built and maintained by The Wise Duck Dev as time allows, so please be patient on response times.

## Reporting bugs or proposing features

Open a GitHub Issue. The more specific, the better:

- What you expected to happen
- What actually happened (full error message + stack trace if any)
- Steps to reproduce (a small failing test case is best)
- Your environment: OS, Node version, Anthropic SDK version, target codebase shape (size, language)

For security-sensitive reports (e.g. a way to bypass the prompt-injection defenses or the path-traversal protection), please email `wiseduckdev@gmail.com` directly rather than opening a public issue.

## Development setup

```bash
git clone git@github.com:yannick-leguennec/archmapper.git
cd archmapper
npm install
cp .env.example .env   # fill in ANTHROPIC_API_KEY and PROJECT_NAME
npm test
```

Drop the codebase you want to analyze under `project/` (or set `SCAN_ROOT`), then `npm run analyze`.

## Before opening a PR

ArchMapper has a strong set of operational standards under `standards/`. Reading the right ones before submitting code will save us both review cycles. The non-negotiables:

- `CLAUDE.md` — project-wide rules and forbidden patterns. Read this first.
- `standards/methodology/workflow.md` — the ticket-to-commit sequence (baseline test, outcome map, failing test, implementation, typecheck, docs, security review, commit).
- `standards/methodology/code-quality.md` — SOLID, DRY, KISS, YAGNI in the context of this project.
- `standards/typescript.md` — TypeScript conventions (no `any`, no `as` on unvalidated data, named exports only, etc.).
- `standards/git/commits.md` — commit format. `AM-NNN Imperative description`, ≤ 72 chars subject, body explains *why*.
- `standards/git/branches.md` — branch naming. `feat/AM-NNN-description`, `fix/AM-NNN-description`, etc.

If your change touches the LLM integration, prompts, output validation, or any file-read path: also load `standards/security/llm.md` before writing code.

If your change adds a dependency: load `standards/security/supply-chain.md` and complete the 9-criterion evaluation in `docs/DEPENDENCIES.md`.

## PR checklist

- [ ] One ticket, one branch, one commit
- [ ] `npm test` passes (no skipped tests, no pre-existing failures)
- [ ] `npm run typecheck` passes cleanly
- [ ] No `any`, no `as` on unvalidated data, no `// @ts-ignore` in the diff
- [ ] All affected documentation updated in the same commit (see the trigger table in `standards/documentation/writing.md`)
- [ ] No `console.log` / `console.error` in committed code (use the structured logger)
- [ ] No API keys, file contents, or full source code in any log statement
- [ ] Co-author line in the commit message if an AI assistant contributed

## Code of conduct

Be respectful. Disagreements happen — keep them about the code.

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [LICENSE](LICENSE)).
