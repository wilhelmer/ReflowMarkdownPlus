// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import {
  StartEndInfo,
  getLineIndent,
  getReflowedText,
  getStartLine,
  getEndLine,
  getSettings,
  OtherInfo
} from "./testable";

// Helper: detect front matter range at the top of the document.
// Supports YAML (--- ... --- or ...), and TOML (+++ ... +++).
// If unterminated, treat front matter as extending to the end of the document (to avoid accidental edits).
function getFrontMatterRange(document: vscode.TextDocument): vscode.Range | undefined {
  if (document.lineCount === 0) return undefined;

  // find first non-empty line
  let first = 0;
  while (first < document.lineCount && document.lineAt(first).text.trim() === "") first++;

  if (first >= document.lineCount) return undefined;

  const firstText = document.lineAt(first).text;
  const isYaml = /^\s*---\s*$/.test(firstText);
  const isToml = /^\s*\+\+\+\s*$/.test(firstText);
  if (!isYaml && !isToml) return undefined;

  const closing = isYaml ? /^\s*(---|\.\.\.)\s*$/ : /^\s*\+\+\+\s*$/;
  for (let i = first + 1; i < document.lineCount; i++) {
    if (closing.test(document.lineAt(i).text)) {
      return new vscode.Range(first, 0, i, document.lineAt(i).text.length);
    }
  }

  // Unterminated front matter -> skip everything after start
  const lastLine = document.lineCount - 1;
  return new vscode.Range(first, 0, lastLine, document.lineAt(lastLine).text.length);
}

// Helper: MDX import detection (matches `import X from "..."` and `import "..."`)
const MDX_IMPORT_RE = /^\s*import\s+(?:[^'";]+?\s+from\s+)?['"][^'"]+['"]\s*;?\s*$/;
function paragraphHasMdxImport(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (MDX_IMPORT_RE.test(document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

// Compute the first content paragraph range (after front matter, blank lines, and MDX imports)
function getFirstContentParagraphRange(document: vscode.TextDocument): vscode.Range | undefined {
  const fm = getFrontMatterRange(document);
  const lineCount = document.lineCount;
  let i = fm ? fm.end.line + 1 : 0;

  // skip blank lines and MDX import lines
  while (i < lineCount) {
    const t = document.lineAt(i).text;
    if (t.trim() === "" || MDX_IMPORT_RE.test(t)) {
      i++;
      continue;
    }
    break;
  }
  if (i >= lineCount) return undefined;

  const lineAtFunc = (line: number) => document.lineAt(line);
  const midLine = document.lineAt(i);
  const o = new OtherInfo();
  const s = getStartLine(lineAtFunc, midLine);
  const e = getEndLine(lineAtFunc, midLine, lineCount - 1, o);
  return new vscode.Range(s.lineNumber, 0, e.lineNumber, document.lineAt(e.lineNumber).text.length);
}

// Helper: lines starting with ':::'
const TRIPLE_COLON_RE = /^\s*:::/;
function lineStartsWithTripleColon(text: string): boolean {
  return TRIPLE_COLON_RE.test(text);
}

export function reflow() {
  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file first to use Reflow Markdown.');
    return;
  }

  // Skip when inside front matter
  const fm = getFrontMatterRange(editor.document);
  const position = editor.selection.active;
  if (fm && fm.contains(position)) {
    return; // do nothing in front matter
  }

  let settings = getSettings(vscode.workspace.getConfiguration("reflowMarkdown"));
  const selection = editor.selection;
  let sei = GetStartEndInfo(editor);

  // If the computed paragraph would overlap front matter, skip
  if (fm && !(sei.lineEnd < fm.start.line || sei.lineStart > fm.end.line)) {
    return;
  }

  // Skip paragraphs that contain MDX import statements
  if (paragraphHasMdxImport(editor.document, sei.lineStart, sei.lineEnd)) {
    return;
  }

  // Skip first paragraph if configured
  if (settings.neverReflowFirstParagraph) {
    const firstPara = getFirstContentParagraphRange(editor.document);
    if (firstPara) {
      const firstStart = firstPara.start.line;
      const firstEnd = firstPara.end.line;
      if (!(sei.lineEnd < firstStart || sei.lineStart > firstEnd)) {
        return;
      }
    }
  }

  // Do not touch standalone ':::' lines
  if (sei.lineStart === sei.lineEnd && lineStartsWithTripleColon(editor.document.lineAt(sei.lineStart).text)) {
    return;
  }

  let len = editor.document.lineAt(sei.lineEnd).text.length;
  let range = new vscode.Range(sei.lineStart, 0, sei.lineEnd, len);
  let text = editor.document.getText(range);

  let reflowedText = getReflowedText(sei, text, settings);
  let applied = editor.edit(function (textEditorEdit) {
    textEditorEdit.replace(range, reflowedText);
  });

  // reset selection (TODO may be contra-intuitive... maybe rather reset to single position, always?)
  editor.selection = selection;
  return applied;
}

export function activate(context: vscode.ExtensionContext) {
  let disposable = vscode.commands.registerCommand("reflow-markdown.reflowMarkdown", reflow);
  context.subscriptions.push(disposable);

  // If you registered formatting providers previously, ensure they skip front matter:
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

// Ensure formatting never edits front matter
function computeReflowEdits(
  document: vscode.TextDocument,
  targetRange: vscode.Range | undefined,
  settings: ReturnType<typeof getSettings>
): vscode.TextEdit[] {
  const edits: vscode.TextEdit[] = [];
  const fm = getFrontMatterRange(document);

  const hasRange = !!targetRange;
  const startLine = hasRange ? targetRange!.start.line : 0;
  const endLine = hasRange ? targetRange!.end.line : document.lineCount - 1;

  // If whole document: start after front matter
  let i = (!hasRange && fm) ? Math.max(startLine, fm.end.line + 1) : startLine;

  // If selection entirely inside front matter: nothing to do
  if (hasRange && fm && fm.contains(targetRange!)) {
    return edits;
  }

  const lineAtFunc = (line: number) => document.lineAt(line);

  while (i <= endLine) {
    // Skip lines inside front matter
    if (fm && i >= fm.start.line && i <= fm.end.line) {
      i = fm.end.line + 1;
      continue;
    }

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

    // Skip if paragraph overlaps front matter
    if (fm && !(sei.lineEnd < fm.start.line || sei.lineStart > fm.end.line)) {
      i = Math.max(i, fm.end.line + 1);
      continue;
    }

    // Skip paragraphs that contain MDX import statements
    if (paragraphHasMdxImport(document, sei.lineStart, sei.lineEnd)) {
      i = sei.lineEnd + 1;
      continue;
    }

    // Skip first paragraph if configured
    if (settings.neverReflowFirstParagraph) {
      const firstPara = getFirstContentParagraphRange(document);
      if (firstPara) {
        const firstStart = firstPara.start.line;
        const firstEnd = firstPara.end.line;
        if (!(sei.lineEnd < firstStart || sei.lineStart > firstEnd)) {
          i = sei.lineEnd + 1;
          continue;
        }
      }
    }

    // Do not touch standalone ':::' lines
    if (sei.lineStart === sei.lineEnd && lineStartsWithTripleColon(document.lineAt(sei.lineStart).text)) {
      i = sei.lineEnd + 1;
      continue;
    }

    // For range formatting: skip paragraphs outside or crossing the selection
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