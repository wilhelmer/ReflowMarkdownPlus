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

// Helper: Markdown footnote or reference definition lines, e.g. `[tags]: /path` or `[^1]: text`
const FOOTNOTE_DEF_RE = /^\s*\[\^?[^\]]+\]:[ \t]+/;
function paragraphHasFootnoteDef(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (FOOTNOTE_DEF_RE.test(document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

// Helper: lines that only contain a list symbol (- or *) and a Markdown link
const LIST_LINK_ONLY_RE = /^\s*[-*]\s+\[[^\]]*\]\([^)]*\)\s*$/;
function paragraphHasListLinkOnly(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (LIST_LINK_ONLY_RE.test(document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

// Helper: Markdown table detection (pipe rows and header separator lines)
const MD_TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const MD_TABLE_ROW_RE = /^\s*\|.*\|.*$/;
function paragraphHasMarkdownTable(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    const t = document.lineAt(i).text;
    if (MD_TABLE_SEPARATOR_RE.test(t) || MD_TABLE_ROW_RE.test(t)) {
      return true;
    }
  }
  return false;
}

// Helper: ATX heading lines starting with up to 3 spaces and 1-6 '#'
const ATX_HEADING_RE = /^\s{0,3}#{1,6}(?:\s|$)/;
function paragraphHasAtxHeading(document: vscode.TextDocument, startLine: number, endLine: number): boolean {
  for (let i = startLine; i <= endLine; i++) {
    if (ATX_HEADING_RE.test(document.lineAt(i).text)) {
      return true;
    }
  }
  return false;
}

// Helper: detect fenced code block ranges (``` or ~~~), allowing up to 3 leading spaces
function getFencedCodeBlockRanges(document: vscode.TextDocument): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  const openRe = /^\s{0,3}(`{3,}|~{3,})/;
  let inBlock = false;
  let blockStart = 0;
  let fenceChar = "";
  let fenceLen = 0;

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;

    if (!inBlock) {
      const m = text.match(openRe);
      if (m) {
        const seq = m[1];
        fenceChar = seq[0]; // ` or ~
        fenceLen = seq.length;
        inBlock = true;
        blockStart = i;
      }
      continue;
    }

    // in block -> look for matching closing fence (same char, at least same length)
    const closeRe = new RegExp(`^\\s{0,3}${fenceChar}{${fenceLen},}\\s*$`);
    if (closeRe.test(text)) {
      const endLen = document.lineAt(i).text.length;
      ranges.push(new vscode.Range(blockStart, 0, i, endLen));
      inBlock = false;
      fenceChar = "";
      fenceLen = 0;
    }
  }

  if (inBlock) {
    // Unterminated fence until EOF
    const last = document.lineCount - 1;
    ranges.push(new vscode.Range(blockStart, 0, last, document.lineAt(last).text.length));
  }

  return ranges;
}

// Helper: given a set of ranges, find one that contains a line
function findRangeContainingLine(ranges: vscode.Range[], line: number): vscode.Range | undefined {
  return ranges.find(r => line >= r.start.line && line <= r.end.line);
}

function rangeOverlapsAny(startLine: number, endLine: number, ranges: vscode.Range[]): boolean {
  return ranges.some(r => !(endLine < r.start.line || startLine > r.end.line));
}

