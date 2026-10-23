# Development and advanced installation

[Back to SessionTree](../README.md)

## Build

### Requirements

- Windows x64 and Node.js 24+ on the build machine.
- Git, the Codex CLI with plugin commands, and Windows `tar` for the isolated installation check.
- Internet access for the first download of the pinned official Node.js runtime; subsequent builds reuse the verified local cache.

The plugin runs as JavaScript modules and needs no separate transpilation step. The build creates a distributable marketplace with its own runtime, icons, and production files. End users do not need Node.js or npm.

From the project root:

```powershell
npm run build:release
npm run verify:release
```

For the current source version, output is written to:

- `dist/session-tree-0.5.8-windows-x64/` — the custom marketplace directory.
- `dist/session-tree-0.5.8-windows-x64.zip` and `.zip.sha256` — archive and checksum.
- `dist/session-tree-0.5.8-windows-x64.verification.json` — the installation verification report, created only after verification succeeds.

The builder checks the runtime archive and executable SHA-256 hashes and includes its upstream license. It excludes local conversations, indexes, backups, account credentials, test Skills, and retired client experiments. The [SVG master](../plugins/session-tree/assets/session-tree.svg) and [transparent PNG](../plugins/session-tree/assets/session-tree.png) are shared by the plugin and panel.

To intentionally rebuild an existing candidate of the same version:

```powershell
npm run build:release -- --replace
```

Verification uses a temporary Git repository, an isolated Codex data directory, synthetic conversations, and the bundled runtime with system Node removed from PATH. It does not sign in to a real account, call a model API, or change the active plugin installation. It checks the packaged files, Git marketplace installation, MCP startup, UI loading, indexing, and uninstall. The native desktop Install button and fetching an eventual hosted repository still require acceptance checks.

### Develop with simulated conversations

```powershell
node scripts/preview-thread-panel.mjs
```

Open the localhost URL printed by the command. The fixture uses the production panel with simulated host messages and synthetic conversations. Its controls exercise switching chats, new forks, delayed replies, and disconnected transport. Enter `q` in the terminal to stop it. This is a panel development fixture; it does not demonstrate a modified Codex desktop client.

The architecture separates the reusable tree/index core, agent data adapters, and agent-specific UI. See [the release review](release-review.md) for packaging details and [the roadmap](ROADMAP.md) for remaining work.

## Install

### Packaged custom marketplace

After building, register the generated marketplace directory once:

```powershell
codex plugin marketplace add ./dist/session-tree-0.5.8-windows-x64
```

Then:

1. Open **Plugins** in Codex and select **SessionTree (Windows x64)** as the source.
2. Find **SessionTree** and click **Install (+)**.
3. Fully quit and reopen Codex if the new tool is not visible.

Disable an existing `session-tree@session-tree-local` development copy before enabling the packaged copy, to avoid duplicate tools. The package includes Node.js; installation does not install a global runtime or download code on first use.

The public source is [ether-zhang/SessionTree](https://github.com/ether-zhang/SessionTree). The `main` branch contains source; the `marketplace` branch contains the Windows x64 package and bundled runtime. To install the packaged build directly, add it with:

```powershell
codex plugin marketplace add ether-zhang/SessionTree --ref marketplace
```

Then follow the same native installation steps. If Git HTTPS cannot connect, download the [marketplace branch ZIP](https://github.com/ether-zhang/SessionTree/archive/refs/heads/marketplace.zip), unpack it, and add the unpacked marketplace folder as a local source as shown above. [Official marketplace setup](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)

A custom repository marketplace is separate from the official Plugin Directory. Local MCP submission to that directory currently requires approved-partner access. [Desktop-only submission requirements](https://developers.openai.com/plugins/deploy/desktop-only)

### Install from source for development

This option uses Node.js 24+ from the developer's machine:

```powershell
.\scripts\install.ps1
```

The installer registers the local development marketplace, backs up any previous installed package, and installs the source plugin. Fully quit and reopen Codex to load the change. Restore the previous installed development package with:

```powershell
.\scripts\rollback.ps1
```

Rollback restores the plugin package; it preserves conversation data and the index and does not revert workspace source files.

### Remove the packaged copy

Uninstall **session-tree@session-tree** in the Plugins directory, then remove its marketplace source. CLI equivalents:

```powershell
codex plugin remove session-tree@session-tree
codex plugin marketplace remove session-tree
```

If you kept a development copy, re-enable it. Restart Codex if it still holds the previous MCP connection.

## Use

1. Open an existing Codex conversation.
2. In the right-hand pane, select **New tab → More tools → Session Tree**. The entry name follows the client language.
3. Explore the current conversation's tree. Click an available node to open its conversation.

Each conversation opens its own tree. Normal use starts from the UI and requires no chat prompt or Skill invocation. A shallower conversation entry remains planned.

| Control | Action |
| --- | --- |
| Search | Find matching conversations while keeping their ancestry visible. |
| Drag empty space | Pan the tree. |
| Ctrl/⌘ + wheel, or − / + | Zoom. |
| Fit all | Show the complete tree. |
| Locate | Center the current chat and reveal its ancestry. |
| Branch − / + | Collapse or expand a branch. |
| Archived node | Remain visible with an archive badge; navigation is disabled. |

Updates preserve your search, collapsed branches, and view. When Codex cannot identify the active conversation, the panel offers a conversation picker.

SessionTree reads local conversation files and metadata and keeps its index in the plugin's own data directory. It does not modify original conversations or Codex client installation files, or send conversation content to external storage or translation services.

Cloud-only and remote-host conversations are not supported yet; subagent conversations are hidden. Conversation titles and messages keep their original language; unknown UI languages fall back to English. The packaged runtime currently targets Windows x64; other operating systems still need validation.

SessionTree is free software under the [MIT License](../LICENSE), maintained by [ether-zhang](https://github.com/ether-zhang). See [support](../SUPPORT.md), [privacy information](PRIVACY.md), [terms](TERMS.md), and [publication status](PUBLISHING.md).
