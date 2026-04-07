# Reading & Analyzing a Reverse-Engineered Architecture

> The definitive guide for agents and developers on how to read, navigate, query, and reason about ArchMapper's reverse-engineering output. This standard ensures that any agent tasked with answering questions about an analyzed codebase does so with full context, accurate references, and architectural depth.

**Load when:** An agent or developer is asked to answer questions about a codebase that has been reverse-engineered by ArchMapper. This includes questions about how the technology works, architectural improvement suggestions, module relationships, design pattern analysis, or any conversation that uses `architecture.json` and `specs/` as its knowledge base.

**Scope:** Applies to any agent consuming ArchMapper output — not limited to ArchMapper development.

---

## 1. What the output contains

An ArchMapper run produces these artifacts under `architecture/<PROJECT_NAME>/`:

| File | What it contains | When to use it |
|---|---|---|
| `architecture.json` | Every file analysis + every module synthesis + project summary. The complete structured knowledge base. | Programmatic queries, searching for specific files/exports/imports, cross-referencing dependencies. |
| `specs/<module>.md` | One human-readable Markdown spec card per module. Contains: purpose, public API, patterns, cross-cutting concerns, children, notes. | Reading and understanding modules. Start here for any question about "how does X work?" |
| `raw-tree.json` | The complete file/folder tree of the analyzed codebase. | Understanding the physical structure — what files exist where. |
| `progress.json` | Per-item metadata: tokens used, duration, timestamps. | Cost analysis, debugging which files were slow or expensive. |

### The two data layers

**File layer** (`architecture.json → files[]`): One entry per source file. Contains the file's purpose, exports, imports, key abstractions, patterns, and notes. This is the **factual foundation** — what each file actually does.

**Module layer** (`architecture.json → modules[]` and `specs/*.md`): One entry per folder/module. Contains the synthesized understanding built from all child files and submodules. This is the **architectural understanding** — how pieces fit together.

The module layer is built bottom-up from the file layer. A module's purpose is a synthesis of its children, not a guess. This means module-level claims are traceable to specific file-level facts.

---

## 2. How to navigate — the reading order

### For "What is this project?"

```
1. Read specs/root.md         → Project identity, top-level purpose
2. Read specs/src.md          → How the source is organized, key children, architectural notes
3. Scan the Children list     → Identify the major subsystems
4. Read 3-5 key module specs  → Understand the core architectural layers
```

### For "How does feature X work?"

```
1. Search architecture.json for the feature name in file purposes and exports
   → Find which files mention it
2. Identify which module(s) contain those files
   → Read the module spec card
3. Read the module's children list
   → Understand what sub-components make up the feature
4. Read the relevant file entries in architecture.json
   → Understand each file's specific role, imports, and patterns
5. Follow the import chain
   → Trace dependencies to understand the data flow
```

### For "How could we improve this architecture?"

```
1. Read specs/src.md (or the top-level module) — focus on the Notes section
   → ArchMapper flags architectural smells and decomposition candidates
2. Search architecture.json for files with notes containing:
   "candidate for splitting", "tech debt", "circular dependency",
   "god-object", "dumping ground", "duplication"
3. Look for modules with very long Children lists (10+ files)
   → These often lack internal structure
4. Look for cross-cutting concerns that appear everywhere
   → These are candidates for centralization
5. Look for modules where publicApi is very large
   → These may have unclear boundaries
```

---

## 3. How to answer questions — the agent protocol

When an agent receives a question about an analyzed codebase, follow this protocol:

### Step 1: Determine the question type

| Question type | What the user wants | Where to look |
|---|---|---|
| "What does X do?" | Functional understanding | Module spec card + file entries |
| "How does X work?" | Internal mechanics, data flow | File entries (imports, exports, patterns) + follow the import chain |
| "Why is X designed this way?" | Architectural rationale | Module notes + pattern identification + cross-cutting concerns |
| "How could we improve X?" | Architectural critique | Module notes + pattern analysis + smell detection |
| "What depends on X?" | Impact analysis | Search all file imports for X; search module publicApi for X's exports |
| "What would break if we changed X?" | Risk assessment | Reverse dependency search — who imports from X? |
| "How do A and B relate?" | Relationship mapping | Find both in architecture.json, trace shared imports/exports |
| "Give me an overview" | High-level summary | root.md → src.md → top module spec cards |

### Step 2: Gather context (before answering)

**Never answer from a single spec card.** Always cross-reference:

