# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`plyn` is a VS Code / Cursor extension that provides language support for **`***plain`** (language id `plain`, file extension `.plain`) — a spec-driven language by *codeplain. The extension adds syntax highlighting, concept-aware navigation (go-to-definition / find-references), hover, rename, diagnostics, and a file icon theme.

## Sibling repo: `plain-language-server` (keep in sync — IMPORTANT)

The same language intelligence ships **twice**, and the two implementations are deliberate ports of each other:

- **This repo (`plyn`)** — the VS Code / Cursor extension; providers run in-process against the `vscode` API.
- **`../plain-language-server`** — an editor-agnostic LSP (used by the Zed extension in `zed/`, which installs it from npm) that speaks LSP over stdio.

**Rule: any change to language *behaviour* — indexing, diagnostics, hover, go-to-definition, rename, the concept regexes, or the built-in concept list — must be made in BOTH repos in the same change, and must not be allowed to drift.** Rough file mapping:

| plyn (VS Code) | plain-language-server (LSP) |
|---|---|
| `src/preprocessor.ts` (`PreprocessingService`, `ConceptExtractor`) | `src/indexer.ts` |
| `src/diagnostics.ts` (syntax + cross-file semantics) | `src/diagnostics.ts` (syntax) + `src/semantics.ts` (cross-file) |
| `src/hover_provider.ts` | `src/hover.ts` |
| `src/definition_provider.ts` | `src/definition.ts` |
| `src/rename_provider.ts` | `src/rename.ts` |
| `src/folding_provider.ts` | `src/folding.ts` |
| `src/builtins.ts` | `src/builtins.ts` |

**Folding** — each `***section***` collapses to its header:
- **VS Code / Cursor** — the `FoldingRangeProvider` (`src/folding_provider.ts`); works out of the box.
- **Zed** — via the LSP `textDocument/foldingRange` (served by `plain-language-server`), but **only when the user opts in** with `"languages": { "***plain": { "document_folding_ranges": "on" } }` in their Zed `settings.json` (Zed defaults LSP folding off, and there is no way for the extension to preset it — `document_folding_ranges` is a `settings.json` field, not a `config.toml` one). Zed has **no `folds.scm` support**, and its indent-based folding can't fold non-indented section content — so the LSP path is the only one that works there. The `tree-sitter-plain` `section` node and `zed/languages/plain/folds.scm` are consequently **not used by Zed**; they're kept only for tree-sitter-native tools (e.g. Neovim) that do read `folds.scm`.
- **Other LSP clients** (Neovim/Helix/…) — get folding from `textDocument/foldingRange` directly.

`plain-language-server` has the only real test harness, so treat it as the shared safety net: after any behaviour change, `cd ../plain-language-server && npm run build && node scripts/e2e.js` (and `node scripts/smoke.js`), and extend `scripts/fixtures/` + the e2e assertions to cover the new behaviour. `plyn` has no tests; verify its port with the same fixtures if needed.

**Build gotcha:** run `npx tsc` / `npm run build` from each repo's own root. A `cd` inside a single compound shell command persists, so building one project right after `cd`-ing into the other silently recompiles the wrong repo (its `out/` goes stale).

## Third repo: `tree-sitter-plain` (the Zed grammar — maintain alongside)

The language actually spans **three** repos. Besides `plyn` and `plain-language-server`, the Zed extension gets its syntax highlighting (and any tree-sitter-driven structural feature) from a separate grammar repo, **`tree-sitter-plain`** (`https://github.com/plainlang/tree-sitter-plain`).

- `zed/extension.toml` pins it by commit SHA under `[grammars.plain]` (`repository` + `rev`). **Zed clones and builds the grammar from that repo + rev at install time — it does NOT use the local `zed/grammars/plain/` checkout.** Editing `zed/grammars/plain/` (a convenience clone of the same repo, currently at the pinned SHA) has no effect on an installed extension.
- Canonical local clone: a sibling `tree-sitter-plain` checkout (`../tree-sitter-plain`) — do grammar work there. The copy under `zed/grammars/plain/` is just a build-convenience checkout pinned to the SHA.
- The grammar owns `grammar.js` (token/node rules), the generated `src/parser.c`, `test/corpus` (parser tests), and `queries/` (`highlights.scm`, `brackets.scm`, `injections.scm`). Zed also reads the extension-side query copies in `zed/languages/plain/`.

