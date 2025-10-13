Reflow Markdown Plus
===================

Reflow Markdown Plus is a Visual Studio Code Extension originally forked from the
[Reflow Markdown](https://marketplace.visualstudio.com/items?itemName=marvhen.reflow-markdown)
extension.

It includes all features of the original extension, **plus**:

- Can be registered as a [formatter](#setup) for Markdown files, so that it automatically reformats
  Markdown files on save.
- Adds an option to never reflow the first paragraph of a document.
- Ignores Markdown headings, tables, code blocks, footnotes, and YAML front matter.
- Properly handles Docusaurus admonitions (`:::`) and import statements.

This extension defaults to reflowing lines to be no more than 80 characters long. The
preferred line length may be overridden using the config value of
`reflowMarkdown.preferredLineLength`.

Setup
-----

To automatically reformat Markdown files on save, add the following to your user or
workspace settings:

```json
"[markdown]": {
    "editor.defaultFormatter": "wilhelmer.reflow-markdown-plus",
    "editor.formatOnSave": true
}
```

To manually trigger formatting, set `formatOnSave` to `false` and use the
`Format Document` command from the Command Palette (default shortcut: `shift+alt+f`).

Extension Settings
------------------

This extension contributes the following settings:

- `reflowMarkdown.preferredLineLength`: Set the preferred line length for reflowing
  paragraph (default: `80`).

- `reflowMarkdown.doubleSpaceBetweenSentences`: Insert two spaces instead of one between
  each sentence (default `false`).

- `reflowMarkdown.resizeHeaderDashLines`: Modifies the length of the ---'s or ==='s under
  H1s and H2s to be the same length as the header text. If the header text spans multiple
  lines, the dashes are set to be the length of the longest line.

- `reflowMarkdown.wrapLongLinks`: Specifies how links will be wrapped when they cause a
  line to extend beyond the preferred length.

- `reflowMarkdown.neverReflowFirstParagraph`: Never reflow the first paragraph of a
  document (default `false`).

Keyboard Shortcuts
------------------

- Invoke a reflow using `alt+q` (default).