1. **Read the module spec card** — get the synthesized understanding
2. **Read the relevant file entries** in `architecture.json` — get the specific facts
3. **Follow the imports** — understand what this code depends on
4. **Search for reverse dependencies** — understand what depends on this code
5. **Check the notes** — ArchMapper flags non-obvious observations

### Step 3: Structure the answer

Every answer about an analyzed codebase should follow this structure:

```
1. DIRECT ANSWER (1-3 sentences)
   → Answer the question immediately. No preamble.

2. HOW IT WORKS (detailed explanation)
   → Walk through the relevant modules and files
   → Reference specific file paths and exports
   → Explain the data flow or architectural pattern

3. KEY RELATIONSHIPS (what connects to what)
   → What does this depend on? (imports)
   → What depends on this? (reverse deps)
   → What patterns does it use?

4. NOTABLE OBSERVATIONS (from the notes)
   → Architectural smells flagged by ArchMapper
   → Tech debt, circular dependencies, decomposition candidates
   → Cross-cutting concerns

5. EVIDENCE (specific references)
   → "According to the analysis of src/tools/BashTool/bashSecurity.ts..."
   → "The module spec for src/services notes that..."
   → Always cite the specific file or module that supports the claim
```

### Step 4: Verify claims against evidence

**Every architectural claim must be traceable to a specific entry in `architecture.json` or a spec card.** Do not:
- Guess about file contents (you have the analysis — use it)
- Assume imports that aren't listed
- Claim patterns that aren't identified
- Invent relationships not supported by the dependency data

If the analysis doesn't cover something, say so: *"The reverse-engineering output does not include runtime behavior analysis, so I cannot confirm how this performs under load."*

---

## 4. Common query patterns with examples

### Pattern A: "How does the tool permission system work?"

**Agent protocol:**
1. Search `architecture.json` for files with "permission" in purpose or exports
2. Find: `src/tools/BashTool/bashPermissions.ts`, `src/utils/permissions/*.ts`, `src/hooks/toolPermission/*.ts`
3. Read the module spec cards for each
4. Trace the import chain: tool → permissions hook → permission rules → user config
5. Answer with the full flow, citing each file's role

### Pattern B: "How could we improve the src/commands module?"

