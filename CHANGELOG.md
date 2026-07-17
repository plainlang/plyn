# Change Log

All notable changes to the **plyn** extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.2]

### Added

- **Diagnostics** for `.plain` files:
  - **Definitions syntax** — inside a `***definitions***` section every top-level list item must start with a concept, e.g. `- :Concept:`. Nested detail bullets (indented), prose, `>` comments, and blank lines are allowed.
  - **Unused concept** — a concept that is defined but never used is greyed out (like an unused variable). Concepts listed in `exported_concepts:` are exempt.
  - **Undefined concept** — a concept that is used but never defined is an error, with a "Did you mean `:X:`?" hint when it differs only in capitalization from a known concept. A concept counts as defined if it is declared anywhere in the workspace, listed in `required_concepts:`, provided by a resolvable `import:`, or a built-in.
  - **Cyclic concepts** — concept definitions that reference each other in a cycle (`:A:` → `:B:` → `:A:`) are an error on each concept in the cycle.
  - **Duplicate definition** — a concept that is defined more than once is an error on each declaration.
  - **Unknown section headers** — a `***…***` header that isn't a valid section (`definitions`, `implementation reqs`, `test reqs`, `functional specs`) is an error, with a "Did you mean `***X***`?" hint for typos (e.g. `***denitions***`).
  - **Acceptance tests placement** — `***acceptance tests***` is valid only indented under a functionality inside `***functional specs***`; standalone, or nested under any other section, is an error.
  - **Built-in capitalization** — declaring a concept that differs only in case from a built-in (e.g. `:implementation:`) is a warning suggesting the built-in.
- **Built-in concepts** — `:Implementation:`, `:ConformanceTests:`, `:AcceptanceTests:`, and `:UnitTests:` are recognized as built into the language (never flagged undefined) and show a description on hover.
- **Section folding** — collapse a whole `***section***` from its header down to the next section. Works out of the box in VS Code / Cursor; in Zed, enable it with `"languages": { "***plain": { "document_folding_ranges": "on" } }` in your settings.

### Fixed

- Concepts used only on indented continuation lines are now indexed, so hover, Go to Definition, and Go to References find them.
- Hover and Go to Definition no longer report a concept's own declaration line as one of its usages.

## [0.0.1]

Initial release of **plyn**, the VS Code and Cursor extension for the `***plain` language:

- Syntax highlighting for `***plain` following its specification — keywords, types, literals, comments, operators, and quoted strings (`"text"`, `'text'`, `` `text` ``, and `<text>`).
- Concept-aware Go to Definition and Go to References (`F12` / `Shift+F12`), with definition↔usage navigation.
- Hover support showing where a concept is defined and used across the workspace.
- Rename a concept across the entire workspace (`F2`).
- `plain` file icon theme.
