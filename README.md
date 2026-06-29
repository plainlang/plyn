# plyn

**plyn** is a VS Code and Cursor extension for **`***plain`**, a spec-driven programming language developed and maintained by *codeplain.

It adds first-class language support for `***plain`, so you can edit, navigate, and refactor `***plain` code with confidence.

## Features

The extension implements:

- Syntax highlighting that follows the ***plain specification and highlights keywords, types, literals, comments, and operators for clear readability.
- Rename concept support that lets you safely rename a concept across the workspace, keeping definitions and references in sync.
- Go to definition and go to references so you can jump to where a concept is declared and see where it is used.
- Plain file icon theme to make `.plain` files easy to spot in the explorer.

## Usage

- Open any `.plain` file to activate the language features and syntax highlighting.
- Use `F12` for Go to Definition and `Shift+F12` for Go to References.
- Use `F2` to rename a concept across the project. The extension updates all
  matching references for you.

## Release Notes

### 0.0.1

Initial release of **plyn**: syntax highlighting for `***plain`, concept-aware Go to Definition / References, hover, workspace-wide rename, and a `plain` file icon theme.
