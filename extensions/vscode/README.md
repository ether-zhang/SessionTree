# SessionTree for VS Code

A collapsible conversation tree inside **Explorer**, beside views such as Outline and Timeline. This preview displays Codex conversation families; the view and provider contract are independent of the agent, so other adapters can be added later.

## Try it

1. Open **Extensions → ⋯ → Install from VSIX…** and choose the package for your platform: `win32-x64`, `darwin-arm64` (Apple Silicon), or `darwin-x64` (Intel Mac).
2. Open a project folder, then expand **SessionTree** near the bottom of **Explorer**. You can drag its header to reorder it.
3. Expand conversation nodes to see their forks. Families and branches are ordered by their latest activity, newest first. An updated descendant moves the whole family up. Archived conversations carry an archive icon and label. Hover for the workspace and session ID; the copy action copies that ID.
4. The globe button shows all local conversation trees; the folder button returns to the current workspace. The refresh button checks immediately.

This first preview is **display only**: clicking a row does not open, resume, or send a message to a conversation. There is no login, model API call, or dependency on the Codex IDE extension. Native programs are bundled; no separately installed Node.js or Rust is required.

The default data directory is `CODEX_HOME` or `~/.codex` on the host running the extension. Change **Settings → SessionTree → Codex Home** if needed. The workspace filter keeps complete families when any member belongs to an open folder, including branches in related worktrees. Unrelated projects and subagent chats are hidden by default.

Opening the view reads metadata once. While the view and window are visible, database checks run every 30 seconds, with no file watchers or message-body reads. Collapsing the view, hiding Explorer, or switching away from the VS Code window stops the timer and reader process. Conversations are read-only; the extension's index lives in its own VS Code storage.

Only Codex is selectable in this preview. The agent setting and `SessionProvider` interface are ready for additional implementations. Native VS Code UI acceptance on Mac remains pending. Linux, browser-hosted VS Code, and virtual workspaces are not packaged in this preview.

## Develop

From the repository root:

```sh
npm ci --prefix extensions/vscode
npm run build:vscode
npm --prefix extensions/vscode test
npm run package:vscode
```

The build needs Rust, Cargo, a C toolchain and the Node development dependencies. It compiles the Rust reader for the current host, retaining activity timestamps in index revisions for this view. Previously verified artifacts under `dist/session-tree-0.7.1-preview-3edd5fd/` supply the unchanged third-party license inventory. The packaging script creates a VSIX for the current host under `dist/vscode/`; build on each platform for its package. Build tools and `node_modules` are excluded.

Run `npm --prefix extensions/vscode run preview` to open an isolated VS Code development window with synthetic sessions and no other installed extensions. It uses separate settings and does not sign in or load your real Codex data. Close that window to end the preview. To remove an installed preview, uninstall **SessionTree** from Extensions.

[Project](https://github.com/ether-zhang/SessionTree) · [Privacy](https://github.com/ether-zhang/SessionTree/blob/main/docs/PRIVACY.md) · MIT License
