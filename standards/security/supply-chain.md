# Supply Chain Security Standard

> Controls for dependency evaluation, lock file integrity, vulnerability scanning, and vendor trust assessment. Every dependency added to ArchMapper is a potential attack surface — evaluate rigorously and minimise.

**Load when:** Adding, updating, or removing any dependency from `package.json`, or evaluating a new library.
**Scope:** ArchMapper development only.

---

## Why supply chain matters

A compromised dependency is a compromised tool. ArchMapper reads source files from analyzed codebases and calls the Anthropic API — a supply chain attack that exfiltrates analyzed source code or API keys via a malicious package would be a serious incident. The `event-stream`, `ua-parser-js`, and `xz` incidents are real-world examples at production scale.

Mitigation strategy: minimize the dependency surface, evaluate every addition rigorously, and enforce lock file integrity.

---

## 1. The mandatory evaluation gate

**No new dependency may be added without:**
1. Completing the full 9-criterion evaluation below (all criteria assessed and documented).
2. Explicit owner approval.
3. An entry recorded in `docs/DEPENDENCIES.md`.

**First question — always ask before evaluating:** Can Node.js stdlib, TypeScript built-ins, or an existing dependency already solve this? If yes, use it. A dependency not added is a dependency that cannot be compromised.

---

## 2. Evaluation criteria

| Criterion | What to check | Red flags |
|---|---|---|
| **Maintenance** | Last commit date, open issues, maintainer responsiveness | No commits in 12+ months; maintainer unresponsive |
| **Popularity and adoption** | Weekly downloads, GitHub stars, used by known projects | < 1k weekly downloads with no credible users |
| **Security track record** | Known CVEs, responsible disclosure process | Unresolved critical CVEs; no security contact |
| **Ownership** | Who controls the npm package; does it match the GitHub repo owner? | Ownership transferred recently; anonymous maintainer |
| **Dependency footprint** | Count of transitive dependencies | > 20 transitive deps for a simple utility |
| **Licence** | Compatible with a proprietary CLI tool (see §5) | GPL, AGPL, or unknown licence |
| **Source auditability** | Is the published package built from the public repo? | Build artifacts differ from source; minified-only publish |
| **Version pinning** | Can we pin to a specific version? | Requires a floating range that allows auto-upgrades |
| **Necessity** | Can stdlib or an existing dependency solve this? | If yes → reject; do not add a new dependency |

**Default answer is no.** A dependency must pass every criterion. Any red flag is a rejection unless a documented exception is approved and recorded.

---

## 3. Evaluation output format

```
## <package-name>@<version>

**Purpose:** <one sentence — what problem does this solve in ArchMapper?>
**Evaluated:** <date>
**Approved by:** <owner>

### Evaluation

| Criterion | Result | Notes |
|---|---|---|
| Maintenance | PASS / FAIL / WARN | Last commit: <date>. |
| Popularity | PASS / FAIL / WARN | <N> weekly downloads. |
| Security track record | PASS / FAIL / WARN | CVEs: <none / list>. |
| Ownership | PASS / FAIL / WARN | Publisher matches repo owner: <yes/no>. |
| Dependency footprint | PASS / FAIL / WARN | <N> transitive deps. |
| Licence | PASS / FAIL / WARN | <licence>. Compatible: <yes/no>. |
| Source auditability | PASS / FAIL / WARN | Published matches source: <yes/no>. |
| Version pinning | PASS / FAIL / WARN | Pinned to exact version: <yes/no>. |
| Necessity | PASS / FAIL / WARN | Alternatives considered: <what was checked>. |

**Overall:** APPROVED / REJECTED
**Verdict:** <one sentence summary>
```

A record with any FAIL is a rejection. A WARN requires a written exception reason.

---

## 4. Dependency update policy

Every update — patch, minor, or major — must go through a defined process. "It's just a patch" is not a reason to skip controls; many supply chain attacks are delivered as patch-level updates.

| Update type | Required process |
|---|---|
| **Security patch** (CVE fix) | Re-run full 9-criterion evaluation. Fast-track approval — target: merged within 48 hours of CVE disclosure. |
| **Minor version** | Re-run full 9-criterion evaluation. Changelog reviewed. Standard approval. |
| **Major version** | Re-run full 9-criterion evaluation. Changelog and migration guide reviewed. Treated as a new dependency decision. |

**Rule:** The 9-criterion evaluation is re-run for every update. The `docs/DEPENDENCIES.md` entry is appended with a new dated record — never overwrite the previous record.

---

## 5. Licence allowlist

| Licence | Status | Notes |
|---|---|---|
| MIT | **Allowed** | Standard permissive |
| Apache 2.0 | **Allowed** | Permissive; includes patent grant |
| BSD-2-Clause | **Allowed** | Permissive |
| BSD-3-Clause | **Allowed** | Permissive; adds non-endorsement clause |
| ISC | **Allowed** | Functionally equivalent to MIT |
| CC0-1.0 | **Allowed** | Public domain dedication |
| Unlicense | **Allowed** | Public domain |
| GPL-2.0 / GPL-3.0 | **Rejected** | Copyleft — incompatible with a proprietary tool |
| AGPL-3.0 | **Rejected** | Network copyleft — especially dangerous for a tool that may be run as a service |
| Unknown / no licence | **Rejected** | No rights granted; legally unusable |

---

## 6. Lock file integrity

| Control | Detail |
|---|---|
| `package-lock.json` (or `yarn.lock`) committed with every `package.json` change | Prevents silent version drift on fresh installs |
| Lock file verified in CI before install | Any divergence blocks the build |
| Prefer exact version pins for security-sensitive packages | `"zod": "3.22.4"` over `"^3"` |

---

## 7. Vulnerability scanning

| Control | Detail |
|---|---|
| `npm audit` run before adding any new dependency | Catches known CVEs before the package enters the lock file |
| Existing dependencies re-scanned periodically (target: monthly) | Catches newly disclosed CVEs on already-installed packages |
| Any dependency with a critical or high CVE is a blocker | Patch or replace before merging |

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| Adding a dependency without the 9-criterion evaluation | Unevaluated supply chain risk |
| Committing `package.json` without the lock file | Allows silent version drift |
| Ignoring a CVE because "it does not affect our code path" | CVEs are not always precisely scoped; assume worst case |
| Dependency without a `docs/DEPENDENCIES.md` entry | No audit trail |
| Overwriting a previous `DEPENDENCIES.md` entry instead of appending | Destroys audit history |
| Using a dependency for a problem that Node.js stdlib solves | Unnecessary supply chain exposure |
| Licence not on the allowlist without a documented exception | Licence compatibility risk for a proprietary product |

---

## Self-check

- [ ] Was the first question asked — can stdlib or an existing dependency solve this?
- [ ] Were all 9 evaluation criteria assessed and documented?
- [ ] Did every criterion result in PASS or a documented WARN?
- [ ] Is the package licence on the allowlist in §5?
- [ ] Is the evaluation record appended to `docs/DEPENDENCIES.md`?
- [ ] Is the lock file committed alongside `package.json`?
- [ ] Was `npm audit` run and returned no critical/high CVEs?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
