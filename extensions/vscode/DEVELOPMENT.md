# Development and compatibility

[Back to SessionTree](README.md)

## Build

From the repository root:

```sh
npm ci
npm ci --prefix extensions/vscode
npm run build:vscode
npm --prefix extensions/vscode test
npm run package:vscode
```

The build needs Rust, Cargo, a C toolchain and the Node development dependencies. It compiles the Rust reader for the current host and bundles the React/TypeScript canvas with Vite. Previously verified artifacts under `dist/session-tree-0.7.1-preview-3edd5fd/` supply the unchanged Rust third-party license inventory; frontend licenses are bundled with the canvas. The packaging script creates a VSIX for the current host under `dist/vscode/`. Build tools and `node_modules` are excluded.

Platform targets are `win32-x64`, `darwin-arm64` (Apple Silicon) and `darwin-x64` (Intel Mac). Build on each target platform. The current Windows preview has user acceptance; native VS Code UI acceptance on Mac is pending. Linux, browser-hosted VS Code, and virtual workspaces are not packaged in this preview.

## Preview

Run `npm --prefix extensions/vscode run preview` to open an isolated VS Code development window with synthetic sessions and no other installed extensions. It uses separate settings and does not sign in or load real Codex data. Close that window to end the preview. To remove an installed preview, uninstall **SessionTree** from Extensions.

For the canvas alone, build first and run `npm --prefix extensions/vscode run preview:graph`. The localhost page contains only fictional sessions; enter `q` in its terminal to stop it. The README image also uses fictional sessions.

## Navigation

Both levels share one Explorer view, preserving its height, width and position. The initial list shows individual conversations ordered by latest activity. Clicking a row enters that exact conversation's complete family, including ancestors, siblings, descendants and archived branches across worktrees. Back restores the list and its scroll position. New windows start in the list; there is no automatic tracking of Codex's active panel. Subagent chats are excluded.

The second level uses a React/SVG canvas with fixed 120 × 32 title boxes. The common tree layout keeps branches stable across activity-time updates. Only visible list rows, boxes and edges are rendered. Arrow keys pan, `+`/`-` zoom, `0` fits, and `Home` locates the selected conversation. Right-click a graph node to copy its ID.

Clicking an available tree node opens `<editor URI scheme>://openai.chatgpt/local/<thread ID>` through VS Code's `env.openExternal` API. The route has a [public Windows verification record](https://github.com/AndrewAvery7/claude-codex-bridge/blob/main/docs/TESTING.md), but is not a documented stable Codex extension API. The user accepted the current Windows preview after testing. Mac navigation remains unverified. VS Code controls which window receives a URI when several windows are open. SessionTree does not modify Codex or fall back to another app; the target Codex extension must be installed, enabled and use the same data profile.

## Data and performance

The default data directory is `CODEX_HOME` or `~/.codex` on the extension's host. Change **Settings → SessionTree → Codex Home** if needed. The agent setting and `SessionProvider` interface allow additional adapters; only Codex is implemented.

Opening the view reads metadata once. The list and tree share the same snapshot. While the view and window are visible, database checks run every 30 seconds without file watchers. Normal refreshes do not read message bodies. A node hover waits briefly, then reads only that session's first user message and visible assistant reply, skipping tools, reasoning and message envelopes. Reads stop after the first reply or 2 MiB of decoded input, return at most 160 characters per speaker, and reuse a bounded in-memory cache. Empty, unavailable and read-limit results are distinguished.

Unchanged family data is not resent to the canvas. Drawing changes only with data or interaction. Collapsing the view, hiding Explorer, or switching away from the window stops the timer and reader process. The hidden canvas retains only viewport state; preview text is not persisted. SessionTree's reader never edits original conversations or calls a model API.