**Maintenance rule:** anything about the *token / parse structure or syntax scopes* of `***plain` — new tokens, changed node shapes, highlight scopes, or (e.g.) a `section` node to make Zed fold sections — is a change to `tree-sitter-plain`. To ship it: edit `grammar.js`, run `tree-sitter generate` (regenerates `src/parser.c`), update `test/corpus` and run `tree-sitter test`, commit, then **bump the `rev` SHA in `zed/extension.toml`**. Keep the highlight scopes in step with the TextMate grammar `syntaxes/plain.tmLanguage.json` (used by VS Code) so both editors highlight `.plain` the same way.

## Build & develop

There is no `scripts` block in `package.json` and no test or lint setup. The build is driven entirely by `scripts/compile.sh`.

```bash
npx tsc                      # compile src/ -> out/ (tsconfig: commonjs, es2020, strict)
./scripts/compile.sh 0.0.1   # full build: clean out/, tsc, vsce package, then reinstall into code AND cursor
```

`scripts/compile.sh <version>`:
- Requires a version argument (matches `package.json` `version`; `vsce` reads the version from `package.json`, so they must agree or the install/uninstall lines won't find `plyn-<version>.vsix`).
- `cd`s to the repo root, so it works from any directory.
- Uninstalls + installs the packaged `.vsix` in **both** `code` and `cursor`.

**Packaging gotcha:** `out/` and `dist/` are both gitignored but both are required to package. `package.json` points `main` at `./out/extension.js` (produced by `tsc`) and the icon theme at `./dist/material-icons.json`. `compile.sh` regenerates `out/` but **not** `dist/material-icons.json` — that file plus the `icons/` SVG set must already exist locally.

To debug interactively: open the folder in VS Code and press `F5` (Extension Development Host).

## Architecture

The extension's intelligence is one in-memory concept index shared by its language providers and diagnostics. Understanding the index and the **definition↔usage inversion** is the key to this codebase.

### Indexing pipeline (`src/preprocessor.ts`)
- **`FileScanner`** recursively finds `.plain` files in the workspace, skipping `node_modules`, `.git`, `dist`, `build`, `out`, `.vscode`, and any dotfolder.
- **`ConceptExtractor.processFile`** parses each file into two lists of `ConceptDefinition`:
  - `definedConcepts` — concepts *declared* inside a `***definitions***` section, written as list items like `- :concept_a:, :concept_b:`.
  - `usedConcepts` — every `:concept:` token (regex `:[+\-\.0-9A-Z_a-z]+:`) appearing in spec text outside definitions, tagged with the `***section***` it sits under. Indented lines are folded into the preceding non-indented line (`prevSpecText`) so a concept is reported once per logical statement.
- **`PreprocessingService`** holds two maps, `definedConceptIndex` and `usedConceptIndex` (concept name → `ConceptDefinition[]`, since the same concept can appear in many files). It exposes `findConceptDefinition()` / `findConceptUsage()`, a full `rebuildIndex()`, and incremental `processFileUpdate()` (removes a file's entries, then re-extracts).

### Activation & freshness (`src/extension.ts`)
`activate()` builds the `PreprocessingService`, kicks off async initial indexing, and registers the three providers for `{ language: 'plain' }`. The index is kept live by a `FileSystemWatcher('**/*.plain')` and an `onDidChangeTextDocument` listener (debounced 500ms). It also registers a `plain.rebuildIndex` command **programmatically only** — it is not declared in `package.json` `contributes.commands`, so it won't show in the command palette.

### The three providers (all share `PreprocessingService`)
- **`PlainDefinitionProvider`** (F12) — concept navigation is *inverted*: if the cursor is on a concept's **declaration** (inside `***definitions***`, on a `- :x:` line) it jumps to that concept's **usages**; otherwise it jumps to the concept's **definitions**. Falls back to file-resolution for `import:` / `requires:` frontmatter entries, resolving `<identifier>` → `<identifier>.plain` in the same dir or under the `template` / `templates` / `imports` search folders.
- **`PlainHoverProvider`** — same inversion; renders occurrences grouped by file and section.
- **`PlainRenameProvider`** (F2) — renames a concept across all its **usages** workspace-wide, editing only the name between the colons. Validates the new name against `^[+\-\.0-9A-Z_a-z]+$`.

**Usages vs. own declaration:** `usedConceptIndex` records *every* `:concept:` token, **including the one on a concept's own `- :concept:` declaration line**. Hover and go-to-definition therefore call `findConceptUsageExcludingDefinition` (usages minus the concept's own declaration line) so a definition isn't reported as its own usage; **rename** deliberately uses the full `findConceptUsage` so it *also* renames the declaration. Keep that split when editing (and mirror it in the LSP's `hover.ts` / `definition.ts` / `rename.ts`).

