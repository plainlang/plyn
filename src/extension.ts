import * as vscode from 'vscode';
import { PreprocessingService } from './preprocessor';
import { PlainDefinitionProvider } from './definition_provider';
import { PlainHoverProvider } from './hover_provider';
import { PlainRenameProvider } from './rename_provider';

export function activate(context: vscode.ExtensionContext) {
    // Create an output channel for logging
    const outputChannel = vscode.window.createOutputChannel('Plain Language Extension');
    outputChannel.appendLine('Plain Language Extension activated');
    
    // Initialize preprocessing service
    const preprocessingService = new PreprocessingService(outputChannel);
    
    // Start initial indexing (async, doesn't block extension activation)
    preprocessingService.initialize().catch(error => {
        outputChannel.appendLine(`Failed to initialize preprocessing: ${error}`);
    });
    
    // Register the definition provider for plain files
    const definitionProvider = new PlainDefinitionProvider(
        outputChannel,
        ['template', 'templates', 'imports'], // Search paths
        true, // Enable debug logging
        '.plain', // File extension
        preprocessingService // Add preprocessing service
    );
    const disposable = vscode.languages.registerDefinitionProvider(
        { language: 'plain' },
        definitionProvider
    );
    
    // Register the hover provider for plain files  
    const hoverProvider = new PlainHoverProvider(
        outputChannel,
        true, // Enable debug logging
        preprocessingService
    );
    const hoverDisposable = vscode.languages.registerHoverProvider(
        { language: 'plain' },
        hoverProvider
    );
    
    // Register the rename provider for plain files
    const renameProvider = new PlainRenameProvider(
        outputChannel,
        true, // Enable debug logging
        preprocessingService
    );
    const renameDisposable = vscode.languages.registerRenameProvider(
        { language: 'plain' },
        renameProvider
    );
    
    // Register commands for manual preprocessing control
    const rebuildIndexCommand = vscode.commands.registerCommand('plain.rebuildIndex', async () => {
        outputChannel.appendLine('Manual index rebuild requested');
        await preprocessingService.rebuildIndex();
    });
    
    // Add file watcher for automatic reindexing
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.plain');
    fileWatcher.onDidCreate(uri => preprocessingService.processFileUpdate(uri.fsPath));
    fileWatcher.onDidChange(uri => preprocessingService.processFileUpdate(uri.fsPath));
    fileWatcher.onDidDelete(uri => preprocessingService.processFileUpdate(uri.fsPath));
    
    // Add text document change listener for real-time indexing
    const textChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'plain' && event.document.uri.scheme === 'file') {
            // Debounce rapid changes to avoid excessive reindexing
            clearTimeout((preprocessingService as any).textChangeTimeout);
            (preprocessingService as any).textChangeTimeout = setTimeout(() => {
                preprocessingService.processFileUpdate(event.document.uri.fsPath);
            }, 500); // Wait 500ms after last change
        }
    });
    
    context.subscriptions.push(disposable, hoverDisposable, renameDisposable, outputChannel, rebuildIndexCommand, fileWatcher, textChangeListener);
}

export function deactivate() {}
