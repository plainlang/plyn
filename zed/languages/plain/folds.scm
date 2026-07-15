; Fold each ***section*** (its header line plus the body beneath it, down to
; the next section header or end of file), like collapsing a Markdown heading.
; Relies on the `section` node from tree-sitter-plain.
(section) @fold
