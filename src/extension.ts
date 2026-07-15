import * as vscode from 'vscode';
import { PreprocessingService } from './preprocessor';
import { PlainDefinitionProvider } from './definition_provider';
import { PlainHoverProvider } from './hover_provider';
import { PlainRenameProvider } from './rename_provider';
import { computeDefinitionsDiagnostics, computeSectionDiagnostics, computeSemanticDiagnostics } from './diagnostics';
import { PlainFoldingRangeProvider } from './folding_provider';

export function activate(context: vscode.ExtensionContext) {
    // Create an output channel for logging
    const outputChannel = vscode.window.createOutputChannel('Plain Language Extension');
    outputChannel.appendLine('Plain Language Extension activated');

    // Initialize preprocessing service
    const preprocessingService = new PreprocessingService(outputChannel);
    
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

    // Register the folding provider: collapse whole ***sections***.
    const foldingDisposable = vscode.languages.registerFoldingRangeProvider(
        { language: 'plain' },
        new PlainFoldingRangeProvider()
    );
    
    // Register commands for manual preprocessing control
    const rebuildIndexCommand = vscode.commands.registerCommand('plain.rebuildIndex', async () => {
        outputChannel.appendLine('Manual index rebuild requested');
        await preprocessingService.rebuildIndex();
    });

    // Diagnostics: ***definitions*** syntax errors plus the cross-file semantic
    // diagnostics (unused / undefined / cyclic concepts).
    const diagnostics = vscode.languages.createDiagnosticCollection('plain');

    const refreshDiagnostics = (document: vscode.TextDocument) => {
        if (document.languageId !== 'plain') {
            return;
        }
        diagnostics.set(document.uri, [
            ...computeDefinitionsDiagnostics(document),
            ...computeSectionDiagnostics(document),
            ...computeSemanticDiagnostics(preprocessingService, document.uri.fsPath)
        ]);
    };

    // Semantic diagnostics are cross-file, so re-publish every open document
    // whenever the index changes.
    const refreshAllDiagnostics = () => {
        for (const document of vscode.workspace.textDocuments) {
            refreshDiagnostics(document);
        }
    };

    // Start initial indexing (async, doesn't block activation), then publish.
    preprocessingService.initialize()
        .then(() => refreshAllDiagnostics())
        .catch(error => {
            outputChannel.appendLine(`Failed to initialize preprocessing: ${error}`);
        });

    const openListener = vscode.workspace.onDidOpenTextDocument(refreshDiagnostics);
    const closeListener = vscode.workspace.onDidCloseTextDocument(document =>
        diagnostics.delete(document.uri)
    );

    // Add file watcher for automatic reindexing (refresh all open docs after,
    // since a change in one file can affect another's semantic diagnostics).
    const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.plain');
    const reindexAndRefresh = (fsPath: string) =>
        preprocessingService.processFileUpdate(fsPath).then(() => refreshAllDiagnostics());
    fileWatcher.onDidCreate(uri => reindexAndRefresh(uri.fsPath));
    fileWatcher.onDidChange(uri => reindexAndRefresh(uri.fsPath));
    fileWatcher.onDidDelete(uri => reindexAndRefresh(uri.fsPath));

    // Add text document change listener for real-time indexing
    const textChangeListener = vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.languageId === 'plain' && event.document.uri.scheme === 'file') {
            // Update diagnostics immediately for responsive feedback
            refreshDiagnostics(event.document);
            // Debounce rapid changes to avoid excessive reindexing
            clearTimeout((preprocessingService as any).textChangeTimeout);
            (preprocessingService as any).textChangeTimeout = setTimeout(() => {
                preprocessingService.processFileUpdate(event.document.uri.fsPath)
                    .then(() => refreshAllDiagnostics());
            }, 500); // Wait 500ms after last change
        }
    });
    
    context.subscriptions.push(disposable, hoverDisposable, renameDisposable, foldingDisposable, outputChannel, rebuildIndexCommand, fileWatcher, textChangeListener, diagnostics, openListener, closeListener);
}

export function deactivate() {}
