# plyn

**plyn** is an editor extension for **`***plain`**, a spec-driven programming language developed and maintained by *codeplain. It supports VS Code, Cursor, and Zed.

It adds first-class language support for `***plain`, so you can edit, navigate, and refactor `***plain` code with confidence.

## Features

The extension implements:

- Syntax highlighting that follows the `***plain` specification and highlights keywords, types, literals, comments, and operators for clear readability.
- Rename concept support that lets you safely rename a concept across the workspace, keeping definitions and references in sync.
- Go to definition and go to references so you can jump to where a concept is declared and see where it is used.
- Hover that shows where a concept is defined and where it is used across the workspace.
- Diagnostics for `***definitions***` syntax, unknown/misspelled section headers (with "did you mean" hints), and unused, undefined, cyclic, and duplicately-defined concepts.
- Section folding to collapse a whole `***section***` (definitions, test reqs, functional specs, …) down to its header.
- Plain file icon theme to make `.plain` files easy to spot in the explorer.

## Installation

plyn is published to the [Open VSX Registry](https://open-vsx.org/extension/Codeplain/plyn).

- **VS Code / Cursor:** open the Extensions view and search for `plyn` (`Codeplain.plyn`).
- **From a `.vsix`:** download the latest release artifact and install it with
  `code --install-extension plyn-<version>.vsix` (or `cursor --install-extension ...`),
  or via the Extensions view → "Install from VSIX…".
- **Zed:** the Zed extension lives in the [`zed/`](zed/) directory. Install it via
  Zed → Extensions → "Install Dev Extension…" and select the `zed/` folder.
  - **Section folding in Zed** is opt-in: Zed only folds via the language server
    when you enable it. Add this to your Zed `settings.json` (VS Code / Cursor
    need no setup — folding works out of the box there):
    ```json
    "languages": { "***plain": { "document_folding_ranges": "on" } }
    ```

## Usage

- Open any `.plain` file to activate the language features and syntax highlighting.
- Use `F12` for Go to Definition and `Shift+F12` for Go to References.
- Hover over a concept to see where it is defined and used.
- Use `F2` to rename a concept across the project. The extension updates all
  matching references for you.

## Release Notes

### 0.0.2

Adds diagnostics (definitions syntax; unused, undefined with "did you mean", cyclic, and duplicate concepts; unknown/misspelled section headers; `***acceptance tests***` placement; built-in capitalization), built-in concepts (`:Implementation:`, `:ConformanceTests:`, `:AcceptanceTests:`, `:UnitTests:`) with hover descriptions, and section folding. Fixes indexing of concepts used only on indented lines, and stops a concept's own declaration from being listed as one of its usages.

### 0.0.1

Initial release of **plyn**: syntax highlighting for `***plain`, concept-aware Go to Definition / References, hover, workspace-wide rename, and a `plain` file icon theme.
