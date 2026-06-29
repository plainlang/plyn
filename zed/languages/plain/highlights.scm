; Highlight queries for the ***plain language.
;
; Capture names follow the Zed-supported set documented at
; https://zed.dev/docs/extensions/languages#syntax-highlighting

; ---------------------------------------------------------------------------
; Structural anchors
; ---------------------------------------------------------------------------

; Section headers like ***definitions***, ***implementation reqs***, etc.
(section_header) @keyword

; The `---` delimiters that bracket the frontmatter block.
(frontmatter_delimiter) @punctuation.special

; ---------------------------------------------------------------------------
; Frontmatter
; ---------------------------------------------------------------------------

; Frontmatter keys: description:, required_concepts:, exported_concepts:,
; import:, requires:
(frontmatter_key) @keyword

; ---------------------------------------------------------------------------
; Inline constructs
; ---------------------------------------------------------------------------

; :concept_name: references.
(concept_ref) @variable.special

; "{{ template_expression }}" interpolations.
(template_expression) @embedded

; {% include ... %} directives.
(include_directive) @function.special

; Markdown-style links: [text](url)
(markdown_link) @link_uri

; String literals: <text>, 'text', "text", `text`
(string) @string

; Line comments: `> ...`
(comment) @comment

; List bullets at start of a line.
(bullet) @punctuation.list_marker

; ---------------------------------------------------------------------------
; Identifiers
; ---------------------------------------------------------------------------
;
; Bare identifiers carry no inherent meaning in ***plain prose, so we leave
; them unstyled by default. Themes that want to dim or color them can add
; rules for @variable.
(identifier) @variable
