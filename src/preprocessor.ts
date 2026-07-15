import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ===== INTERFACES =====

export interface ConceptDefinition {
    concept: string;           // The concept name (e.g., "user_profile") 
    filePath: string;          // Full path to the .plain file
    line: number;              // Line number where concept is defined
    character: number;         // Character position on the line
    content?: string;          // Optional: the full definition content
    section?: string;          // Optional: the section where the concept is defined
}

export interface ConceptIndex {
    [conceptName: string]: ConceptDefinition[];  // Multiple files can define same concept
}

export interface FileProcessingResult {
    filePath: string;
    definedConcepts: ConceptDefinition[];
    usedConcepts: ConceptDefinition[];
    semantics: FileSemantics;
    error?: string;
}

/**
 * Per-file semantic facts used for cross-file diagnostics (unused / undefined /
 * cyclic concepts).
 */
export interface FileSemantics {
    /** Edges [a, b]: concept `a`'s definition references concept `b`. */
    edges: Array<[string, string]>;
    /** Concepts actually used (referenced outside their own definition). */
    used: string[];
    /** Concept names listed in the `exported_concepts:` frontmatter key. */
    exported: string[];
    /** Concept names listed in the `required_concepts:` frontmatter key. */
    required: string[];
    /** File identifiers listed in the `import:` frontmatter key. */
    imports: string[];
}

const EMPTY_SEMANTICS: FileSemantics = {
    edges: [],
    used: [],
    exported: [],
    required: [],
    imports: [],
};

/** Aggregated, workspace-wide semantic model derived from every file. */
export interface SemanticAggregate {
    definedNames: Set<string>;
    usedNames: Set<string>;
    exportedNames: Set<string>;
    requiredNames: Set<string>;
    graph: Map<string, Set<string>>;
}

// ===== CLASSES =====

/**
 * Scans workspace for .plain files
 */
export class FileScanner {
    constructor(private outputChannel: vscode.OutputChannel) {}

    /**
     * Recursively finds all .plain files in the workspace
     */
    async scanWorkspace(): Promise<string[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {            
            return [];
        }

        const plainFiles: string[] = [];
        
        for (const folder of workspaceFolders) {
            const files = await this.scanDirectory(folder.uri.fsPath);
            plainFiles.push(...files);
        }
                
        return plainFiles;
    }

    private async scanDirectory(dirPath: string): Promise<string[]> {
        const files: string[] = [];
        
        
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            
            if (entry.isDirectory()) {
                // Skip common ignore directories
                if (!this.shouldIgnoreDirectory(entry.name)) {
                    const subFiles = await this.scanDirectory(fullPath);
                    files.push(...subFiles);
                }
            } else if (entry.isFile() && entry.name.endsWith('.plain')) {
                files.push(fullPath);
            }
        }
        
        
        return files;
    }

    private shouldIgnoreDirectory(dirName: string): boolean {
        const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'out', '.vscode'];
        return ignoreDirs.includes(dirName) || dirName.startsWith('.');
    }
}

/**
 * Extracts concept definitions from .plain files
 */
export class ConceptExtractor {
    constructor(private outputChannel: vscode.OutputChannel) {}

