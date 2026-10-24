# Development and advanced installation

[Back to SessionTree](../README.md)

## Build

### Requirements

- Windows x64 or macOS, Node.js 24+, npm, and `tar` on the build machine.
- Git and the Codex CLI with plugin commands for the isolated installation check.
- Internet access for npm dependencies and the first download of the three pinned official Node.js runtimes; subsequent builds reuse the verified local cache.

The frontend uses React, TypeScript and Vite. The build type-checks it and inlines the production JavaScript and CSS into one MCP App HTML resource. The generic tree/index layer and Codex adapter remain independent JavaScript modules. Installed plugins use no development server, CDN or runtime npm dependencies. End users do not need Node.js or npm.

From the project root:

```powershell
npm ci
npm run build:release
npm run verify:release
```

For the current source version, output is written to:

- `dist/session-tree-0.6.0-universal-plugin.zip` — one plugin at the archive root, for the client's **Upload plugin archive** action.
- `dist/session-tree-0.6.0-universal/` and `-marketplace.zip` — the custom marketplace directory and archive.
- Adjacent `.zip.sha256` files and `.metadata.json` — archive checksums, runtime pins, and per-file fingerprints.
- `dist/session-tree-0.6.0-universal.<platform>-<arch>.verification.json` — a report for the actual verification host, created only after it passes.

The same ZIP contains Windows x64, macOS arm64 and macOS x64 runtimes. Its shared `./runtime/node` launcher resolves the adjacent official `node.exe` on Windows. On macOS it chooses the bundled archive for the current architecture, verifies it and expands it into the plugin data directory on first use; warm starts reuse that copy. No runtime download or global installation occurs. The ZIP preserves the Mac launcher's executable permission and remains below the client's 100 MiB bundle limit.

The builder checks runtime SHA-256 hashes and includes Node.js and frontend licenses. It excludes local conversations, indexes, backups, account credentials, test Skills, and retired client experiments. The [SVG master](../plugins/session-tree/assets/session-tree.svg) and [transparent PNG](../plugins/session-tree/assets/session-tree.png) are shared by the plugin and panel.

To intentionally rebuild an existing candidate of the same version:

```powershell
npm run build:release -- --replace
```

Verification extracts the primary plugin ZIP, uses a temporary Git marketplace and isolated Codex data directory, and starts the bundled runtime with system Node removed from PATH. It does not sign in to a real account, call a model API, or change the active plugin installation. It checks file integrity, permissions, marketplace installation, cold/warm startup, the React resource, SQLite/plain/Zstandard indexing, and uninstall. The [CI workflow](../.github/workflows/universal-package.yml) builds once and verifies the exact same ZIP on Windows x64 and both Mac architectures. Native desktop import and rendering remain separate acceptance checks.

### Develop with simulated conversations

For the frontend development server, run `npm run dev:ui` and open `http://127.0.0.1:5173/__preview`. Vite reloads frontend changes in the simulated host. To inspect the exact production document, first run `npm run build:ui`, then:

```powershell
npm run preview:ui
```

Open the localhost URL printed by the command. The fixture uses the production panel with simulated host messages and synthetic conversations. Its controls exercise switching chats, new forks, delayed replies, and disconnected transport. Enter `q` in the terminal to stop it. This is a panel development fixture; it does not demonstrate a modified Codex desktop client.

The architecture keeps three layers: `plugins/session-tree/src/core/` owns reusable tree/index logic, `src/adapters/` reads agent data, and `frontend/codex/` owns the Codex React UI. `src/ui/codex/` provides the existing host bridge, locale catalog and MCP resources. Commit the generated `assets/panel.html` with frontend changes so source installations can start without a compiler. See [the release review](release-review.md) and [roadmap](ROADMAP.md).

## Install

### Packaged custom marketplace

After building, register the generated marketplace directory once:

```powershell
codex plugin marketplace add ./dist/session-tree-0.6.0-universal
```

Then:

1. Open **Plugins** in Codex and select **SessionTree** as the source.
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

Run `npm ci` and `npm run build:ui` first. On Windows, `./scripts/install.ps1` registers the development source; it is a development helper, not the cross-platform end-user installer. On macOS, build the universal ZIP and import it through **Plugins → Add → Upload plugin archive**.

The Windows helper registers the local development marketplace, backs up any previous installed package, and installs the source plugin. Fully quit and reopen Codex to load the change. Restore the previous installed development package with:

```powershell
.\scripts\rollback.ps1
```

Rollback restores the development plugin package; it preserves conversation data and the index and does not revert workspace source files. For a GUI-imported preview, uninstall it and import the previous stable ZIP. The universal package does not modify Codex client files.

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

Cloud-only and remote-host conversations are not supported yet; subagent conversations are hidden. Conversation titles and messages keep their original language; unknown UI languages fall back to English. The universal candidate targets Windows x64, Apple Silicon Mac and Intel Mac. Platform reports describe runtime/MCP checks; they do not establish native desktop UI acceptance.

SessionTree is free software under the [MIT License](../LICENSE), maintained by [ether-zhang](https://github.com/ether-zhang). See [support](../SUPPORT.md), [privacy information](PRIVACY.md), [terms](TERMS.md), and [publication status](PUBLISHING.md).
