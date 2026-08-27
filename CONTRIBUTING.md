# Contributing to DevBroom

Thanks for taking the time to help out. DevBroom is a tool that **deletes files**, so the bar for
correctness is higher than for a typical hobby app — please read the safety notes below before you
open a pull request.

## Setup

You need **Node.js 20 or newer** (Node 22+ recommended) and npm.

```bash
git clone https://github.com/bhrdwjuddhv/DevBroom
cd devbroom
npm install
npm run dev
```

`npm run dev` starts the Vite dev server and launches Electron pointed at it, with hot reload for the
UI. Changes to anything under `electron/` are **main-process** code — restart `npm run dev` for those,
hot reload only covers the renderer.

## Useful commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server + Electron window |
| `npm run build` | Build the renderer into `dist/` |
| `npm start` | Build, then run Electron the way the packaged app runs |
| `npm test` | Run the scanner and AI-helper self-checks |
| `npm run dist` | Package an installer for your current OS into `release/` |

## Project layout

```
electron/main.js       window lifecycle, IPC handlers, settings + report store
electron/scanner.js    rules, safety guards, scanning, sizing, deletion
electron/ai.js         optional local model download + inference
electron/preload.js    the entire API surface the renderer can see
src/                   React renderer (App, Settings, Reports, Charts)
scripts/dev.mjs        dev server + Electron launcher
```

The renderer has **no** filesystem access. Everything goes through `contextBridge` in
`electron/preload.js`. If a feature needs a new capability, add a narrow IPC handler — never widen the
bridge into something generic like `readFile(anyPath)`.

## Safety rules (please don't regress these)

`electron/scanner.js` enforces all of these, and `electron/scanner.test.js` asserts them:

- Drive roots, the home folder root, and system directories can never be scanned or deleted.
- Nothing outside a user-selected scan folder can be deleted, nor a scan folder itself.
- Symbolic links are never followed while scanning, sizing, or deleting.
- Deletion defaults to the system Recycle Bin / Trash. Permanent deletion is opt-in and needs a second
  confirmation.
- A locked or permission-denied path is skipped and reported, never fatal.

If your change touches deletion, scanning, or path handling, **add a test**. The suite is plain Node with
`assert` — no framework, no fixtures. Look at the existing files for the style.

## Pull requests

1. Fork and branch from `main`.
2. Keep the change focused — one concern per PR.
3. Run `npm test` and `npm run build` before pushing.
4. Match the surrounding code style (no semicolons at line ends is not enforced by a linter; just look
   at neighbouring code and blend in).
5. Describe **what you tested manually**, especially for anything that deletes files.

## Reporting bugs

Use the issue templates. For anything with security implications — a path that escapes the safety
guards, for instance — follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
