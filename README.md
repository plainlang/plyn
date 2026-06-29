# plyn

**plyn** is an editor extension for **`***plain`**, a spec-driven programming language developed and maintained by *codeplain. It supports VS Code, Cursor, and Zed.

It adds first-class language support for `***plain`, so you can edit, navigate, and refactor `***plain` code with confidence.

## Features

The extension implements:

- Syntax highlighting that follows the `***plain` specification and highlights keywords, types, literals, comments, and operators for clear readability.
- Rename concept support that lets you safely rename a concept across the workspace, keeping definitions and references in sync.
- Go to definition and go to references so you can jump to where a concept is declared and see where it is used.
- Hover that shows where a concept is defined and where it is used across the workspace.
- Plain file icon theme to make `.plain` files easy to spot in the explorer.

## Installation

plyn is published to the [Open VSX Registry](https://open-vsx.org/extension/Codeplain/plyn).

- **VS Code / Cursor:** open the Extensions view and search for `plyn` (`Codeplain.plyn`).
- **From a `.vsix`:** download the latest release artifact and install it with
  `code --install-extension plyn-<version>.vsix` (or `cursor --install-extension ...`),
  or via the Extensions view → "Install from VSIX…".
- **Zed:** the Zed extension lives in the [`zed/`](zed/) directory. Install it via
  Zed → Extensions → "Install Dev Extension…" and select the `zed/` folder.

## Usage

- Open any `.plain` file to activate the language features and syntax highlighting.
- Use `F12` for Go to Definition and `Shift+F12` for Go to References.
- Hover over a concept to see where it is defined and used.
- Use `F2` to rename a concept across the project. The extension updates all
  matching references for you.

## Release Notes

### 0.0.1

Initial release of **plyn**: syntax highlighting for `***plain`, concept-aware Go to Definition / References, hover, workspace-wide rename, and a `plain` file icon theme.
