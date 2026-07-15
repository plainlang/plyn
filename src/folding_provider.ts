import * as vscode from 'vscode';

// Folds each `***section***` from its header down to the section's last
// non-blank line (i.e. up to the next header or end of file), like collapsing a
// Markdown heading. Mirrors plain-language-server/src/folding.ts.

const SECTION_HEADER = /^\*\*\*[^*]+\*\*\*$/;

export class PlainFoldingRangeProvider implements vscode.FoldingRangeProvider {
    provideFoldingRanges(
        document: vscode.TextDocument,
        _context: vscode.FoldingContext,
        _token: vscode.CancellationToken
    ): vscode.FoldingRange[] {
        const ranges: vscode.FoldingRange[] = [];
        let sectionStart = -1;
        let lastContent = -1;

        const flush = () => {
            if (sectionStart !== -1 && lastContent > sectionStart) {
                ranges.push(new vscode.FoldingRange(sectionStart, lastContent));
            }
        };

        for (let i = 0; i < document.lineCount; i++) {
            const trimmed = document.lineAt(i).text.trim();
            if (SECTION_HEADER.test(trimmed)) {
                flush();
                sectionStart = i;
                lastContent = i;
            } else if (sectionStart !== -1 && trimmed !== '') {
                lastContent = i;
            }
        }
        flush();

        return ranges;
    }
}
