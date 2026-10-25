# Development and advanced installation

[Back to SessionTree](../README.md)

## Build

Build on the target platform: Windows x64, Apple Silicon Mac, or Intel Mac. The build machine needs Node.js 24+, npm, Rust 1.96+, Cargo, and a C compiler (MSVC Build Tools on Windows or Xcode Command Line Tools on macOS). Dependencies are locked in package-lock.json and Cargo.lock. The first build downloads build dependencies; installed plugins download nothing.

~~~shell
npm ci
npm run build:release
~~~

This type-checks and bundles the React frontend, compiles the Rust service, and builds two ZIP layouts for the current host. End users need neither Node.js nor Rust.

| Host | Output prefix | Rust target |
| --- | --- | --- |
| Windows x64 | dist/session-tree-0.7.1-windows-x64 | x86_64-pc-windows-msvc |
| Apple Silicon Mac | dist/session-tree-0.7.1-macos-arm64 | aarch64-apple-darwin |
| Intel Mac | dist/session-tree-0.7.1-macos-x64 | x86_64-apple-darwin |

For each prefix:

- The -plugin.zip archive contains exactly one plugin at its root, for **Upload plugin archive**.
- The directory and -marketplace.zip contain the repository marketplace payload.
- Adjacent .zip.sha256 and .metadata.json files record archive and per-file integrity.
- A .verification.json report is created only after the isolated installation check passes.

Each plugin contains one native binary, its manifests, icons, and licenses. The React HTML and MCP catalog are embedded in the binary; no Node runtime, source tree, Cargo target directory, or node_modules are shipped. SQLite and Zstandard are linked into the binary. The Windows build links its C runtime statically, and ZIPs preserve the macOS executable permission.

To intentionally replace a candidate of the same version, use:

~~~shell
npm run build:release -- --replace
~~~

## Verify

~~~shell
cargo test --workspace --locked
npm run test:native
npm run verify:release
~~~

The native checks reuse the existing protocol tests and compare the Rust index with the JavaScript reference adapter. Fixtures cover SQLite/WAL, plain and compressed conversations, canonical fork metadata, archives, subagents, missing ancestors, attachment/selection text, bounded append reads, and database-version checks without additional conversation reads. The old JavaScript backend is retained as a migration reference and is excluded from distribution.

The release check uses a temporary Git marketplace and isolated Codex home. It checks ZIP hashes and executable permissions, installs the package, launches the resolved binary without Node/Rust on PATH, checks native library dependencies, reads a synthetic conversation tree and embedded UI, then uninstalls it. It never signs in, calls a model API, or changes the active plugin installation.

The [native package workflow](../.github/workflows/native-package.yml) builds and verifies each platform on its own runner. Its reports cover CLI/MCP behavior and actual binary execution; native desktop import, rendering and UI placement remain separate acceptance checks.

## Develop the panel

For frontend hot reload:

~~~shell
npm run dev:ui
~~~

Open http://127.0.0.1:5173/__preview to use the simulated host. For the exact production HTML, run:

~~~shell
npm run build:ui
npm run preview:ui
~~~

Open the printed localhost URL. Synthetic controls exercise conversation switching, new forks, locale changes, delayed replies and disconnection. Enter q in the terminal to stop the fixture. Rebuild the Rust backend after production frontend changes so it embeds the new document:

~~~shell
npm run build:backend
~~~

The three layers remain separate:

- **Generic tree/index:** crates/session-tree-core owns records, ancestry, missing parents and cycle repair.
- **Agent adapter:** crates/session-tree-codex owns Codex files, SQLite metadata, previews and request-driven database version checks.
- **Host UI:** frontend/codex owns the React panel; crates/session-tree serves the existing MCP protocol and embedded assets. Pure browser layout and localization modules remain independent of native storage.

Commit generated panel.html and native-catalog.json with frontend/catalog changes. Version 0.7.1 has no filesystem watchers, event queue, sampling timer or background scanner. Each open/resume checks the database once; foreground requests use PRAGMA data_version on the same read-only connection without a long transaction. An unchanged database returns the cached panel before copying the index. New or changed database rows supply rollout paths; only the selected family needs fresh message excerpts. Missing host context does not subscribe to all conversations. Existing relationships are reused from the plugin-owned index. A first index reads previously unknown session headers; previews have a shared 64 MiB per UI-request budget. Failed, unchanged previews are not retried on every update. Legacy profiles without SQLite are discovered only on initial load and explicit open/refresh. Hidden panels send no polling requests.

## Install and Git distribution

For a locally built preview, use **Plugins → Add → Upload plugin archive** and select the matching platform's -plugin.zip without unpacking it.

Alternatively, unpack the -marketplace.zip and add its marketplace root as a local source in **Plugins → Add → Add plugin marketplace**. Then select **SessionTree (your platform)** and click **Install**. The CLI equivalent on Windows is:

~~~shell
codex plugin marketplace add ./dist/session-tree-0.7.1-windows-x64
~~~

Git installation uses the published, precompiled 0.7.1 preview payloads:

| Device | Source | Git ref |
| --- | --- | --- |
| Windows x64 | ether-zhang/SessionTree | codex/marketplace-windows-x64 |
| Apple Silicon Mac | ether-zhang/SessionTree | codex/marketplace-macos-arm64 |
| Intel Mac | ether-zhang/SessionTree | codex/marketplace-macos-x64 |

Users choose the matching Git ref once; Codex runs its prebuilt binary and does not compile the source or choose another architecture automatically. All platform branches keep the same plugin identity. The [v0.7.1 preview release](https://github.com/ether-zhang/SessionTree/releases/tag/v0.7.1) also provides each platform's plugin ZIP and checksum. The old marketplace branch and stable v0.5.8 release remain available for Windows rollback. Publishing the Mac packages does not establish native desktop UI acceptance.

For those platform refs, enter both **.agents/plugins** and **plugins/session-tree** in **Sparse paths**, one per line. The current importer performs a full Git clone when that field is empty; sparse import avoids fetching old runtime blobs and unrelated branch contents. The isolated release check exercises this layout, including a default branch without the marketplace catalog.

For source development on Windows, build first, then run scripts/install.ps1. It backs up the previous development package. Restore that package with scripts/rollback.ps1. These helpers are separate from the cross-platform end-user ZIP installer.

## Use and rollback

Open an existing conversation's right pane: **New tab → More tools → Session Tree**. The entry follows the client language. Each conversation opens its own family. Search, pan, zoom, fit, locate and branch collapse retain their existing behavior. Archived chats remain visible and cannot be opened. A conversation picker appears when host context is unavailable. This refactor does not add a shallower shortcut.

Keep the previous working ZIP. To roll back an imported preview, uninstall it and import the previous ZIP; restart the client if it retains an old MCP connection. The plugin does not modify original conversations or Codex installation files. Its plugin-owned index remains compatible with the previous format.

Cloud-only and remote-host chats remain unsupported; subagents are hidden from the normal graph. Titles and messages retain their original language. See [support](../SUPPORT.md), [privacy](PRIVACY.md), [MIT License](../LICENSE), and [publication status](PUBLISHING.md).
