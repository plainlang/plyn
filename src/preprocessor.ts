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
    error?: string;
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
                usedConcepts: usedConcepts
            };
        } catch (error) {
            const errorMsg = `Error processing file ${filePath}: ${error}`;            
            
            return {
                filePath,
                definedConcepts: [],
                usedConcepts: [],
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
        let prevSpecText = ""
        let currentLineIndex = 0
        
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            const trimmedLine = lines[lineIndex].trim();
            if (trimmedLine.match(/^\*\*\*[^*]+\*\*\*$/)) {
                currentSection = trimmedLine.replace(/\*/g, '').toLowerCase().trim();
                continue;
            }            
            
            const hasIndentation = /^\s+/.test(line);

            if (hasIndentation) {
                prevSpecText += line + "\n"
                continue
            } else {
                prevSpecText = line;
                currentLineIndex = lineIndex;
            }

            let match: RegExpExecArray | null;
            let pushedConcepts: string[] = [];
            // Find all concept matches in this line
            while ((match = conceptRegex.exec(prevSpecText)) !== null) {
                // Remove the colons to get the concept name
                const conceptName = match[0].slice(1, -1); // Remove first and last colon
                if (pushedConcepts.includes(conceptName)) {
                    continue;
                }
                pushedConcepts.push(conceptName);
                const conceptCharPos = match.index;
                
                concepts.push({
                    concept: conceptName,
                    filePath: filePath,
                    line: currentLineIndex,
                    character: conceptCharPos,
                    content: prevSpecText,
                    section: currentSection
                });
            }
            
            // Reset regex lastIndex for next line
            conceptRegex.lastIndex = 0;
            prevSpecText = ""
        }
        
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
    }
}