    /**
     * Processes a single .plain file and extracts all concept definitions
     */
    async processFile(filePath: string): Promise<FileProcessingResult> {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const definedConcepts = this.extractConceptsFromDefinitions(filePath, content);
            const usedConcepts = this.extractConceptsFromSpecText(filePath, content);

            this.outputChannel.appendLine(`definedConcepts: ${definedConcepts}`);
            this.outputChannel.appendLine(`usedConcepts: ${usedConcepts}`);
                                    
            return {
                filePath,
                definedConcepts: definedConcepts,
                usedConcepts: usedConcepts,
                semantics: extractSemantics(filePath, content)
            };
        } catch (error) {
            const errorMsg = `Error processing file ${filePath}: ${error}`;

            return {
                filePath,
                definedConcepts: [],
                usedConcepts: [],
                semantics: EMPTY_SEMANTICS,
                error: errorMsg
            };
        }
    }

    private extractConceptsFromSpecText(filePath: string, content: string): ConceptDefinition[] {
        const concepts: ConceptDefinition[] = [];
        const lines = content.split('\n');
        let currentSection = '';

        // Use the same regex as Python: r":[+\-\.0-9A-Z_a-z]+:"
        const conceptRegex = /:[+\-\.0-9A-Z_a-z]+:/g;

        // A logical statement is a non-indented line plus all the indented
        // continuation lines beneath it (an indented block is part of its
        // parent list item). Concepts are collected per statement and reported
        // once each, but attributed to the actual line/column where they first
        // appear so navigation lands on the concept itself.
        let block: { lineIndex: number; text: string }[] = [];
        let blockSection = '';

        const flushBlock = () => {
            if (block.length === 0) {
                return;
            }
            const blockText = block.map(entry => entry.text).join('\n');
            const pushedConcepts: string[] = [];
            for (const { lineIndex, text } of block) {
                conceptRegex.lastIndex = 0;
                let match: RegExpExecArray | null;
                while ((match = conceptRegex.exec(text)) !== null) {
                    const conceptName = match[0].slice(1, -1); // Remove first and last colon
                    if (pushedConcepts.includes(conceptName)) {
                        continue;
                    }
                    pushedConcepts.push(conceptName);
                    concepts.push({
                        concept: conceptName,
                        filePath: filePath,
                        line: lineIndex,
                        character: match.index,
                        content: blockText,
                        section: blockSection
                    });
                }
            }
            block = [];
        };

        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const trimmedLine = line.trim();
            if (trimmedLine.match(/^\*\*\*[^*]+\*\*\*$/)) {
                flushBlock();
                currentSection = trimmedLine.replace(/\*/g, '').toLowerCase().trim();
                continue;
            }

            const hasIndentation = /^\s+/.test(line);
            if (hasIndentation) {
                // Continuation of the current statement; an indented line with
                // no parent still forms its own statement.
                if (block.length === 0) {
                    blockSection = currentSection;
                }
                block.push({ lineIndex, text: line });
                continue;
            }

            // A non-indented line ends the previous statement, starts a new one.
            flushBlock();
            blockSection = currentSection;
            block.push({ lineIndex, text: line });
        }
        flushBlock();

        return concepts;
    }

    /**
     * Extracts concept definitions from file content
     * Looks for ***definitions*** sections and <concept>: patterns
     */
    private extractConceptsFromDefinitions(filePath: string, content: string): ConceptDefinition[] {
        const concepts: ConceptDefinition[] = [];
        const lines = content.split('\n');
        
        let inDefinitionsSection = false;
        let currentSection = '';
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {                        
            const line = lines[lineIndex];
            const trimmedLine = line.trim();
            
            // Check for section markers
            if (trimmedLine.match(/^\*\*\*[^*]+\*\*\*$/)) {
                currentSection = trimmedLine.replace(/\*/g, '').toLowerCase().trim();                
                if (currentSection != 'definitions' && inDefinitionsSection) {
                    inDefinitionsSection = false;
                } else {
                    inDefinitionsSection = (currentSection === 'definitions');
                }
                continue;
            }
            
            // Only process lines within definitions sections
            if (!inDefinitionsSection) {
                continue;
            }
                        
            // Look for concept definitions: - :concept1:, :concept2:, :concept3:
            const definitionMatch = trimmedLine.match(/^-\s(:[^\:]+:)(?:,\s*:[^\:]+:)*/);            
            if (definitionMatch) {
                // Extract all concepts from this line using the same pattern as Python
                const fullMatch = definitionMatch[0];
                const conceptCandidates = fullMatch.match(/:([^\:]+):/g) || [];                                
                
                // Validate each concept (letters, numbers, hyphens, dots, underscores)
                const validConceptRegex = /^:[+\-\.0-9A-Z_a-z]+:$/;
                
                for (const candidate of conceptCandidates) {
                    if (validConceptRegex.test(candidate)) {
                        // Remove the colons to get the concept name
                        const conceptName = candidate.slice(1, -1); // Remove first and last colon
                        const conceptCharPos = line.indexOf(candidate);
                        
                        concepts.push({
                            concept: conceptName,
                            filePath: filePath,
                            line: lineIndex,
                            character: conceptCharPos,
                            content: line,
                            section: currentSection
                        });                       
                    } 
                }
            }
        }
        
        return concepts;
    }
}

/**
 * Main preprocessing service that coordinates scanning and indexing
 */
export class PreprocessingService {
    private definedConceptIndex: ConceptIndex = {};
    private usedConceptIndex: ConceptIndex = {};
    private fileSemantics = new Map<string, FileSemantics>();
    private fileScanner: FileScanner;
    private conceptExtractor: ConceptExtractor;
    private isIndexing = false;

    constructor(private outputChannel: vscode.OutputChannel) {
        this.fileScanner = new FileScanner(outputChannel);
        this.conceptExtractor = new ConceptExtractor(outputChannel);
    }

    /**
     * Performs initial indexing of all .plain files in workspace
     */
    async initialize(): Promise<void> {
        this.outputChannel.appendLine('Starting preprocessing: scanning workspace for .plain files...');
        await this.rebuildIndex();
    }

