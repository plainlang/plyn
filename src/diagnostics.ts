import * as vscode from 'vscode';
import { PreprocessingService } from './preprocessor';
import { BUILTIN_CONCEPTS, builtinCapitalizationMatch } from './builtins';

// Diagnostics for .plain files: the strict ***definitions*** syntax rule plus
// cross-file semantic diagnostics (unused / undefined / cyclic concepts).

export const DIAGNOSTIC_SOURCE = 'plain';
export const CODE_UNUSED = 'concept-unused';
export const CODE_UNDEFINED = 'concept-undefined';
export const CODE_CYCLIC = 'concept-cyclic';
export const CODE_DID_YOU_MEAN = 'concept-did-you-mean';
export const CODE_UNKNOWN_SECTION = 'unknown-section';
export const CODE_ACCEPTANCE_TESTS = 'acceptance-tests-placement';

// A section header on its own line, e.g. "***definitions***".
const SECTION_HEADER = /^\*\*\*[^*]+\*\*\*$/;

// Top-level section names (lowercased), at column 0. Mirrors tree-sitter-plain's
// TOP_SECTION_NAMES.
const TOP_SECTIONS = [
    'definitions',
    'implementation reqs',
    'test reqs',
    'functional specs'
];

// `acceptance tests` is special: not a standalone section — only allowed
// indented under a functionality inside ***functional specs***.
const ACCEPTANCE_TESTS = 'acceptance tests';

// All valid names, used only for "did you mean" suggestions.
const VALID_SECTIONS = [...TOP_SECTIONS, ACCEPTANCE_TESTS];

// A well-formed definitions list item starts with a concept token right after
// the "- " bullet, e.g. "- :Concept:" or "- :A:, :B:". The concept name uses
// the same character class as the rest of the extension: [+\-\.0-9A-Z_a-z].
const VALID_DEFINITION_ITEM = /^-\s+:[+\-\.0-9A-Z_a-z]+:/;

/**
 * Validates the ***definitions*** sections of a .plain document.
 *
 * Rule: every list item inside a definitions section must start with a concept
 * definition, e.g. "- :Concept:". Prose, comments and blank lines are allowed
 * and left untouched — only malformed list items are reported.
 */
export function computeDefinitionsDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    let inDefinitionsSection = false;

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex);
        const trimmed = line.text.trim();

        // Track which section we are in. Any header other than definitions ends
        // the definitions section.
        if (SECTION_HEADER.test(trimmed)) {
            const section = trimmed.replace(/\*/g, '').toLowerCase().trim();
            inDefinitionsSection = section === 'definitions';
            continue;
        }

        if (!inDefinitionsSection) {
            continue;
        }

        // Only list items are subject to the rule; blank lines, comments (">")
        // and prose are valid content inside a definitions section.
        if (!trimmed.startsWith('-')) {
            continue;
        }

        // Nested sub-items (indented by more than one space) are free-form
        // detail lines under a definition — e.g. an attribute list — not new
        // concept declarations, so the rule does not apply to them.
        const start = line.firstNonWhitespaceCharacterIndex;
        if (start > 1) {
            continue;
        }

        if (VALID_DEFINITION_ITEM.test(trimmed)) {
            continue;
        }

        const range = new vscode.Range(lineIndex, start, lineIndex, line.text.length);
        const diagnostic = new vscode.Diagnostic(
            range,
            'Invalid ***definitions*** syntax: every list item must start with a concept definition, e.g. "- :Concept:".',
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = DIAGNOSTIC_SOURCE;
        diagnostic.code = 'definitions-item-missing-concept';
        diagnostics.push(diagnostic);
    }

    return diagnostics;
}

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        let prev = dp[0];
        dp[0] = i;
        for (let j = 1; j <= n; j++) {
            const tmp = dp[j];
            dp[j] = Math.min(
                dp[j] + 1,
                dp[j - 1] + 1,
                prev + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            prev = tmp;
        }
    }
    return dp[n];
}

