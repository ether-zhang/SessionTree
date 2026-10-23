# SessionTree

A conversation tree for Codex. Follow the origin and forks of a chat, see recent user and Codex messages, and jump between conversations. Search, pan, zoom, and collapse branches; the UI follows your client language.

![SessionTree illustration with fictional conversations](docs/images/session-tree.svg)

## Build & install

For Codex desktop on Windows x64. The packaged plugin includes its runtime.

```powershell
codex plugin marketplace add ether-zhang/SessionTree --ref marketplace
```

In Codex, open **Plugins**, select **SessionTree (Windows x64)**, and click **Install (+)**. Reopen Codex if needed.

From a source checkout, with Node.js 24+:

```powershell
.\scripts\install.ps1
```

Open the tree from the conversation's right-hand pane: **New tab → More tools → Session Tree**.

[Development guide](docs/DEVELOPMENT.md) · [Support](SUPPORT.md) · [Privacy](docs/PRIVACY.md) · [MIT License](LICENSE)