// Helper: detect MDX/JSX expression ranges delimited by balanced { ... } across lines (outside fenced code)
function getJsxExpressionRanges(document: vscode.TextDocument, fencedRanges: vscode.Range[]): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  let depth = 0;
  let currentStart: number | undefined = undefined;

  const isInFence = (line: number) => !!findRangeContainingLine(fencedRanges, line);

  for (let i = 0; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;

    if (isInFence(i)) {
      // If we were inside an expression range, close it before skipping fenced content
      if (currentStart !== undefined) {
        ranges.push(new vscode.Range(currentStart, 0, i - 1, document.lineAt(i - 1).text.length));
        currentStart = undefined;
      }
      continue;
    }

    // Scan the line while ignoring inline code spans delimited by backticks
    let inInline = false;
    let inlineTickRun = 0; // number of backticks that opened the inline span
    let lineInside = depth > 0;

    for (let idx = 0; idx < text.length; idx++) {
      const ch = text[idx];

      if (ch === '`') {
        // Count run length
        let run = 1;
        while (idx + run < text.length && text[idx + run] === '`') run++;
        if (!inInline) {
          inInline = true;
          inlineTickRun = run;
        } else if (run >= inlineTickRun) {
          inInline = false;
          inlineTickRun = 0;
        }
        idx += run - 1; // advance
        continue;
      }

      if (inInline) continue;

      if (ch === '{') {
        depth++;
        lineInside = true; // entering expression on this line
      } else if (ch === '}') {
        depth = Math.max(0, depth - 1);
      }
    }

    if (lineInside) {
      if (currentStart === undefined) {
        currentStart = i;
      }
    } else if (currentStart !== undefined) {
      // Previous range ended on the previous line
      const prev = i - 1;
      ranges.push(new vscode.Range(currentStart, 0, prev, document.lineAt(prev).text.length));
      currentStart = undefined;
    }
  }

  if (currentStart !== undefined) {
    const last = document.lineCount - 1;
    ranges.push(new vscode.Range(currentStart, 0, last, document.lineAt(last).text.length));
  }

  return ranges;
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

  // Skip when inside fenced code block or JSX expression
  const fenced = getFencedCodeBlockRanges(editor.document);
  const jsxExpr = getJsxExpressionRanges(editor.document, fenced);
  if (findRangeContainingLine(fenced, position.line) || findRangeContainingLine(jsxExpr, position.line)) {
    return;
  }

  // Skip when on a heading line
  if (ATX_HEADING_RE.test(editor.document.lineAt(position.line).text)) {
    return;
  }

  let settings = getSettings(vscode.workspace.getConfiguration("reflowMarkdown"));
  const selection = editor.selection;
  let sei = GetStartEndInfo(editor);

  // If the computed paragraph would overlap front matter, skip
  if (fm && !(sei.lineEnd < fm.start.line || sei.lineStart > fm.end.line)) {
    return;
  }

  // Skip paragraphs that overlap fenced code blocks or JSX expressions
  if (rangeOverlapsAny(sei.lineStart, sei.lineEnd, fenced) || rangeOverlapsAny(sei.lineStart, sei.lineEnd, jsxExpr)) {
    return;
  }

  // Skip paragraphs that include ATX headings (lines starting with '#')
  if (paragraphHasAtxHeading(editor.document, sei.lineStart, sei.lineEnd)) {
    return;
  }

  // Skip paragraphs that contain MDX import statements
  if (paragraphHasMdxImport(editor.document, sei.lineStart, sei.lineEnd)) {
    return;
  }

  // Skip paragraphs that contain Markdown footnote/reference definitions
  if (paragraphHasFootnoteDef(editor.document, sei.lineStart, sei.lineEnd)) {
    return;
  }

  // Skip paragraphs that contain Markdown tables
  if (paragraphHasMarkdownTable(editor.document, sei.lineStart, sei.lineEnd)) {
    return;
  }

  // Skip paragraphs that contain only list symbols and Markdown links
  if (paragraphHasListLinkOnly(editor.document, sei.lineStart, sei.lineEnd)) {
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
  const fenced = getFencedCodeBlockRanges(document);
  const jsxExpr = getJsxExpressionRanges(document, fenced);

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

    // Skip lines inside fenced code blocks
    const fencedRange = findRangeContainingLine(fenced, i);
    if (fencedRange) {
      i = fencedRange.end.line + 1;
      continue;
    }

    // Skip lines inside JSX expression ranges
    const jsxRange = findRangeContainingLine(jsxExpr, i);
    if (jsxRange) {
      i = jsxRange.end.line + 1;
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

    // Skip if paragraph overlaps fenced code or JSX expressions
    if (rangeOverlapsAny(sei.lineStart, sei.lineEnd, fenced) || rangeOverlapsAny(sei.lineStart, sei.lineEnd, jsxExpr)) {
      i = sei.lineEnd + 1;
      continue;
    }

    // Skip paragraphs that include ATX headings (lines starting with '#')
    if (paragraphHasAtxHeading(document, sei.lineStart, sei.lineEnd)) {
      i = sei.lineEnd + 1;
      continue;
    }

    // Skip paragraphs that contain MDX import statements
    if (paragraphHasMdxImport(document, sei.lineStart, sei.lineEnd)) {
      i = sei.lineEnd + 1;
      continue;
    }

    // Skip paragraphs that contain Markdown footnote/reference definitions
    if (paragraphHasFootnoteDef(document, sei.lineStart, sei.lineEnd)) {
      i = sei.lineEnd + 1;
      continue;
    }

    // Skip paragraphs that contain Markdown tables
    if (paragraphHasMarkdownTable(document, sei.lineStart, sei.lineEnd)) {
      i = sei.lineEnd + 1;
      continue;
    }

    // Skip paragraphs that contain only list symbols and Markdown links
    if (paragraphHasListLinkOnly(document, sei.lineStart, sei.lineEnd)) {
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