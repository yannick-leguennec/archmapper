# ArchMapper — Dependency Audit Trail

Every dependency in `package.json` must have a corresponding entry here. Entries are appended, never overwritten — the full history is the audit trail.

---

## @anthropic-ai/sdk@0.39.0

**Purpose:** Official Anthropic SDK for all LLM API calls (messages, batches, token counting).
**Evaluated:** 2026-04-06
**Approved by:** Owner

### Evaluation

| Criterion | Result | Notes |
|---|---|---|
| Maintenance | PASS | Active development by Anthropic. Last commit: recent. |
| Popularity | PASS | Official SDK. Widely used. |
| Security track record | PASS | No known CVEs. Maintained by Anthropic directly. |
| Ownership | PASS | Published by `@anthropic-ai` org, matches GitHub repo. |
| Dependency footprint | PASS | Minimal transitive dependencies. |
| Licence | PASS | MIT. |
| Source auditability | PASS | Published from public GitHub repo. |
| Version pinning | PASS | Pinned to exact version 0.39.0. |
| Necessity | PASS | Core dependency — no alternative for Anthropic API access. |

**Overall:** APPROVED
**Verdict:** Official SDK, essential for all LLM functionality.

---

## zod@3.24.2

**Purpose:** Schema validation for all LLM outputs and internal data structures.
**Evaluated:** 2026-04-06
**Approved by:** Owner

### Evaluation

| Criterion | Result | Notes |
|---|---|---|
| Maintenance | PASS | Actively maintained by Colin McDonnell. |
| Popularity | PASS | 35M+ weekly downloads. Industry standard. |
| Security track record | PASS | No known CVEs. |
| Ownership | PASS | Consistent publisher. |
| Dependency footprint | PASS | Zero runtime dependencies. |
| Licence | PASS | MIT. |
| Source auditability | PASS | Published from public GitHub repo. |
| Version pinning | PASS | Pinned to 3.24.2. |
| Necessity | PASS | Required for LLM output validation — core safety control. |

**Overall:** APPROVED
**Verdict:** Zero-dependency schema validation. Industry standard. Essential for LLM safety.

---

## zod-to-json-schema@3.24.5

**Purpose:** Converts Zod schemas to JSON Schema format for Anthropic structured output (tool use).
**Evaluated:** 2026-04-06
**Approved by:** Owner

### Evaluation

| Criterion | Result | Notes |
|---|---|---|
| Maintenance | PASS | Actively maintained. Tracks Zod releases closely. |
| Popularity | PASS | 3M+ weekly downloads. Standard companion to Zod. |
| Security track record | PASS | No known CVEs. |
| Ownership | PASS | Consistent publisher (Stefan Bauer). |
| Dependency footprint | PASS | Only peer-depends on Zod (already installed). |
| Licence | PASS | ISC. |
| Source auditability | PASS | Published from public GitHub repo. |
| Version pinning | PASS | Pinned to 3.24.5. |
| Necessity | PASS | Needed to convert Zod schemas for Anthropic tool input_schema. Alternative would be manual JSON Schema duplication — violates DRY. |

**Overall:** APPROVED
**Verdict:** Bridges Zod and Anthropic structured output. Avoids maintaining two schema definitions.

---

## dree@5.1.2

**Purpose:** Generates structured file/directory trees for the static analysis phase.
**Evaluated:** 2026-04-06
**Approved by:** Owner

### Evaluation

| Criterion | Result | Notes |
|---|---|---|
| Maintenance | PASS | Maintained by Giacomo Cerquone. Regular releases. |
| Popularity | PASS | Established package with consistent usage. |
| Security track record | PASS | No known CVEs. |
| Ownership | PASS | Consistent publisher matches GitHub repo. |
| Dependency footprint | WARN | Has some transitive dependencies. Acceptable for a filesystem utility. |
| Licence | PASS | MIT. |
| Source auditability | PASS | Published from public GitHub repo. |
| Version pinning | PASS | Pinned to 5.1.2. |
| Necessity | PASS | Alternatives considered: manual fs.readdir recursion. dree provides structured output, exclusion patterns, and metadata. Worth the dependency. |

**Overall:** APPROVED
**Verdict:** Solid filesystem tree utility. Saves implementing recursive directory walking.

---

## dotenv@16.4.7

**Purpose:** Loads `.env` file into `process.env` at startup.
**Evaluated:** 2026-04-06
**Approved by:** Owner

### Evaluation

| Criterion | Result | Notes |
|---|---|---|
| Maintenance | PASS | Maintained by motdotla. Industry standard. |
| Popularity | PASS | 25M+ weekly downloads. |
| Security track record | PASS | No known CVEs. |
| Ownership | PASS | Consistent publisher. |
| Dependency footprint | PASS | Zero runtime dependencies. |
| Licence | PASS | BSD-2-Clause. |
| Source auditability | PASS | Published from public GitHub repo. |
| Version pinning | PASS | Pinned to 16.4.7. |
| Necessity | PASS | Node.js has no built-in .env loading. Standard solution. |

**Overall:** APPROVED
**Verdict:** Zero-dependency .env loader. Industry standard.

---

## Dev Dependencies

### typescript@5.7.3

**Purpose:** TypeScript compiler.
**Licence:** Apache-2.0. **Overall:** APPROVED.

### vitest@3.0.9

**Purpose:** Test runner. TypeScript-native, fast.
**Licence:** MIT. **Overall:** APPROVED.

### tsx@4.19.3

**Purpose:** TypeScript execution for scripts (used by `npm run analyze`).
**Licence:** MIT. **Overall:** APPROVED.

### @types/node@22.13.14

**Purpose:** TypeScript type definitions for Node.js.
**Licence:** MIT. **Overall:** APPROVED.
