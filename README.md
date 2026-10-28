# Inkwell

Inkwell is a desktop Markdown writing app for organizing notes as regular files and working with them in a focused editor. It is built with Electron and runs on Linux, Windows, and macOS. Notes are readable `.md` files on your computer; Inkwell does not encrypt them or require an Inkwell account.

## What Inkwell does

### Write and organize

- Create, rename, move, search, and delete Markdown files and nested folders.
- Choose a vault folder in Settings, or select one when creating your first file or folder. The vault is the folder where Inkwell stores your notes.
- Drag files and folders into other folders to reorganize them.
- Changes are saved as you type. Notes can also be edited with any text editor.
- Add images using paths relative to the vault. Images appear in the preview and can be opened full-screen.
- Add comments to selected passages, revisit them from the comments panel, and edit or remove them.

### Edit and preview Markdown

- Work in Edit, Preview, or Split view. Resize the editor/preview divider and reset it with a double-click.
- Use the formatting toolbar for emphasis, headings, lists, task lists, quotes, links, images, code, tables, and horizontal rules.
- Render GitHub Flavored Markdown, tables, task lists, footnotes, emoji, highlighted text, inserted text, subscript, and superscript.
- Highlight fenced code blocks and render inline and display LaTeX math with KaTeX.
- Choose automatic, left-to-right, or right-to-left text direction. Automatic direction supports mixed Persian and English paragraphs; code, tables, and math remain left-to-right.
- Zoom the document from 50% to 250%.
- Export a self-contained HTML copy of a document. The export includes local images and is suitable for sharing or printing.

### Ask AI

- Open the Ask AI panel to ask a question, or use document actions to summarize, explain, translate, or extract notes from the current document.
- Ask AI about selected text, or explain a piece of code. AI prompts can include the selected text or document content needed for the chosen action.
- Choose Claude, Codex, or OpenCode, set a model, and manage reusable quick prompts in Settings.
- Save a useful AI answer as a new Markdown note.

Inkwell does not provide an AI model or AI account. It starts the selected command-line client installed on your computer (`claude`, `codex`, or `opencode`) and uses that client's local setup and authentication. For Claude, Inkwell runs the `claude` CLI. It also reads `claudeCode.environmentVariables` from the local VS Code user `settings.json`, when present, and passes those environment variables to the CLI process. Inkwell does not put these credentials in the project or send them to GitHub. When you submit an AI request, the prompt and any included note text are sent by the selected CLI to the AI service configured for that CLI; review that service's privacy terms before sending sensitive content.

### Share with Telegram

- Configure a Telegram bot token and chat ID in Settings, send a test message, and send the current document as a self-contained HTML file.
- Telegram credentials are kept in Inkwell's local application settings. They are not stored in the project repository.

## Your files and privacy

The vault contains ordinary, unencrypted Markdown files and any images you add. Choose a folder outside the Inkwell source repository for your vault. If a vault is inside a Git repository, its contents may be committed unless that path is ignored. The `.gitignore` excludes common local folders, build output, environment files, logs, and editor/OS files, but it cannot know the path of every custom vault.

Inkwell's preferences, vault location, and Telegram settings are stored in Electron's local application data directory, not in the project files. Before committing changes, review `git status` and the staged file list. Never stage credentials, private notes, or personal files.

## Install a release

Open the [latest Inkwell release](https://github.com/alisoltanics/inkwell/releases/latest) and download the file for your operating system:

### Linux

- **Debian/Ubuntu:** download the `.deb` package and open it with your software installer. On a terminal, you can install it with `sudo apt install ./inkwell_VERSION_amd64.deb`.
- **Other distributions:** download the `.AppImage`, make it executable in the file properties, then open it. Or run `chmod +x Inkwell-VERSION.AppImage` followed by `./Inkwell-VERSION.AppImage`.

### Windows

- Download and run **Inkwell Setup VERSION.exe** for a guided install with Start Menu and optional desktop shortcuts.
- Or download **Inkwell VERSION.exe** to use the portable build without running an installer.

### macOS

- Download the `.dmg` for your Mac: the filename with `arm64` is for Apple Silicon; the other macOS build is for Intel.
- Open the `.dmg` and drag Inkwell to Applications. These builds are unsigned; macOS may show a security prompt on first launch. Use Control-click → **Open** if macOS blocks the app.

## Run from source

Requirements: Node.js 20 or newer and npm. AI features additionally require the CLI for the provider you choose, installed and signed in separately.

```bash
git clone https://github.com/alisoltanics/inkwell.git
cd inkwell
npm install
npm start
```

Build an installer for the current platform:

```bash
npm run build:linux   # AppImage and .deb (on Linux)
npm run build:win     # NSIS installer and portable .exe (on Windows)
npm run build:mac     # .dmg and .zip (on macOS)
```

Version tags matching `v*` trigger GitHub Actions to build Linux x64, Windows x64, and macOS Intel and Apple Silicon installers, then attach them to a GitHub release.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Save | `Ctrl/Cmd + S` |
| New file | `Ctrl/Cmd + N` |
| Toggle preview | `Ctrl/Cmd + P` |
| Split view | `Ctrl/Cmd + \\` |
| Toggle sidebar | `Ctrl/Cmd + Shift + B` |
| Bold / italic | `Ctrl/Cmd + B` / `Ctrl/Cmd + I` |
| Strikethrough | `Ctrl/Cmd + Shift + X` |
| Insert link | `Ctrl/Cmd + K` |
| Ask AI about selection | `Ctrl/Cmd + J` |
| Zoom in / out / reset | `Ctrl/Cmd + +` / `-` / `0` |
| Close dialog or panel | `Esc` |

## Project layout

- `main.js` — Electron main process, local file access, AI CLI integration, Telegram, and HTML export
- `preload.js` — restricted bridge between the UI and Electron main process
- `html.js` — builds self-contained HTML exports
- `src/renderer/` — application interface and Markdown rendering bundle
- `.github/workflows/release.yml` — cross-platform release build workflow
