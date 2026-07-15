/**
 * Concepts built into the ***plain language itself. They are always available
 * (never reported as undefined) and are not declared in a ***definitions***
 * section. The value is the description shown when hovering the concept.
 *
 * Kept in sync with plain-language-server/src/builtins.ts.
 */
export const BUILTIN_CONCEPTS: ReadonlyMap<string, string> = new Map([
    ['Implementation', 'The system implementing the functionality.'],
    [
        'ConformanceTests',
        'The conformance tests that evaluate the :Implementation: and its conformance to the functionality.'
    ],
    [
        'AcceptanceTests',
        'A collection of acceptance test instances that validate :Implementation:.'
    ],
    [
        'UnitTests',
        'The unit tests that evaluate individual functionalities of the :Implementation:.'
    ]
]);

/** True if `name` is a built-in language concept. */
export function isBuiltinConcept(name: string): boolean {
    return BUILTIN_CONCEPTS.has(name);
}

/**
 * If `name` differs only in capitalization from a built-in concept (but isn't
 * exactly one), returns the correctly-cased built-in name; otherwise undefined.
 */
export function builtinCapitalizationMatch(name: string): string | undefined {
    if (BUILTIN_CONCEPTS.has(name)) {
        return undefined;
    }
    const lower = name.toLowerCase();
    for (const builtin of BUILTIN_CONCEPTS.keys()) {
        if (builtin.toLowerCase() === lower) {
            return builtin;
        }
    }
    return undefined;
}