**Watch out:** the `isAConceptDefinition` helper (detects whether the cursor is on a declaration vs. a usage) is **duplicated** verbatim in `definition_provider.ts` and `hover_provider.ts`. Keep them in sync, or refactor both at once.

### Diagnostics (`src/diagnostics.ts`, mirrored by the LSP's `diagnostics.ts` + `semantics.ts`)

Published via a `DiagnosticCollection`. The syntax rule is per-buffer; the rest are **workspace-wide** (they need the whole index), so `extension.ts` recomputes and re-publishes them for every open document after each reindex.

- **Definitions syntax** (error) — inside a `***definitions***` section every **top-level** list item must start with a concept, e.g. `- :Concept:`. Items indented by more than one space (nested detail bullets), prose, `>` comments, and blank lines are exempt.
- **Unknown section** (error) — a `***...***` header whose name isn't one of `definitions`, `implementation reqs`, `test reqs`, `functional specs` (the column-0 top sections, mirroring `tree-sitter-plain`'s `TOP_SECTION_NAMES`) is flagged; a near-miss (edit distance ≤ 3) appends "Did you mean ***X***?".
- **Acceptance tests placement** (error) — `***acceptance tests***` is **not** a standalone section: it is valid only **indented** under a functionality inside a `***functional specs***` section. At column 0 (standalone), or nested under any other top section, it's an error. (The section validator tracks the current column-0 top section to enforce this.)
- **Unused concept** (Hint + `Unnecessary`; greys the whole declaration line) — defined but never referenced. `exported_concepts:` are exempt.
- **Undefined concept** (error) — a used concept that is not *known*. A concept is known if declared anywhere in the workspace, listed in `required_concepts:`, provided by a resolvable `import:` (`<name>.plain` in the file's dir or a `template`/`templates`/`imports` subfolder), or a built-in. When an unknown name differs only in capitalization from a known one, the message appends "Did you mean :X:?".
- **Cyclic concepts** (error) — a definition-reference cycle (`:A:` → `:B:` → `:A:`), flagged on each concept in the cycle.
- **Wrong capitalization of a built-in** (warning) — declaring a concept that differs only in case from a built-in (e.g. `:implementation:`) suggests the built-in.

Note: usages are folded per **logical statement** (a non-indented line plus its indented children), so a concept used only on an indented sub-line is still indexed — the whole statement counts as one usage, attributed to the concept's first occurrence.

### Built-in concepts (`src/builtins.ts`)

`:Implementation:`, `:ConformanceTests:`, `:AcceptanceTests:`, `:UnitTests:` are built into the language: always *known* (never flagged undefined), must **not** be declared in `***definitions***`, and hover shows a fixed description instead of index results. The registry (name → hover description) lives in `src/builtins.ts` and is mirrored in the LSP; edit both. To add a built-in, add it here and in `../plain-language-server/src/builtins.ts`.

### The `.plain` file format (reverse-engineered from the grammar + parsers)
- Optional `---`-delimited frontmatter with keys: `description:`, `required_concepts:`, `exported_concepts:`, `import:`, `requires:` (list items use `- name`).
- Section headers on their own line: `***definitions***`, `***implementation reqs***`, `***test reqs***`, `***functional specs***`, `***acceptance tests***`.
- Concepts are `:name:` tokens; declared in `***definitions***` as `- :a:, :b:`.
- Line comments start with `>`. Templating uses `"{{ ... }}"` and `{% include ... %}`.

### Static assets
- `syntaxes/plain.tmLanguage.json` — TextMate grammar (scope `source.plain`).
- `language-configuration.json` — `>` line comment. (Section folding is a `FoldingRangeProvider` in `src/folding_provider.ts`, not marker-based — marker folding could not fold the final section.)
- `dist/material-icons.json` + `icons/` — the `plain-icons` icon theme; maps `.plain` and language `plain` to `icons/plain.svg`.