**Agent protocol:**
1. Read `specs/src_commands.md` — note the children count, patterns, and notes
2. Count the children (if 50+ files, that's a smell)
3. Check if there's a barrel export or if each command is independent
4. Look at the cross-cutting concerns — are they handled consistently?
5. Read the notes for flagged issues
6. Answer with specific, evidence-backed improvement suggestions:
   - "The module has 80 direct children with no sub-grouping — consider grouping by domain (git commands, file commands, session commands)"
   - "According to the analysis, src/commands/commit.ts and src/commands/commit-push-pr.ts share substantial logic — candidate for extraction"

### Pattern C: "What would break if we refactored the bootstrap module?"

**Agent protocol:**
1. Read `specs/src_bootstrap.md` — understand what it provides
2. Search `architecture.json` for all files that import from `src/bootstrap`
3. Count and categorize the dependents
4. Check if the bootstrap module's notes mention "god-object" or "singleton" concerns
5. Answer with the impact radius:
   - "42 files across 12 modules import from src/bootstrap/state.ts"
   - "The module provides the session state singleton consumed by virtually every subsystem"
   - "A refactor would need to update all 42 consumers or provide a compatibility shim"

---

## 5. Answering "improvement" questions — the framework

When asked "how could we improve X?", use this structured approach:

### 5a. Identify the current state

Read the module spec card and file entries. Document:
- Current structure (file count, nesting depth, patterns)
- Current cross-cutting concerns
- Current notes (ArchMapper-flagged issues)
- Current public API size

### 5b. Apply architectural heuristics

| Heuristic | Signal | Suggestion |
|---|---|---|
| Module has 15+ direct children | Flat dumping ground | Group into sub-modules by domain |
| Module has very large publicApi (20+ items) | Unclear boundary | Curate the API; internalize helpers |
| Same cross-cutting concern in 5+ modules | Decentralized infrastructure | Centralize into a shared module |
| Notes mention "circular dependency" | Coupling smell | Break the cycle with an interface/abstraction |
| Notes mention "god-object" or "singleton" | Excessive centralization | Decompose into focused services |
| Notes mention "duplication" between modules | DRY violation | Extract shared logic |
| File with 10+ imports | High coupling | Consider facade or dependency injection |
| Module with no identified patterns | Lack of structure | Evaluate if intentional or accidental |

### 5c. Structure the recommendation

```
OBSERVATION: What the analysis shows (cite the spec card or file entry)
PROBLEM:     Why this is architecturally concerning
SUGGESTION:  Specific, actionable improvement
IMPACT:      What would change, what would improve, what risks exist
EVIDENCE:    Which files/modules support this recommendation
```

**Never suggest improvements without citing evidence from the analysis.** "I think this could be cleaner" is not a recommendation. "The src/utils module has 22 subfolders with no shared theme (per the module notes), suggesting it functions as a catch-all — consider domain-based grouping" is a recommendation.

---

## 6. Working with architecture.json programmatically

### Searching for a file

```
Look in architecture.json → files[] → find by path
```

Each file entry has: `path`, `purpose`, `exports`, `imports`, `keyAbstractions`, `patterns`, `notes`, `tokensUsed`

### Searching for a module

```
Look in architecture.json → modules[] → find by path
— or —
Open specs/<path_with_underscores>.md
```

Each module entry has: `path`, `purpose`, `children`, `publicApi`, `patterns`, `crossCuttingConcerns`, `notes`, `tokensUsed`

### Finding all files that import from a given module

```
Search architecture.json → files[] → where imports[] contains the target path
```

### Finding all modules that implement a cross-cutting concern

```
Search architecture.json → modules[] → where crossCuttingConcerns[] contains the concern
```

### Finding all files that use a specific pattern

```
Search architecture.json → files[] → where patterns[] contains the pattern name
```

---

## 7. Limitations — what the analysis does NOT tell you

| Not covered | Why | What to do instead |
|---|---|---|
| Runtime behavior | Only static structure is analyzed | Read the source code or run the application |
| Performance characteristics | No profiling data | Profile the running application |
| Test coverage | Tests are analyzed as files, but coverage isn't measured | Run the test suite with coverage |
| Git history / evolution | Only the current snapshot is analyzed | Use `git log`, `git blame` |
| Environment-specific behavior | Feature flags, env vars analyzed as config but runtime effects unknown | Check deployment configs |
| Third-party library internals | Only the imports are listed, not what they do | Read the library documentation |
| Correctness | The analysis describes what code does, not whether it's correct | Code review, testing |

When a question touches these areas, acknowledge the limitation explicitly: *"The reverse-engineering output describes the static architecture but does not capture runtime performance. To answer this fully, profiling data would be needed."*

---

## 8. Quality signals — how to judge the analysis

### Signs of a good analysis

- **Purpose is specific**: "Validates incoming HTTP request bodies against Zod schemas" — not "handles validation"
- **Exports are complete**: Every public identifier is listed
- **Patterns are evidence-based**: "factory" because `createClient()` returns instances
- **Notes are actionable**: "Circular dependency with routes.ts via deferred import"
- **Module publicApi is curated**: Not the union of all child exports, but the intended interface

### Signs to be cautious about

- **Purpose is vague**: "Contains utility functions" — may need deeper investigation
- **Empty patterns on a complex file**: The file may have patterns that weren't identified
- **Very short purpose for a large file**: The analysis may have been truncated
- **Notes field empty on a complex module**: Not necessarily wrong, but worth investigating manually

---

## Forbidden patterns

| Pattern | Why |
|---|---|
| Answering without reading the relevant spec card and file entries | Produces shallow, inaccurate answers |
| Citing a module without specifying which spec card or file entry | Unverifiable claims |
| Suggesting improvements without evidence from the analysis | Groundless recommendations |
| Assuming runtime behavior from static analysis | The analysis doesn't cover runtime |
| Treating the analysis as ground truth without caveats | It's a snapshot, not a live oracle |
| Ignoring the Notes field | Contains the most valuable non-obvious observations |
| Reading only one layer (files or modules, but not both) | Misses the connection between facts and synthesis |
| Guessing about imports not listed in the analysis | Invents relationships that may not exist |

---

## Self-check — before answering any question about an analyzed codebase

- [ ] Did I read the relevant module spec card(s)?
- [ ] Did I check the file-level entries in `architecture.json` for supporting detail?
- [ ] Did I follow the import chain to understand dependencies?
- [ ] Did I search for reverse dependencies (who imports from this)?
- [ ] Did I check the Notes field for flagged architectural observations?
- [ ] Does every claim I'm making trace to a specific entry in the analysis?
- [ ] Did I acknowledge limitations where the analysis doesn't cover something?
- [ ] Is my answer structured (direct answer → how it works → relationships → observations → evidence)?

---

**Last updated:** 2026-04-07
**Applies to:** Any agent or developer consuming ArchMapper output
