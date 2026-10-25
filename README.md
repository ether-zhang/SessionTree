# SessionTree — Windows x64 preview

Native Rust conversation-tree plugin for Codex desktop, version 0.7.1. No separately installed Node.js or Rust is needed.

This preview has no filesystem watchers or background scanner. Opening checks local data once; while visible, the panel checks a read-only SQLite version and reads only needed excerpts.

## Install from Git

In the left sidebar, open **Plugins（插件）**, then upper-right **Add（添加） → Add plugin marketplace（添加插件市场）**.

| Field | Value |
| --- | --- |
| Source | ether-zhang/SessionTree |
| Git ref | codex/marketplace-windows-x64 |
| Sparse paths, one per line | .agents/plugins<br>plugins/session-tree |

Add the marketplace, select **SessionTree (Windows x64)**, then install SessionTree. Reopen Codex if the connection has not reloaded.

Open an existing conversation, then **New tab → More tools → Session Tree** in the right pane. The entry name follows the client language.

This branch contains the precompiled Windows payload. Source: [codex/rust-backend](https://github.com/ether-zhang/SessionTree/tree/codex/rust-backend). Stable distribution is unchanged.

To undo a first-time install, uninstall session-tree@session-tree and remove this marketplace. Original conversations are read-only.

[Support](https://github.com/ether-zhang/SessionTree/blob/main/SUPPORT.md) · [Privacy](https://github.com/ether-zhang/SessionTree/blob/main/docs/PRIVACY.md) · [MIT License](LICENSE)
