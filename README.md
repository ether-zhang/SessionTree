# SessionTree

A conversation tree for Codex. Follow the origin and forks of a chat, see recent user and Codex messages, and jump between conversations. Search, pan, zoom, and collapse branches; the UI follows your client language.

![SessionTree illustration with fictional conversations](https://raw.githubusercontent.com/ether-zhang/SessionTree/main/docs/images/session-tree.svg)

## Install

Version **0.7.1 preview** supports Windows x64, Apple Silicon Mac and Intel Mac. Each package includes a native Rust program; no Node.js or Rust installation is needed. macOS packages pass native build and startup checks; desktop UI acceptance is still pending.

Open **Plugins（插件）** in the **left sidebar**, then click **Add（添加）** in the **upper-right corner**. Choose your platform below, then use either installation method.

| Platform | Plugin ZIP | Git ref（Git 引用） |
| --- | --- | --- |
| Windows x64 | [Download ZIP](https://github.com/ether-zhang/SessionTree/releases/download/v0.7.1/session-tree-0.7.1-windows-x64-plugin.zip) | `codex/marketplace-windows-x64` |
| Apple Silicon Mac (M series) | [Download ZIP](https://github.com/ether-zhang/SessionTree/releases/download/v0.7.1/session-tree-0.7.1-macos-arm64-plugin.zip) | `codex/marketplace-macos-arm64` |
| Intel Mac | [Download ZIP](https://github.com/ether-zhang/SessionTree/releases/download/v0.7.1/session-tree-0.7.1-macos-x64-plugin.zip) | `codex/marketplace-macos-x64` |

**Option 1 — Upload the plugin ZIP**

1. Download the ZIP for your platform from the table above.
2. Select **Upload plugin archive（上传插件压缩包）** and choose that ZIP without unpacking it.
3. Follow the prompts to finish importing and installing SessionTree.

**Option 2 — Add the plugin marketplace**

1. Select **Add plugin marketplace（添加插件市场）**.
2. Fill in the following fields:

| Field | Value |
| --- | --- |
| Source（来源） | `ether-zhang/SessionTree` |
| Git ref（Git 引用） | The matching ref from the platform table above |
| Sparse paths（稀疏路径）, one per line | `.agents/plugins`<br>`plugins/session-tree` |

3. Click **Add marketplace（添加市场）**, select **SessionTree (your platform)**, and click **Install（安装）** on SessionTree. Git installation uses a precompiled program and does not build from source.

Use one installation method to avoid duplicate copies. If switching from ZIP to Git, keep your working ZIP and uninstall its copy first. Reopen the client if the connection has not reloaded. Open the tree from a conversation's right-hand pane: **New tab → More tools → Session Tree**.

To roll back, uninstall the preview and import your previous ZIP. Original conversations are read-only.

[Development guide](https://github.com/ether-zhang/SessionTree/blob/codex/rust-backend/docs/DEVELOPMENT.md) · [Support](https://github.com/ether-zhang/SessionTree/blob/main/SUPPORT.md) · [Privacy](https://github.com/ether-zhang/SessionTree/blob/main/docs/PRIVACY.md) · [MIT License](LICENSE)
