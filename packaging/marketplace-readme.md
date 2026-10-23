# SessionTree

A conversation map beside your current Codex chat. Follow its origin and forks, then click a node to jump to that conversation.

**Codex desktop · Windows x64 · Runtime included**

## Features

- Left-to-right trees with branch arrows and a highlighted current path.
- Recent user and Codex message previews below each conversation title.
- Search, pan, zoom, collapse branches, fit all, and locate the current chat.
- Change-aware automatic updates that preserve your view.
- Archive badges on archived conversations; archived nodes do not navigate.
- UI text follows the Codex client's language, with 75 bundled language and regional variants.

## Install in Codex

The package includes Node.js. You do not need to install Node.js, npm, or development dependencies, and first use does not download additional code.

1. Add this repository as a custom marketplace once with `codex plugin marketplace add ether-zhang/SessionTree --ref marketplace`.
2. Open **Plugins** in Codex and select the **SessionTree (Windows x64)** source.
3. Find **SessionTree** and click **Install (+)**.
4. Fully quit and reopen Codex if the new tool is not visible.

The [main branch](https://github.com/ether-zhang/SessionTree) contains the source and build instructions. This marketplace branch contains the installable Windows x64 package. To preview an unpacked archive, use `codex plugin marketplace add` followed by the absolute path to the folder containing this README. Disable an existing development copy first to avoid duplicate tools.

Adding a repository source is a one-time setup step. The plugin's installation uses the client's native Install action. [Official marketplace instructions](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli)

## Use the plugin

1. Open an existing Codex chat.
2. In the right-hand pane, select **New tab → More tools → Session Tree**. The tool name follows the client language.
3. Explore the tree and click an available conversation to open it. Each chat opens its own tree.

No chat prompt or Skill invocation is needed.

| Control | Action |
| --- | --- |
| Search | Find conversations while retaining their ancestry. |
| Drag empty space | Pan the tree. |
| Ctrl/⌘ + wheel, or − / + | Zoom. |
| Fit all | Show the complete tree. |
| Locate | Center the current chat and reveal its ancestry. |
| Branch − / + | Collapse or expand a branch. |

Updates appear automatically. When Codex does not supply the active chat, the panel offers a conversation picker.

## Remove or roll back

Uninstall SessionTree from the Plugins directory. To also remove the source:

```powershell
codex plugin remove session-tree@session-tree
codex plugin marketplace remove session-tree
```

If you kept a development install from the `session-tree-local` marketplace, re-enable that copy. Restart Codex if its current connection has not refreshed. These actions do not modify original conversations or Codex client files.

## Local data and compatibility

SessionTree reads local conversation files and metadata and stores its index in the plugin's own data directory. It does not send conversation content to external storage or translation services. Cloud-only and remote-host chats are not supported yet; subagent chats are hidden. Unknown UI languages fall back to English.

This package is Windows x64 only. SessionTree is published by ether-zhang under the [MIT License](LICENSE). The bundled runtime retains its upstream license and dependency notices in `plugins/session-tree/runtime/LICENSE`; see `plugins/session-tree/THIRD_PARTY_NOTICES.md` for provenance.

[Support](https://github.com/ether-zhang/SessionTree/blob/main/SUPPORT.md) · [Privacy](https://github.com/ether-zhang/SessionTree/blob/main/docs/PRIVACY.md) · [Terms](https://github.com/ether-zhang/SessionTree/blob/main/docs/TERMS.md)
