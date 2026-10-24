# SessionTree

A conversation tree for Codex. Follow the origin and forks of a chat, see recent user and Codex messages, and jump between conversations. Search, pan, zoom, and collapse branches; the UI follows your client language.

![SessionTree illustration with fictional conversations](https://raw.githubusercontent.com/ether-zhang/SessionTree/main/docs/images/session-tree.svg)

## Install

The 0.7.0 preview uses a native Rust service and the React UI. Each platform has its own package and needs no Node.js or Rust installation. To test this build, select its matching -plugin.zip in **Plugins → Add → Upload plugin archive**, or add this unpacked marketplace root as a local source. The stable public links below remain on Windows 0.5.8 until the preview is accepted.

Open **Plugins（插件）** in the **left sidebar**, then click **Add（添加）** in the **upper-right corner**. Choose either method below.

**Option 1 — Upload the plugin ZIP**

1. Download [session-tree-0.5.8-windows-x64-plugin.zip](https://github.com/ether-zhang/SessionTree/releases/download/v0.5.8/session-tree-0.5.8-windows-x64-plugin.zip).
2. Select **Upload plugin archive（上传插件压缩包）** and choose the ZIP without unpacking it.
3. Follow the prompts to finish importing and installing SessionTree.

**Option 2 — Add the plugin marketplace**

1. Select **Add plugin marketplace（添加插件市场）**.
2. Fill in the following fields:

| Field | Value |
| --- | --- |
| Source（来源） | `ether-zhang/SessionTree` |
| Git ref（Git 引用） | `marketplace` |
| Sparse paths（稀疏路径） | Leave empty |

3. Click **Add marketplace（添加市场）**, select the **SessionTree (Windows x64)** stable source, and click **Install（安装）** on SessionTree. Locally built native previews label the source with their target platform.

Use one installation method to avoid duplicate copies. Reopen the client if needed. Open the tree from a conversation's right-hand pane: **New tab → More tools → Session Tree**.

[Development guide](https://github.com/ether-zhang/SessionTree/blob/main/docs/DEVELOPMENT.md) · [Support](https://github.com/ether-zhang/SessionTree/blob/main/SUPPORT.md) · [Privacy](https://github.com/ether-zhang/SessionTree/blob/main/docs/PRIVACY.md) · [MIT License](LICENSE)
