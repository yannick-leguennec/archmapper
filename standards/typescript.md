# TypeScript Standard

> TypeScript is the primary language of ArchMapper. Every rule in this file exists to make the type system do real work — not to look typed while hiding bugs behind `any`, `as`, or ignored errors. A TypeScript file that passes the type checker must actually be correct, not just decorated with types.

**Load when:** Writing or reviewing any `.ts` file.
**Scope:** ArchMapper development only.

---

## tsconfig.json — mandatory settings

Every `tsconfig.json` in the project must enable these flags:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

| Flag | Why |
|---|---|
| `strict` | Enables `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes`, and the full strict family |
| `noUncheckedIndexedAccess` | `array[0]` returns `T \| undefined`, not `T` — forces index access to be nullable-aware |
| `exactOptionalPropertyTypes` | `{ a?: string }` distinguishes `string \| undefined` from absent |
| `noImplicitReturns` | Every code path must explicitly return a value |
| `noFallthroughCasesInSwitch` | Every switch case must break, return, or throw |

Run `npm run typecheck` before every commit. Green tests with type errors is not done.

---

## Rules

### Rule 1: No `any` — ever

`any` disables the type system entirely. It is not a type; it is an opt-out.

```typescript
// Bad
function parseLlmResponse(raw: any): any { ... }
catch (error: any) { logger.error(error.message) }

// Good
function parseLlmResponse(raw: unknown): FileAnalysis { ... }
catch (error) {
  const message = error instanceof Error ? error.message : String(error)
}
```

**The one exception:** Third-party library types that are genuinely untyped and cannot be augmented. Must be commented: `// any: untyped third-party — <library name>`.

---

### Rule 2: No `as` type assertions — except after Zod validation

`as SomeType` tells TypeScript to trust you instead of verify. It bypasses the type system at exactly the point where the type system is most needed: the boundary between unknown LLM output and typed internal code.

```typescript
// Bad
const analysis = JSON.parse(llmOutput) as FileAnalysis

// Good
const result = FileAnalysisSchema.safeParse(JSON.parse(llmOutput))
if (!result.success) { /* handle */ }
const analysis = result.data  // typed by Zod inference
```

**Permitted exceptions:**
- After Zod `.parse()` or `.safeParse()`, a single `as` on the Zod output is acceptable if the assertion is provably correct and narrower than what Zod infers.
- `as const` is a const assertion, not a type assertion — it narrows a literal type rather than widening it. `as const` is permitted on validated configuration objects (e.g. the `config` export in `src/config.ts`) and on literal arrays/objects where TypeScript needs to infer narrow types.

---

### Rule 3: No `// @ts-ignore` or `// @ts-expect-error`

These suppress real errors. Find and fix the root cause. If the error comes from a buggy third-party type definition, use module augmentation or a local type override — do not ignore the error.

---

### Rule 4: `unknown` for genuinely unknown values

When a value comes from outside the type system (LLM response, `JSON.parse`, `catch` clause, filesystem read), type it as `unknown`. Then narrow explicitly before use.

```typescript
// Good
async function parseBatchResult(raw: unknown): Promise<FileAnalysis | null> {
  const result = FileAnalysisSchema.safeParse(raw)
  if (!result.success) return null
  return result.data
}
```

---

### Rule 5: `async/await` only — no `.then()/.catch()` chains

All asynchronous code uses `async/await`. Promise chains are harder to read, harder to debug, and harder to type correctly.

```typescript
// Bad
anthropic.messages.create(params)
  .then(res => processResponse(res))
  .catch(err => handleError(err))

// Good
try {
  const res = await anthropic.messages.create(params)
  processResponse(res)
} catch (error) {
  handleError(error)
}
```

**Exception:** `Promise.all()`, `Promise.allSettled()`, `Promise.race()` — use these when genuinely running concurrent operations. Always `await` the result.

---

### Rule 6: `interface` for extendable objects, `type` for everything else

```typescript
// interface — for objects that describe a shape and may be extended
interface LlmClient {
  sendMessage(params: MessageParams): Promise<MessageResponse>
}

// type — for unions, primitives, computed types, function signatures
type PipelinePhase = 'static' | 'files' | 'folders' | 'done'
type AnalyzeFileFn = (path: string, client: LlmClient) => Promise<FileAnalysis | null>
```

Never use `enum`. Use union types instead. Enums compile to runtime objects and cause tree-shaking issues.

---

### Rule 7: Meaningful generic type parameter names

