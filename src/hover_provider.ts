import * as vscode from 'vscode';
import * as path from 'path';
import { ConceptDefinition, PreprocessingService } from './preprocessor';

export class PlainHoverProvider implements vscode.HoverProvider {
    constructor(
        private outputChannel: vscode.OutputChannel,
        private enableDebugLogging: boolean = true,
        private preprocessingService?: PreprocessingService
    ) {}

    private groupConceptsByFileBySection(concepts: ConceptDefinition[]): { [key: string]: { [key: string]: ConceptDefinition[] } } {
        const groupedConcepts: { [key: string]: { [key: string]: ConceptDefinition[] } } = {};
        for (const concept of concepts) {
            if (!concept.section) {
                continue;
            }
            if (!groupedConcepts[concept.filePath]) {
                groupedConcepts[concept.filePath] = {};
            }            
            if (!groupedConcepts[concept.filePath][concept.section]) {
                groupedConcepts[concept.filePath][concept.section] = [];
            }
            groupedConcepts[concept.filePath][concept.section].push(concept);            
        }
        return groupedConcepts;
    }


    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }
        
        const word = document.getText(wordRange);

        // Only show hover if preprocessing service is available
        if (!this.preprocessingService) {
            return undefined;
        }

        let concepts = null;        
        let definition = false;
        if (this.isAConceptDefinition(document, position, word)) {
            concepts = this.preprocessingService.findConceptUsage(word);            
            definition = true;
        } else {
            concepts = this.preprocessingService.findConceptDefinition(word);            
        }        

        if (concepts.length === 0) {
            return undefined;
        }

        const groupedConcepts = this.groupConceptsByFileBySection(concepts);

        // Create hover content
        const hoverContents: vscode.MarkdownString[] = [];
        let concept = concepts[0];
        const markdownString = new vscode.MarkdownString();
        // Add concept header

        markdownString.appendMarkdown(`**${definition ? 'Defined' : 'Used'} concept: \`${concept.concept}\`**\n\n`);                                        
        for(const filePath in groupedConcepts) {
            if (definition) {
                markdownString.appendMarkdown(`*Used in: \`${path.basename(filePath, path.extname(filePath))}\`*\n\n`);                
            } else {
                markdownString.appendMarkdown(`*Defined in: \`${path.basename(filePath, path.extname(filePath))}\`*\n\n`);
            }            
            for(const section in groupedConcepts[filePath]) {                
                if(definition) {
                    markdownString.appendCodeblock(`***${section}***`, 'plain');
                } 
                for(const concept of groupedConcepts[filePath][section]) {
                    markdownString.appendCodeblock(`${concept.content}`, 'plain');
                }                
                markdownString.appendCodeblock(`\n`, 'plain');
            }
            markdownString.appendCodeblock(``, 'plain');
        }
        hoverContents.push(markdownString);

        return new vscode.Hover(hoverContents, wordRange);
    }

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
}
