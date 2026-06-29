import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { PreprocessingService } from './preprocessor';

export class PlainDefinitionProvider implements vscode.DefinitionProvider {
    constructor(
        private outputChannel: vscode.OutputChannel,
        private searchPaths: string[] = ['template', 'templates'], // Additional folders to search
        private enableDebugLogging: boolean = true, // Enable/disable detailed logging
        private fileExtension: string = '.plain', // Configurable file extension
        private preprocessingService?: PreprocessingService // Optional preprocessing service
    ) {}

    private isAConceptDefinition(document: vscode.TextDocument, position: vscode.Position, word: string): boolean {
        // Check if we're inside a definitions section
        let inDefinitionsSection = false;
        
        // Look backwards from current position to find which section we're in
        for (let i = position.line; i >= 0; i--) {
            const lineText = document.lineAt(i).text.trim();
            
            // Check for section markers
            if (lineText.match(/^\*\*\*[^*]+\*\*\*$/)) {
                const currentSection = lineText.replace(/\*/g, '').toLowerCase().trim();
                inDefinitionsSection = (currentSection === 'definitions');
                break;
            }
        }
        
        if (!inDefinitionsSection) {
            return false;
        }
        
        // Check if the current line contains a concept definition pattern
        const currentLine = document.lineAt(position.line).text;
        const definitionMatch = currentLine.match(/^-\s(:[^\:]+:)(?:,\s*:[^\:]+:)*/);

        if (definitionMatch) {
            const fullMatch = definitionMatch[0];
            const conceptCandidates = fullMatch.match(/:([^\:]+):/g) || [];
            for(const conceptCandidate of conceptCandidates) {
                if (conceptCandidate.slice(1, -1) === word) {
                    return true;
                }
            }
            return false
        } else {
            return false
        }
    }

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition> {
        if (this.enableDebugLogging) {
            this.outputChannel.appendLine(`provideDefinition called: ${document.uri.fsPath} at line ${position.line}, character ${position.character}`);
        }
        
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }
        
        const word = document.getText(wordRange);

        // First, try concept lookup if preprocessing service is available
        if (this.preprocessingService) {
            let conceptDefinitions = null;
            if (this.isAConceptDefinition(document, position, word)) {
                conceptDefinitions = this.preprocessingService.findConceptUsage(word);
            } else {
                conceptDefinitions = this.preprocessingService.findConceptDefinition(word);
            }

            if (conceptDefinitions.length > 0) {
                if (this.enableDebugLogging) {
                    this.outputChannel.appendLine(`Found ${conceptDefinitions.length} concept definitions for: ${word}`);
                }
                
                // Return all concept definition locations
                return conceptDefinitions.map(concept => 
                    new vscode.Location(
                        vscode.Uri.file(concept.filePath),
                        new vscode.Position(concept.line, concept.character)
                    )
                );
            }
        }
        
        // Fall back to original file-based lookup for import/requires sections
        
        // Check if we're inside frontmatter
        if (!this.isInFrontmatter(document, position)) {
            return undefined;
        }
        
        // Check if we're inside import: or requires: section
        if (!this.isInImportOrRequires(document, position)) {
            return undefined;
        }
        
        // Check if this looks like a plain file reference
        if (!this.isPlainFileReference(word)) {
            return undefined;
        }
        
        // Try to find the corresponding .plain file
        const targetFilePath = this.findPlainFile(document.uri, word);
        if (!targetFilePath) {
            return undefined;
        }
        
        // Return the definition location
        return new vscode.Location(
            vscode.Uri.file(targetFilePath),
            new vscode.Position(0, 0)
        );
    }
    
    private isInFrontmatter(document: vscode.TextDocument, position: vscode.Position): boolean {
        let inFrontmatter = false;
        let frontmatterStart = -1;
        
        // Look for frontmatter boundaries
        for (let i = 0; i <= position.line; i++) {
            const lineText = document.lineAt(i).text.trim();
            if (lineText === '---') {
                if (frontmatterStart === -1) {
                    frontmatterStart = i;
                    inFrontmatter = true;
                } else {
                    // We found the closing ---, check if position is before it
                    if (position.line < i) {
                        return inFrontmatter;
                    } else {
                        return false;
                    }
                }
            }
        }
        
        // If we didn't find closing ---, but found opening, check remaining lines
        if (inFrontmatter && frontmatterStart !== -1) {
            for (let i = position.line + 1; i < document.lineCount; i++) {
                const lineText = document.lineAt(i).text.trim();
                if (lineText === '---') {
                    return true; // Found closing after position
                }
            }
        }
        
        return false;
    }
    
    private isInImportOrRequires(document: vscode.TextDocument, position: vscode.Position): boolean {
        let currentSection = '';
        
        // Scan backwards from current position to find which section we're in
        for (let i = position.line; i >= 0; i--) {
            const lineText = document.lineAt(i).text.trim();
            
            if (lineText === '---') {
                break; // Hit frontmatter boundary
            }
            
            // Check for section headers
            if (lineText.match(/^(import|requires|description|required_concepts|exported_concepts):/)) {
                const match = lineText.match(/^(import|requires|description|required_concepts|exported_concepts):/);
                if (match) {
                    currentSection = match[1];
                    break;
                }
            }
        }
        
        // Only allow definition lookup in import and requires sections
        return currentSection === 'import' || currentSection === 'requires';
    }
    
    private isPlainFileReference(word: string): boolean {
        // Check if it looks like a valid plain file identifier
        return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(word);
    }
    
    private findPlainFile(currentUri: vscode.Uri, identifier: string): string | undefined {
        const currentDir = path.dirname(currentUri.fsPath);
        let targetFileName = identifier + this.fileExtension;
        let targetPath = path.join(currentDir, targetFileName);
        
        if (this.enableDebugLogging) {
            this.outputChannel.appendLine(`Checking if file exists in the same directory: ${targetPath}`);
        }
        
        // Check if file exists in the same directory
        if (fs.existsSync(targetPath)) {
            return targetPath;
        }
        
        // Check each configured search path
        for (const searchPath of this.searchPaths) {
            const searchFolder = path.join(currentDir, searchPath);        
            targetPath = path.join(searchFolder, targetFileName);
            
            if (this.enableDebugLogging) {
                this.outputChannel.appendLine(`Checking if file exists in ${searchPath} folder: ${targetPath}`);
            }
            
            if (fs.existsSync(targetPath)) {
                return targetPath;
            }
        }
        
        return undefined;
    }
}