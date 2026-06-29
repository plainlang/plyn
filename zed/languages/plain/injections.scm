; Language injections for the ***plain grammar.
;
; The frontmatter block of a ***plain file is conceptually a small slice of
; YAML. Injecting the YAML grammar (when available in the host editor)
; gives users richer highlighting for keys, values, and list items inside
; the block. Zed will silently ignore the injection if the YAML grammar is
; not installed.
;
; We currently do not inject any language inside template expressions
; ("{{ ... }}") because the template DSL is not formalised; revisit once it
; is.

; Note: We have no node that spans the entire frontmatter block (the
; grammar treats each frontmatter line as a top-level line). If a future
; revision of the grammar introduces a `(frontmatter)` node, an injection
; like the one below can replace the current no-op:
;
; ((frontmatter) @injection.content
;  (#set! injection.language "yaml"))
