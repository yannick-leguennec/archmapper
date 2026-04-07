# Unit Test Standard

> A unit test proves that one function or module behaves correctly in complete isolation from all infrastructure. It must run in milliseconds, require no external process, and be repeatable in any environment without configuration.

**Load when:** Writing or reviewing any test that targets a single function, helper, pure logic module, or schema validator.
**Scope:** ArchMapper development only.

---

## Definition

A unit test exercises **one unit of behaviour** — a function, a module method, or a utility — with all dependencies outside that unit replaced by controlled substitutes.

**What a unit test proves:**
- Given these inputs, this function returns this output.
- Given this state, this module emits this side effect.
- Given this Zod schema, this input passes or fails validation.

**What a unit test does NOT prove:**
- That the Anthropic API integration works correctly (→ integration test with mock client).
- That the filesystem writes the correct file at the correct path (→ integration test with temp directory).
- That the full pipeline produces correct `architecture.json` from a given source tree (→ integration test).

If your unit test is trying to prove all three, split it.

---

## The FIRST properties — all five must hold

| Property | What it means | Failure signal |
|---|---|---|
| **Fast** | Runs in milliseconds. No I/O, no network, no sleep. | Test takes > 100ms |
| **Independent** | Can run alone or in any order. No shared mutable state with other tests. | Test passes only when run after another test |
| **Repeatable** | Identical result every run, in any environment, with no external setup. | Test fails on CI but passes locally |
| **Self-validating** | The test itself says pass or fail. No human must inspect output. | Test uses `console.log` to show results |
| **Timely** | Written before or alongside the code it tests — never retrofitted after the fact. | Test is added in a separate commit from the implementation |

---

## Isolation rules

### What MUST be replaced with a controlled substitute

| Dependency | Why | How in ArchMapper |
|---|---|---|
| Anthropic API client | Never hits a real provider in a unit test | Pass a mock `LlmClient` stub via the injectable interface |
| Filesystem reads/writes | File I/O is infrastructure, not logic | Pass file content as a string parameter; stub `fs` write functions |
| `Date.now()` or `new Date()` | Time makes tests non-deterministic | Pass timestamps as inputs; assert on shape not exact value |
| `crypto.randomUUID()` | Non-deterministic; breaks ID assertions | Pass IDs as inputs, or assert on shape (`/^[0-9a-f-]{36}$/`) |
| dree and dependency-cruiser | Static analysis tools with filesystem I/O | Pass pre-built tree/graph JSON as input data |

### What must NOT be mocked

- The logic under test itself — never mock the function you are testing.
- Pure data transformations — if a function takes a string and returns a string, pass the string.
- Zod schemas — validate with real schemas; they are logic, not infrastructure.
- In-memory data structures — arrays, objects, plain Maps used as accumulators are not infrastructure.

**Rule of thumb:** If replacing it makes the test faster without hiding a real defect, it is infrastructure and should be replaced. If replacing it removes the thing you are trying to prove, it must not be replaced.

---

## Mandatory structure — AAA

Every test must follow Arrange → Act → Assert in that order, exactly once each.

```typescript
it('returns null when LLM response fails Zod validation', async () => {
  // Arrange
  const invalidLlmOutput = { purpose: 'Valid purpose' }  // missing required fields
  const mockClient = createMockLlmClient(invalidLlmOutput)

  // Act
  const result = await analyzeFile('src/main.ts', 'content here', mockClient)

  // Assert
  expect(result).toBeNull()
})
```

**One Act per test.** If you find yourself calling two different functions in one test, you have two tests. Split them.

**One logical concern per test.** Multiple `expect` calls are fine when they all verify the same concern. They are not fine when they verify independent concerns — split those.

---

## Rules

1. **Name the behaviour, not the implementation.** Test names complete the sentence *"it should…"*. `it('returns null when the LLM output is missing the purpose field')` — good. `it('calls FileAnalysisSchema.safeParse')` — bad.

2. **Assert on observable outputs only.** Never assert on private state, internal variables, or implementation details. If the test breaks when you refactor without changing behaviour, you are asserting on the wrong thing.

3. **Every fallible path needs a test.** If a function can return `null`, throw, or return an error result, there must be at least one test per failure mode.

4. **Tests are the contract.** A test that passes for any implementation — correct or incorrect — is not a test. Before committing, ask: "Would this test fail if I deleted the implementation?" If not, the assertion is wrong.

5. **Fresh state per test.** Never rely on state created by a previous test. Each test sets up everything it needs in its own Arrange block.

6. **No magic numbers.** If you assert `expect(result.tokens).toBe(4096)`, explain why 4096 in a comment. Unexplained expected values rot silently when requirements change.

---

## Test file layout

Mirror the source file structure exactly:

```
src/
  orchestrator.ts
  batch-client.ts
  config.ts
  types/
    schema.ts

tests/
  unit/
    orchestrator.test.ts
    batch-client.test.ts
    types/
      schema.test.ts
```

One test file per source file. The test file lives in `tests/unit/` with the same relative path as the source file.

---

## Forbidden patterns

| Pattern | Why it fails |
|---|---|
| Shared mutable state between test cases | Test B can break because Test A left state behind |
| Real API calls in unit tests | Flaky, expensive, non-deterministic; breaks CI without credentials |
| `console.log` left in tests | Every future test run produces noise; signal disappears |
| Two Acts in one test | When it fails you cannot tell which Act caused the failure |
| Asserting on implementation details | Refactoring breaks the test without the behaviour changing |
| Tests that can never fail (`expect(true).toBe(true)`) | Gives false confidence |
| Retrofitted tests — added after the implementation was already green | Cannot prove the implementation is correct; only proves it passes today |
| Skipping the sad path | A function with error handling and no test for that path is an untested function |
| `test.skip` or `test.todo` without explicit approval | Disabled tests are invisible failures |

---

## Error path requirement

**Every function that can fail must have at least one test for each failure mode.**

For ArchMapper, the most common failure modes to test:
- Zod parse failure on LLM output (`safeParse` returns `success: false`)
- Anthropic API error (mock client throws)
- File not found or path outside scan root
- Invalid `PROJECT_NAME` format
- Malformed `progress.json` (checkpoint load failure)
- Empty scan root (zero files)

When writing a sad-path test, verify:
- The correct return value or thrown error
- No partial side effects (no partial write to `architecture.json`, no corrupt `progress.json`)
- The system is in a clean state after the failure

---

## Self-check — before marking any unit test complete

- [ ] Does this test have exactly **one Act**?
- [ ] Is the test name a complete behaviour description?
- [ ] Am I asserting on **observable output**, not internal state?
- [ ] Would this test **fail if I deleted the implementation**?
- [ ] Is there a corresponding **sad-path test** for every failure case in this function?
- [ ] Is the **Anthropic client mocked**? No real API called.
- [ ] Is there **no shared mutable state** that could affect other tests?
- [ ] Is there **no `console.log`** left in the test?
- [ ] Was this test written **before or alongside** the implementation — not after?

---

**Last updated:** 2026-04-05
**Applies to:** ArchMapper development only
