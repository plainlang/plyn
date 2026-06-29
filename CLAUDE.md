# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`plyn` is a VS Code / Cursor extension that provides language support for **`***plain`** (language id `plain`, file extension `.plain`) — a spec-driven language by *codeplain. The extension adds syntax highlighting, concept-aware navigation (go-to-definition / find-references), hover, rename, and a file icon theme.

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

The extension's intelligence is one in-memory concept index shared by three language providers. Understanding the index and the **definition↔usage inversion** is the key to this codebase.

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

**Watch out:** the `isAConceptDefinition` helper (detects whether the cursor is on a declaration vs. a usage) is **duplicated** verbatim in `definition_provider.ts` and `hover_provider.ts`. Keep them in sync, or refactor both at once.

### The `.plain` file format (reverse-engineered from the grammar + parsers)
- Optional `---`-delimited frontmatter with keys: `description:`, `required_concepts:`, `exported_concepts:`, `import:`, `requires:` (list items use `- name`).
- Section headers on their own line: `***definitions***`, `***implementation reqs***`, `***test reqs***`, `***functional specs***`, `***acceptance tests***`.
- Concepts are `:name:` tokens; declared in `***definitions***` as `- :a:, :b:`.
- Line comments start with `>`. Templating uses `"{{ ... }}"` and `{% include ... %}`.

### Static assets
- `syntaxes/plain.tmLanguage.json` — TextMate grammar (scope `source.plain`).
- `language-configuration.json` — `>` line comment; folding driven by `***...***` markers.
- `dist/material-icons.json` + `icons/` — the `plain-icons` icon theme; maps `.plain` and language `plain` to `icons/plain.svg`.