    /**
     * Rebuilds the entire concept index
     */
    async rebuildIndex(): Promise<void> {
        if (this.isIndexing) {
            this.outputChannel.appendLine('Indexing already in progress, skipping...');
            return;
        }

        this.isIndexing = true;
        this.definedConceptIndex = {}; // Clear existing index
        this.usedConceptIndex = {};
        this.fileSemantics.clear();

        try {
            const plainFiles = await this.fileScanner.scanWorkspace();
            
            if (plainFiles.length === 0) {
                return;
            }

            // Process all files
            const results: FileProcessingResult[] = [];
            for (const filePath of plainFiles) {
                const result = await this.conceptExtractor.processFile(filePath);
                results.push(result);
            }

            // Build the concept index
            this.buildConceptIndex(results);
            
            const totalConcepts = Object.keys(this.definedConceptIndex).length;
            this.outputChannel.appendLine(`Preprocessing complete: indexed ${totalConcepts} unique concepts from ${plainFiles.length} files`);
            
        } catch (error) {
            this.outputChannel.appendLine(`Error during preprocessing: ${error}`);
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * Builds the concept index from processing results
     */
    private buildConceptIndex(results: FileProcessingResult[]): void {
        for (const result of results) {
            if (result.error) {
                continue; // Skip files with errors
            }

            for (const concept of result.definedConcepts) {
                if (!this.definedConceptIndex[concept.concept]) {
                    this.definedConceptIndex[concept.concept] = [];
                }
                this.definedConceptIndex[concept.concept].push(concept);
            }

            for (const concept of result.usedConcepts) {
                if (!this.usedConceptIndex[concept.concept]) {
                    this.usedConceptIndex[concept.concept] = [];
                }
                this.usedConceptIndex[concept.concept].push(concept);
            }

            this.fileSemantics.set(result.filePath, result.semantics);
        }
    }

    /**
     * Finds concept definitions by name
     */
    findConceptDefinition(conceptName: string): ConceptDefinition[] {
        return this.definedConceptIndex[conceptName] || [];
    }

    /**
     * Finds concept definitions by name
     */
    findConceptUsage(conceptName: string): ConceptDefinition[] {
        return this.usedConceptIndex[conceptName] || [];
    }

    /**
     * Usages of a concept EXCLUDING occurrences on its own declaration line(s).
     * `usedConceptIndex` records every `:concept:` token, including the one on a
     * concept's `- :concept:` declaration line (rename needs that). For hover /
     * go-to-definition ("where is this *used*") the concept's own declaration is
     * not a usage, so filter it out.
     */
    findConceptUsageExcludingDefinition(conceptName: string): ConceptDefinition[] {
        const usages = this.usedConceptIndex[conceptName] || [];
        const defs = this.definedConceptIndex[conceptName] || [];
        if (defs.length === 0) {
            return usages;
        }
        const declLines = new Set(defs.map(d => `${d.filePath} ${d.line}`));
        return usages.filter(u => !declLines.has(`${u.filePath} ${u.line}`));
    }
    

    /**
     * Processes a single file (useful for file watcher updates)
     */
    async processFileUpdate(filePath: string): Promise<void> {
        if (!filePath.endsWith('.plain')) {
            return;
        }        
        
        // Remove existing concepts from this file
        this.removeConceptsFromFile(filePath);
        
        // Re-process the file
        const result = await this.conceptExtractor.processFile(filePath);
        
        // Update index
        this.buildConceptIndex([result]);
    }

    /**
     * Removes all concepts from a specific file (used when file is updated/deleted)
     */
    private removeConceptsFromFile(filePath: string): void {
        for (const conceptName in this.definedConceptIndex) {
            this.definedConceptIndex[conceptName] = this.definedConceptIndex[conceptName].filter(
                concept => concept.filePath !== filePath
            );
            
            // Remove empty concept entries
            if (this.definedConceptIndex[conceptName].length === 0) {
                delete this.definedConceptIndex[conceptName];
            }
        }

        for (const conceptName in this.usedConceptIndex) {
            this.usedConceptIndex[conceptName] = this.usedConceptIndex[conceptName].filter(
                concept => concept.filePath !== filePath
            );
            
            // Remove empty concept entries
            if (this.usedConceptIndex[conceptName].length === 0) {
                delete this.usedConceptIndex[conceptName];
            }
        }

        this.fileSemantics.delete(filePath);
    }

    // ===== Semantic model accessors (used by cross-file diagnostics) =====

    /** True if the concept is declared in a definitions section anywhere. */
    isConceptDefined(conceptName: string): boolean {
        return this.definedConceptIndex[conceptName] !== undefined;
    }

    /** True if the file declares any `import:` entries in its frontmatter. */
    fileHasImports(filePath: string): boolean {
        return (this.fileSemantics.get(filePath)?.imports.length ?? 0) > 0;
    }

    /**
     * Concept names provided by a file's resolved `import:` entries. Each import
     * is resolved to `<identifier>.plain` in the file's directory or a
     * template/templates/imports subfolder; the concepts it declares or exports
     * are treated as known.
     */
    importedConceptNames(filePath: string): Set<string> {
        const result = new Set<string>();
        const semantics = this.fileSemantics.get(filePath);
        if (!semantics) {
            return result;
        }
        const dir = path.dirname(filePath);
        for (const entry of semantics.imports) {
            const fileName = entry.endsWith('.plain') ? entry : `${entry}.plain`;
            for (const folder of IMPORT_SEARCH_FOLDERS) {
                const candidate = path.join(dir, folder, fileName);
                try {
                    if (fs.statSync(candidate).isFile()) {
                        const content = fs.readFileSync(candidate, 'utf8');
                        for (const name of definedAndExportedNames(content)) {
                            result.add(name);
                        }
                        break;
                    }
                } catch {
                    // Not found here; try the next search folder.
                }
            }
        }
        return result;
    }

    /** Declaration sites of concepts declared in the given file. */
    definitionSitesInFile(filePath: string): ConceptDefinition[] {
        const sites: ConceptDefinition[] = [];
        for (const occurrences of Object.values(this.definedConceptIndex)) {
            for (const site of occurrences) {
                if (site.filePath === filePath) {
                    sites.push(site);
                }
            }
        }
        return sites;
    }

    /** Concept usage sites (occurrences) in the given file. */
    usageSitesInFile(filePath: string): ConceptDefinition[] {
        const sites: ConceptDefinition[] = [];
        for (const occurrences of Object.values(this.usedConceptIndex)) {
            for (const site of occurrences) {
                if (site.filePath === filePath) {
                    sites.push(site);
                }
            }
        }
        return sites;
    }

    /** Builds the workspace-wide semantic model from every indexed file. */
    getSemanticAggregate(): SemanticAggregate {
        const usedNames = new Set<string>();
        const exportedNames = new Set<string>();
        const requiredNames = new Set<string>();
        const graph = new Map<string, Set<string>>();

        for (const semantics of this.fileSemantics.values()) {
            for (const name of semantics.used) { usedNames.add(name); }
            for (const name of semantics.exported) { exportedNames.add(name); }
            for (const name of semantics.required) { requiredNames.add(name); }
            for (const [from, to] of semantics.edges) {
                let targets = graph.get(from);
                if (!targets) {
                    targets = new Set();
                    graph.set(from, targets);
                }
                targets.add(to);
            }
        }

        return {
            definedNames: new Set(Object.keys(this.definedConceptIndex)),
            usedNames,
            exportedNames,
            requiredNames,
            graph
        };
    }
}

// ===== Semantic extraction (mirrors plain-language-server/src/indexer.ts) =====

const SEM_CONCEPT_TOKEN = /:[+\-\.0-9A-Z_a-z]+:/g;
const SEM_SECTION_HEADER = /^\*\*\*[^*]+\*\*\*$/;
const SEM_DEFINITION_LINE = /^-\s(:[^:]+:)(?:,\s*:[^:]+:)*/;
const SEM_VALID_CONCEPT = /^:[+\-\.0-9A-Z_a-z]+:$/;

/** Folders (relative to a file) searched when resolving an `import:` entry. */
const IMPORT_SEARCH_FOLDERS = ['', 'template', 'templates', 'imports'];

/** Concept names declared in a file's ***definitions*** section. */
function definedConceptNamesFromContent(content: string): string[] {
    const names: string[] = [];
    let inDefinitions = false;
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (SEM_SECTION_HEADER.test(trimmed)) {
            inDefinitions = trimmed.replace(/\*/g, '').toLowerCase().trim() === 'definitions';
            continue;
        }
        if (!inDefinitions) {
            continue;
        }
        const match = trimmed.match(SEM_DEFINITION_LINE);
        if (!match) {
            continue;
        }
        for (const candidate of match[0].match(/:([^:]+):/g) ?? []) {
            if (SEM_VALID_CONCEPT.test(candidate)) {
                names.push(candidate.slice(1, -1));
            }
        }
    }
    return names;
}

/** Concept names a file declares (in definitions) or exports. */
function definedAndExportedNames(content: string): string[] {
    const names = new Set<string>(definedConceptNamesFromContent(content));
    for (const name of parseFrontmatterList(content.split('\n'), 'exported_concepts')) {
        names.add(name);
    }
    return [...names];
}

/** Strip quotes, brackets and surrounding colons from a frontmatter list item. */
function cleanConceptName(raw: string): string {
    return raw
        .trim()
        .replace(/^\[|\]$/g, '')
        .replace(/^["']|["']$/g, '')
        .replace(/^:+|:+$/g, '')
        .trim();
}

/**
 * Reads a list-valued frontmatter key and returns the names it lists. Handles
 * both the block form (`key:` then `- name` / `- :name:`) and the inline form
 * (`key: [":App:", other]`).
 */
function parseFrontmatterList(lines: string[], key: string): string[] {
    if (!lines[0] || lines[0].trim() !== '---') {
        return [];
    }
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') {
            end = i;
            break;
        }
    }
    if (end === -1) {
        return [];
    }

    const names: string[] = [];
    const keyRe = new RegExp(`^${key}\\s*:(.*)$`);
    for (let i = 1; i < end; i++) {
        const match = lines[i].match(keyRe);
        if (!match) {
            continue;
        }
        const rest = match[1].trim();
        if (rest) {
            for (const part of rest.replace(/^\[|\]$/g, '').split(',')) {
                const name = cleanConceptName(part);
                if (name) { names.push(name); }
            }
        } else {
            for (let j = i + 1; j < end; j++) {
                if (/^\s*-\s+/.test(lines[j])) {
                    const name = cleanConceptName(lines[j].replace(/^\s*-\s+/, ''));
                    if (name) { names.push(name); }
                } else if (/^\S/.test(lines[j])) {
                    break;
                }
            }
        }
    }
    return names;
}

/**
 * Extracts semantic relationships from a file: reference edges (for cycle
 * detection and use-tracking), used concepts, and the exported/required/import
 * frontmatter lists. Uses the same statement-folding rule as spec extraction.
 */
function extractSemantics(filePath: string, content: string): FileSemantics {
    const lines = content.split('\n');
    const edges: Array<[string, string]> = [];
    const used = new Set<string>();

    // Skip the frontmatter so keys like `import:` / `exported_concepts: [":App:"]`
    // are not mistaken for spec usage.
    let fmEnd = -1;
    if (lines[0] && lines[0].trim() === '---') {
        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim() === '---') {
                fmEnd = i;
                break;
            }
        }
    }

    let currentSection = '';
    let block: { lineIndex: number; text: string }[] = [];
    let blockSection = '';

    const flush = () => {
        if (block.length === 0) {
            return;
        }
        const declared: string[] = [];
        if (blockSection === 'definitions') {
            const declMatch = block[0].text.trim().match(SEM_DEFINITION_LINE);
            if (declMatch) {
                for (const candidate of declMatch[0].match(/:([^:]+):/g) ?? []) {
                    if (SEM_VALID_CONCEPT.test(candidate)) {
                        declared.push(candidate.slice(1, -1));
                    }
                }
            }
        }
        const all = new Set<string>();
        for (const { text } of block) {
            SEM_CONCEPT_TOKEN.lastIndex = 0;
            let match: RegExpExecArray | null;
            while ((match = SEM_CONCEPT_TOKEN.exec(text)) !== null) {
                all.add(match[0].slice(1, -1));
            }
        }
        if (blockSection === 'definitions') {
            const refs = [...all].filter(name => !declared.includes(name));
            for (const from of declared) {
                for (const to of refs) { edges.push([from, to]); }
            }
            for (const to of refs) { used.add(to); }
        } else {
            for (const name of all) { used.add(name); }
        }
        block = [];
    };

    for (let i = 0; i < lines.length; i++) {
        if (i <= fmEnd) {
            continue;
        }
        const line = lines[i];
        const trimmed = line.trim();
        if (SEM_SECTION_HEADER.test(trimmed)) {
            flush();
            currentSection = trimmed.replace(/\*/g, '').toLowerCase().trim();
            continue;
        }
        if (/^\s+/.test(line)) {
            if (block.length === 0) { blockSection = currentSection; }
            block.push({ lineIndex: i, text: line });
            continue;
        }
        flush();
        blockSection = currentSection;
        block.push({ lineIndex: i, text: line });
    }
    flush();

    return {
        edges,
        used: [...used],
        exported: parseFrontmatterList(lines, 'exported_concepts'),
        required: parseFrontmatterList(lines, 'required_concepts'),
        imports: parseFrontmatterList(lines, 'import')
    };
}