/** Closest valid section within a small edit distance, else undefined. */
function closestSection(name: string): string | undefined {
    let best: string | undefined;
    let bestDist = Infinity;
    for (const section of VALID_SECTIONS) {
        const d = editDistance(name, section);
        if (d < bestDist) {
            bestDist = d;
            best = section;
        }
    }
    return bestDist <= 3 ? best : undefined;
}

/**
 * Validates section headers: a `***...***` line whose name is not one of the
 * known sections is an error, with a "Did you mean" hint when it's a near-miss.
 */
export function computeSectionDiagnostics(document: vscode.TextDocument): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    // Most recent column-0 (top-level) section header — used to validate the
    // placement of nested `acceptance tests`.
    let currentTopSection = '';

    for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
        const line = document.lineAt(lineIndex);
        const trimmed = line.text.trim();
        if (!SECTION_HEADER.test(trimmed)) {
            continue;
        }
        const name = trimmed.replace(/\*/g, '').trim();
        const lower = name.toLowerCase();
        const start = line.firstNonWhitespaceCharacterIndex;
        const range = new vscode.Range(lineIndex, start, lineIndex, line.text.length);

        if (lower === ACCEPTANCE_TESTS) {
            // Must be indented under a functionality inside ***functional specs***;
            // never standalone. Does not change the top-level section.
            let message: string | undefined;
            if (start === 0) {
                message = '***acceptance tests*** cannot be a standalone section — indent it under a functionality in ***functional specs***.';
            } else if (currentTopSection !== 'functional specs') {
                message = '***acceptance tests*** is only allowed indented under a functionality in ***functional specs***.';
            }
            if (message) {
                const diagnostic = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Error);
                diagnostic.source = DIAGNOSTIC_SOURCE;
                diagnostic.code = CODE_ACCEPTANCE_TESTS;
                diagnostics.push(diagnostic);
            }
            continue;
        }

        if (start === 0) {
            currentTopSection = lower;
        }

        if (!TOP_SECTIONS.includes(lower)) {
            const suggestion = closestSection(lower);
            const diagnostic = new vscode.Diagnostic(
                range,
                suggestion
                    ? `Unknown section ***${name}***. Did you mean ***${suggestion}***?`
                    : `Unknown section ***${name}***. Valid sections: ${VALID_SECTIONS.map(s => `***${s}***`).join(', ')}.`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = DIAGNOSTIC_SOURCE;
            diagnostic.code = CODE_UNKNOWN_SECTION;
            diagnostics.push(diagnostic);
        }
    }

    return diagnostics;
}

/**
 * Finds every concept in a reference cycle, mapping it to a representative
 * cycle path starting and ending at that concept (e.g. ['a', 'b', 'a']).
 */
function detectCycles(
    graph: Map<string, Set<string>>,
    definedNames: Set<string>
): Map<string, string[]> {
    const inCycle = new Map<string, string[]>();
    const color = new Map<string, number>(); // 1 = on stack, 2 = done
    const stack: string[] = [];

    const visit = (node: string): void => {
        color.set(node, 1);
        stack.push(node);
        for (const next of graph.get(node) ?? []) {
            if (!definedNames.has(next)) {
                continue;
            }
            if (color.get(next) === 1) {
                const cycle = stack.slice(stack.indexOf(next));
                for (let i = 0; i < cycle.length; i++) {
                    const member = cycle[i];
                    if (!inCycle.has(member)) {
                        inCycle.set(member, [...cycle.slice(i), ...cycle.slice(0, i), member]);
                    }
                }
            } else if (color.get(next) !== 2) {
                visit(next);
            }
        }
        stack.pop();
        color.set(node, 2);
    };

    for (const node of definedNames) {
        if (!color.get(node)) {
            visit(node);
        }
    }
    return inCycle;
}

function conceptTokenRange(line: number, character: number, name: string): vscode.Range {
    return new vscode.Range(line, character, line, character + name.length + 2);
}

