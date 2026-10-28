# Inkwell

A clean, professional Markdown editor built with Electron. No password gate and no encrypted vault — your notes are ordinary `.md` files you can open with any editor.

## Features

- **Live Preview** — Edit, Preview, and Split view modes with real-time rendering
- **Resizable Split** — drag the divider between editor and preview (double-click resets)
- **Formatting toolbar** — bold, italic, strike, headings, lists, tasks, quote, code,
  links, images, tables, horizontal rule
- **Zoom** — 50%–250% content zoom (`Ctrl/Cmd +/-/0`)
- **RTL support** — Auto / LTR / RTL direction with per-paragraph detection;
  code, tables and formulas always stay LTR
- **File Management** — Create, rename, delete, and search Markdown files
- **Folders** — Organize notes in nested folders, with drag-and-drop moves
- **Images** — Folder-relative images render inline in the preview; click any
  image to open it full-screen (press `Esc` or click to close)
- **Auto-save** — Changes save automatically as you type (plus manual save)
- **Rich Markdown** — GFM, tables, task lists, footnotes, emoji, highlight, sub/sup, ins
- **Code Highlighting** — Syntax highlighting for fenced code blocks
- **Math** — LaTeX/KaTeX inline and display math
- **AI Assistant** — Ask about a selection, summarize/explain/translate a document,
  or explain code through a local AI CLI (Claude, Codex, or OpenCode)
- **Telegram Sharing** — Send the current document to a Telegram chat as a
  self-contained HTML file
- **Settings page** — Configure the AI provider/model/quick prompts and Telegram
  credentials from inside the app
- **Cross-platform** — Builds for Windows, macOS, and Linux

## Storage

Notes are stored as plain Markdown files in the vault folder you choose. Set the
vault in **Settings → Vault**, or choose one when creating your first file or
folder. Open it in any file manager or text editor to access the `.md` files.

## AI Assistant

Inkwell does not ship its own model. It invokes a command-line tool already
installed on your computer:

| Provider | Command |
| -------- | ------- |
| Claude   | `claude` |
| Codex    | `codex` |
| OpenCode | `opencode` |

Install and sign in to the CLI you want to use, then choose it in
**Settings → AI Assistant**. You can also pin a model and manage the quick
prompts shown in the AI panel.

## Telegram

Create a bot with [@BotFather](https://t.me/BotFather), copy its token, and get
the destination chat ID. Open **Settings → Telegram**, paste both values, and
click **Save**. Use **Send test message** to confirm the connection.

Credentials are stored locally in app settings. You can also set
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` as environment variables.

## Usage

```bash
npm install          # install dependencies
npm start            # run the app
npm run build        # build for current platform
npm run build:win    # Windows (NSIS + portable)
npm run build:mac    # macOS (dmg + zip)
npm run build:linux  # Linux (AppImage + deb)
```

Or launch from the application menu / desktop icon via `~/inkwell/launch.sh`.

## Install Inkwell

Download the installer for your system from the
[latest GitHub release](https://github.com/alisoltanics/inkwell/releases/latest):

- **Linux:** install the `.deb` package, or download the `.AppImage`, make it
  executable, and run it.
- **Windows:** run the `Setup.exe` installer. The release also includes a
  portable `.exe` that does not need installation.
- **macOS:** open the `.dmg` and drag Inkwell into Applications. These builds
  are unsigned; macOS may require Control-click → **Open** the first time.

Pushing a version tag such as `v1.0.0` builds Linux x64, Windows x64, and macOS
Intel and Apple Silicon installers, then attaches them to a GitHub release.

## Keyboard Shortcuts

| Action              | Shortcut             |
| ------------------- | -------------------- |
| Save                | `Ctrl/Cmd + S`       |
| New file            | `Ctrl/Cmd + N`       |
| Toggle preview      | `Ctrl/Cmd + P`       |
| Split view          | `Ctrl/Cmd + \`       |
| Toggle sidebar      | `Ctrl/Cmd + Shift+B` |
| Bold                | `Ctrl/Cmd + B`       |
| Italic              | `Ctrl/Cmd + I`       |
| Strikethrough       | `Ctrl/Cmd + Shift+X` |
| Link                | `Ctrl/Cmd + K`       |
| Inline code         | `Ctrl/Cmd + ``  or  `Ctrl/Cmd + E` |
| Headings 1/2/3      | `Ctrl/Cmd + 1/2/3`   |
| Undo / Redo         | `Ctrl/Cmd + Z` / `Ctrl/Cmd + Shift+Z` |
| Zoom in / out / reset | `Ctrl/Cmd + +/-/0` |
| Close modal         | `Esc`                |

## Text direction (RTL)

Use the **Auto / LTR / RTL** switch in the editor toolbar:

- **Auto** — each paragraph takes its direction from its first strong character
  (mixed Persian/English documents just work). The preview direction is detected
  from the whole document.
- **LTR / RTL** — force a direction.

Regardless of direction, **code blocks, inline code, tables and math are always
rendered left-to-right.**

## Architecture

- `main.js` — Electron main process, plaintext file IPC, AI, Telegram, HTML export
- `preload.js` — Secure context bridge (`window.inkwell`)
- `html.js` — Builds self-contained HTML exports (shared with Telegram)
- `src/renderer/` — UI (HTML/CSS/JS) and the bundled markdown engine
- `src/bundle-entry.js` — esbuild entry that bundles all markdown libraries

### Rebuilding the markdown bundle

```bash
npx esbuild src/bundle-entry.js --bundle --minify --format=iife --outfile=src/renderer/markdown-bundle.js
```