Single-letter generics (`T`, `K`, `V`) are acceptable only for truly generic utility types. Any generic that has a domain meaning gets a full name.

```typescript
// Good — generic utility, T is appropriate
function first<T>(array: readonly T[]): T | undefined {
  return array[0]
}

// Bad — domain-specific but single-letter
function getAnalysis<T>(map: Map<string, T>, path: string): T | undefined { ... }

// Good — domain-specific, full name
function getAnalysis<TAnalysis extends FileAnalysis | ModuleAnalysis>(
  map: Map<string, TAnalysis>,
  path: string
): TAnalysis | undefined { ... }
```

---

### Rule 8: `readonly` for function parameters that must not be mutated

```typescript
// Good
function buildPrompt(analyses: readonly FileAnalysis[]): string { ... }
function mergeProgress(state: Readonly<ProgressState>): ProgressState { ... }
```

---

### Rule 9: Named exports only — no default exports

Default exports break traceability: IDEs cannot rename them reliably, `grep` finds inconsistent names, and re-exports create ambiguity.

```typescript
// Good
export function analyzeFile(path: string, client: LlmClient): Promise<FileAnalysis | null> { ... }
export type { FileAnalysis, ModuleAnalysis, Architecture }

// Bad
export default function analyzeFile(...) { ... }
```

---

### Rule 10: Import ordering — enforced consistently

Three groups, each separated by a blank line:

```typescript
// Group 1: external packages
import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'

// Group 2: internal modules (relative or aliased paths)
import { config } from './config'
import { FileAnalysisSchema } from './types/schema'

// Group 3: type-only imports
import type { FileAnalysis, ProgressState } from './types/schema'
```

Type imports use `import type` — not mixed with value imports.

---

### Rule 11: Typed `catch` clauses — always

TypeScript types `error` as `unknown` in `catch` clauses under `strict`. Never widen it back to `any`.

```typescript
// Good
catch (error) {
  if (error instanceof Error) {
    logger.error('Pipeline step failed', { error_type: error.constructor.name, message: error.message })
  } else {
    logger.error('Pipeline step failed: unknown error', { error_type: String(error) })
  }
}

// Bad
catch (error: any) {
  logger.error(error.message)
}
```

---

### Rule 12: Nullability — `undefined` over `null`

Use `undefined` for internal optional/absent values. `null` is reserved for values explicitly set to "no value" by an external system (API response nulls, JSON null from LLM output).

```typescript
// Good — internal optional return
function findCompletedAnalysis(path: string, state: ProgressState): FileAnalysis | undefined { ... }

// Acceptable — LLM JSON may return null for optional fields
const notes: string | null = parsedLlmOutput.notes  // from Zod schema with .nullable()
// Convert at the boundary:
const notesInternal: string | undefined = notes ?? undefined
```

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| `any` without the documented exception comment | Disables the type system |
| `as SomeType` on unvalidated LLM or filesystem data | Bypasses the exact boundary that needs checking |
| `// @ts-ignore` or `// @ts-expect-error` | Hides real type errors |
| `.then().catch()` promise chains | Harder to read, type, and debug than async/await |
| `enum` declarations | Runtime overhead; use union types |
| Default exports | Breaks IDE traceability and grep consistency |
| Mixed value and type imports (`import { type Foo, bar }`) | Use `import type` for type-only imports |
| Single-letter generics on domain-specific functions | Forces reader to mentally substitute the type |
| `null` for internal absence values | Use `undefined` — `null` is for external system boundaries |
| `noUncheckedIndexedAccess` workarounds (`array[0]!`) | Fix the logic — do not assert away nullable array access |
| `Set<string>` or `Map` in any persisted JSON structure | Not JSON-serializable; produces `{}` or `[]` silently |

---

## Self-check — before committing any TypeScript file

- [ ] `npm run typecheck` passes cleanly — no errors, no suppressions?
- [ ] No `any` without the documented exception comment?
- [ ] No `as` on unvalidated data — all LLM and external input goes through Zod first?
- [ ] No `// @ts-ignore` or `// @ts-expect-error`?
- [ ] All async code uses `async/await` — no `.then()/.catch()` chains?
- [ ] All `catch` clauses handle `unknown` — not widened to `any`?
- [ ] Named exports only — no `export default`?
- [ ] Import groups ordered correctly with blank-line separators?
- [ ] `interface` for object shapes, `type` for unions and computed types?
- [ ] No `enum` — union types used instead?
- [ ] `readonly` on parameters that must not be mutated?
- [ ] No `Set` or `Map` in any data structure that will be JSON-persisted?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
