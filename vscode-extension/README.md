# Inkwell Preview for VS Code

Preview Markdown files with the renderer the Inkwell app uses, so a note looks
the same inside VS Code as it does in Inkwell.

## What it renders

Everything comes from Inkwell's own `markdown-bundle.js` and `style.css`, which
are copied into `media/` by `scripts/sync-media.js` — there is no second
implementation to drift out of sync:

- headings, tables, blockquotes, task lists, footnotes, emoji, `==mark==`, `++ins++`, `~sub~`, `^sup^`
- syntax-highlighted code blocks (highlight.js, with the authored language kept)
- KaTeX math, inline `$…$` and block `$$…$$`
- ` ```flashcards ` fences as a clickable card deck, exactly like the app
- right-to-left notes, with each block picking its own direction

## Opening it

- Right-click a `.md` file in the Explorer → **Inkwell: Open Preview**
- Or **Ctrl/Cmd + Shift + P** → `Inkwell: Open Preview` / `Inkwell: Open Preview to the Side`
- Or **Open With…** on a Markdown file and pick **Inkwell Preview**

The preview follows the file live while you type and keeps your scroll position.
It is a preview: edit the file in the normal editor (or in the other column).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `inkwellPreview.theme` | `auto` | `auto` follows the VS Code color theme, or force `dark` / `light` |
| `inkwellPreview.palette` | `auto` | `auto` matches VS Code; or `default`, `vscode-dark`, `nord`, `dracula`, `solarized-dark`, `solarized-light`, `sepia`, `rose` |
| `inkwellPreview.fontSize` | `100` | text scale in percent |
| `inkwellPreview.direction` | `auto` | `auto`, `ltr` or `rtl` |

## Images

Relative image paths (`![](images/shot.png)`) resolve against the folder of the
note itself, so a note with pictures next to it renders as it does in the app.

## Building

```bash
cd vscode-extension
npm run media      # copies Inkwell's bundle and styles into media/
npm test           # smoke test of the extension host code, no VS Code needed
npm run package    # builds inkwell-preview-<version>.vsix
code --install-extension inkwell-preview-*.vsix
```

Packaging needs Node 20 for the newest `vsce`; on Node 18 the pinned 2.x release
in `npm run package` works as is.

`media/` is generated and not committed, so the extension always ships the
renderer that the app ships.
