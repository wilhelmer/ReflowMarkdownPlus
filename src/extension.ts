// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { StartEndInfo,
  getLineIndent,
  getReflowedText,
  getStartLine,
  getEndLine,
  getSettings,
  OtherInfo
 } from "./testable";

export function reflow() {

  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file first to use Reflow Markdown.');
    return;
  }

  let settings = getSettings(vscode.workspace.getConfiguration("reflowMarkdown"));

  const selection = editor.selection;
  const position = editor.selection.active;
  let sei = GetStartEndInfo(editor);

  let len = editor.document.lineAt(sei.lineEnd).text.length;
  let range = new vscode.Range(sei.lineStart, 0, sei.lineEnd, len);
  let text = editor.document.getText(range);

  let reflowedText = getReflowedText(sei, text, settings);
  let applied = editor.edit(
      function (textEditorEdit) {
          textEditorEdit.replace(range, reflowedText);
      }
  );

  // reset selection (TODO may be contra-intuitive... maybe rather reset to single position, always?)
  editor.selection = selection;

  return applied;
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand("reflow-markdown.reflowMarkdown", reflow);
  context.subscriptions.push(disposable);

  // Register as Markdown formatter (format document and format selection)
  const selector: vscode.DocumentSelector = [
    { language: "markdown", scheme: "file" },
    { language: "markdown", scheme: "untitled" }
  ];

  class MarkdownReflowFormatter implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {
    provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
      const settings = getSettings(vscode.workspace.getConfiguration("reflowMarkdown", document.uri));
      return computeReflowEdits(document, undefined, settings);
    }

    provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
      const settings = getSettings(vscode.workspace.getConfiguration("reflowMarkdown", document.uri));
      return computeReflowEdits(document, range, settings);
    }
  }

  context.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(selector, new MarkdownReflowFormatter())
  );
  context.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(selector, new MarkdownReflowFormatter())
  );
}

export function deactivate() {
}

export function GetStartEndInfo(editor: vscode.TextEditor): StartEndInfo {

    const midLineNum = editor.selection.active.line;
    let midLine = editor.document.lineAt(midLineNum);
    let maxLineNum = editor.document.lineCount - 1; //max line NUMBER is line COUNT minus 1
    let lineAtFunc = (line: number) => { return editor.document.lineAt(line); };

    let o = new OtherInfo();
    let s = getStartLine(lineAtFunc, midLine);
    let e = getEndLine(lineAtFunc, midLine, maxLineNum, o);
    o.indents = getLineIndent(s.firstNonWhitespaceCharacterIndex, s.text);

    return  {
        lineStart: s.lineNumber,
        lineEnd: e.lineNumber,
        otherInfo: o        
    };

}

function computeReflowEdits(document: vscode.TextDocument, targetRange: vscode.Range | undefined, settings: ReturnType<typeof getSettings>): vscode.TextEdit[] {
  const edits: vscode.TextEdit[] = [];

  const hasRange = !!targetRange;
  const startLine = hasRange ? targetRange!.start.line : 0;
  const endLine = hasRange ? targetRange!.end.line : document.lineCount - 1;

  const lineAtFunc = (line: number) => document.lineAt(line);

  let i = startLine;
  while (i <= endLine) {
    const midLine = document.lineAt(i);

    const o = new OtherInfo();
    const s = getStartLine(lineAtFunc, midLine);
    const e = getEndLine(lineAtFunc, midLine, document.lineCount - 1, o);
    o.indents = getLineIndent(s.firstNonWhitespaceCharacterIndex, s.text);

    const sei: StartEndInfo = {
      lineStart: s.lineNumber,
      lineEnd: e.lineNumber,
      otherInfo: o
    };

    // For range formatting: skip paragraphs that would extend outside the selection
    if (hasRange) {
      if (sei.lineEnd < startLine) { i = sei.lineEnd + 1; continue; }
      if (sei.lineStart > endLine) { break; }
      if (sei.lineStart < startLine || sei.lineEnd > endLine) { i = sei.lineEnd + 1; continue; }
    }

    const rng = new vscode.Range(
      sei.lineStart, 0,
      sei.lineEnd, document.lineAt(sei.lineEnd).text.length
    );
    const original = document.getText(rng);
    const reflowed = getReflowedText(sei, original, settings);

    if (original !== reflowed) {
      edits.push(vscode.TextEdit.replace(rng, reflowed));
    }

    i = sei.lineEnd + 1;
  }

  return edits;
}