/**
 * Computes the cross-file semantic diagnostics for one file, using the
 * workspace-wide model held by the preprocessing service:
 *  - unused    (Hint + Unnecessary) — defined but never referenced;
 *  - undefined (Error)              — referenced but never defined;
 *  - cyclic    (Error)              — definitions that reference each other.
 *
 * Mirrors plain-language-server/src/semantics.ts.
 */
export function computeSemanticDiagnostics(
    service: PreprocessingService,
    filePath: string
): vscode.Diagnostic[] {
    const agg = service.getSemanticAggregate();
    const diagnostics: vscode.Diagnostic[] = [];
    const cycles = detectCycles(agg.graph, agg.definedNames);

    // unused & cyclic: anchored at declaration sites in this file.
    for (const site of service.definitionSitesInFile(filePath)) {
        const name = site.concept;

        const cyclePath = cycles.get(name);
        if (cyclePath) {
            const diagnostic = new vscode.Diagnostic(
                conceptTokenRange(site.line, site.character, name),
                `Cyclic concept definition: ${cyclePath.map(c => `:${c}:`).join(' → ')}.`,
                vscode.DiagnosticSeverity.Error
            );
            diagnostic.source = DIAGNOSTIC_SOURCE;
            diagnostic.code = CODE_CYCLIC;
            diagnostics.push(diagnostic);
            continue;
        }

        // Wrong capitalization of a built-in, e.g. declaring `:implementation:`.
        const builtinMatch = builtinCapitalizationMatch(name);
        if (builtinMatch) {
            const diagnostic = new vscode.Diagnostic(
                conceptTokenRange(site.line, site.character, name),
                `:${name}: differs only in capitalization from the built-in concept :${builtinMatch}:. Did you mean :${builtinMatch}:?`,
                vscode.DiagnosticSeverity.Warning
            );
            diagnostic.source = DIAGNOSTIC_SOURCE;
            diagnostic.code = CODE_DID_YOU_MEAN;
            diagnostics.push(diagnostic);
            continue;
        }

        const isUsed = agg.usedNames.has(name) || agg.exportedNames.has(name);
        if (!isUsed) {
            // Grey out the whole declaration line, like an unused statement.
            const declLine = site.content ?? '';
            const range = declLine
                ? new vscode.Range(site.line, 0, site.line, declLine.length)
                : conceptTokenRange(site.line, site.character, name);
            const diagnostic = new vscode.Diagnostic(
                range,
                `Concept :${name}: is defined but never used.`,
                vscode.DiagnosticSeverity.Hint
            );
            diagnostic.source = DIAGNOSTIC_SOURCE;
            diagnostic.code = CODE_UNUSED;
            diagnostic.tags = [vscode.DiagnosticTag.Unnecessary];
            diagnostics.push(diagnostic);
        }
    }

    // undefined: anchored at usage sites in this file. A concept is "known" if
    // built into the language, defined anywhere in the workspace, listed in
    // `required_concepts:`, or provided by a resolvable `import:`.
    const known = new Set<string>([
        ...BUILTIN_CONCEPTS.keys(),
        ...agg.definedNames,
        ...agg.requiredNames,
        ...service.importedConceptNames(filePath)
    ]);
    // Lowercased index of known names, for capitalization "did you mean" hints.
    const knownByLower = new Map<string, string>();
    for (const k of known) {
        knownByLower.set(k.toLowerCase(), k);
    }

    for (const site of service.usageSitesInFile(filePath)) {
        const name = site.concept;
        if (known.has(name)) {
            continue;
        }
        const suggestion = knownByLower.get(name.toLowerCase());
        const diagnostic = new vscode.Diagnostic(
            conceptTokenRange(site.line, site.character, name),
            suggestion
                ? `Concept :${name}: is used but never defined. Did you mean :${suggestion}:?`
                : `Concept :${name}: is used but never defined (missing concept definition).`,
            vscode.DiagnosticSeverity.Error
        );
        diagnostic.source = DIAGNOSTIC_SOURCE;
        diagnostic.code = CODE_UNDEFINED;
        diagnostics.push(diagnostic);
    }

    return diagnostics;
}
