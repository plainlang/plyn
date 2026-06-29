import * as vscode from 'vscode';
import { ConceptDefinition, PreprocessingService } from './preprocessor';

export class PlainRenameProvider implements vscode.RenameProvider {
    constructor(
        private outputChannel: vscode.OutputChannel,
        private enableDebugLogging: boolean = true,
        private preprocessingService?: PreprocessingService
    ) {}

    prepareRename(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Range | { range: vscode.Range; placeholder: string }> {                                
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            throw new Error('No symbol found at this position');
        }

        const word = document.getText(wordRange);

        // Only allow rename if preprocessing service is available
        if (!this.preprocessingService) {
            throw new Error('Preprocessing service not available');
        }

        // Check if this word is a concept (either definition or usage)
        const definitions = this.preprocessingService.findConceptDefinition(word);
        const usages = this.preprocessingService.findConceptUsage(word);

        if (definitions.length === 0 && usages.length === 0) {
            throw new Error(`No concept found with name '${word}'`);
        }        
        if (this.enableDebugLogging) {
            this.outputChannel.appendLine(`Preparing rename for concept: ${word} (${definitions.length} definitions, ${usages.length} usages)`);
        }

        return {
            range: wordRange,
            placeholder: word
        };
    }

    provideRenameEdits(
        document: vscode.TextDocument,
        position: vscode.Position,
        newName: string,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.WorkspaceEdit> {                                
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const oldName = document.getText(wordRange);

        // Validate new name (same rules as concept names)
        if (!/^[+\-\.0-9A-Z_a-z]+$/.test(newName)) {
            throw new Error('Invalid concept name. Use only letters, numbers, dots, hyphens, plus signs, and underscores.');
        }

        if (!this.preprocessingService) {
            return undefined;
        }

        // Find all occurrences of this concept
        const usages = this.preprocessingService.findConceptUsage(oldName);        

        if (usages.length === 0) {
            return undefined;
        }


        const workspaceEdit = new vscode.WorkspaceEdit();

        // Group occurrences by file to batch edits
        const fileGroups = new Map<string, ConceptDefinition[]>();
        for (const occurrence of usages) {
            if (!fileGroups.has(occurrence.filePath)) {
                fileGroups.set(occurrence.filePath, []);
            }
            fileGroups.get(occurrence.filePath)!.push(occurrence);
        }

        // Create text edits for each file
        for (const [filePath, occurrences] of fileGroups) {
            const textEdits: vscode.TextEdit[] = [];

            for (const occurrence of occurrences) {
                // Find the exact position of the concept name within colons
                const uri = vscode.Uri.file(filePath);
                
                // Create a range for the concept name (excluding the colons)
                const range = new vscode.Range(
                    occurrence.line,
                    occurrence.character + 1, // +1 to skip the opening colon
                    occurrence.line,
                    occurrence.character + 1 + oldName.length // Just the concept name length
                );
                
                textEdits.push(vscode.TextEdit.replace(range, newName));

            }

            workspaceEdit.set(vscode.Uri.file(filePath), textEdits);
        }

        return workspaceEdit;
    }
}