# SessionTree Windows 0.5.8 release review

This document covers the GitHub marketplace package and the scope of its validation. The source repository is [ether-zhang/SessionTree](https://github.com/ether-zhang/SessionTree). GitHub distribution is separate from official-directory submission; no public-directory submission has been made. The active development plugin is unchanged.

This document records stable 0.5.8. Its build and isolated installation check passed on 2026-10-23 using synthetic conversations without account sign-in or model API calls. The newer Rust/React 0.7.1 candidate and its platform verification are described in the [development guide](DEVELOPMENT.md). Earlier local candidates are preserved separately.

## Installation experience

The installation flow is **add the repository marketplace once → select SessionTree in Codex → click Install (+)**. Use the marketplace branch of ether-zhang/SessionTree. The package contains everything needed to start its local MCP server. Users do not install Node.js or run npm.

Source registration uses Codex's supported plugin marketplace add command. Installation is one click after that source is configured; adding a previously unknown repository is a separate step.

The existing conversation entry remains **New tab → More tools → Session Tree**. This packaging change does not add a shallower shortcut.

## Candidate contents

- `dist/session-tree-0.5.8-windows-x64/`: the repository marketplace root, prepared for the marketplace branch.
- `dist/session-tree-0.5.8-windows-x64.zip`: the same complete marketplace as a portable archive.
- `.agents/plugins/marketplace.json`: the catalog Codex reads, with a relative path to the plugin.
- `plugins/session-tree/`: production source, UI, manifests, third-party notice, and the unmodified official Node.js 24.22.0 Windows x64 runtime with its complete license.
- `plugins/session-tree/assets/`: the SVG and PNG icons required by the manifest and the inline panel resource. The builder now includes them so startup does not depend on the source checkout.
- `release.json`: runtime provenance and SHA-256 checksums for the candidate files.
- Adjacent `.zip.sha256` and `.verification.json`: archive checksum and validation results.

The package excludes local conversations, indexes, backups, authentication files, test Skills, development installers, and retired client experiments. It does not patch or repack Codex.

The production launcher is `./runtime/node.exe`. Codex resolves this contained path against the installed plugin root; its argument and data-directory placeholders are resolved by Codex. No startup downloader or global runtime installation is involved.

## What was verified

One focused installation check covers the complete local chain:

1. Check every packaged file and extract the ZIP, including the hidden marketplace directory.
2. Have Codex clone a Git marketplace and install/enable the plugin in a fresh profile, with system Node absent from PATH. A temporary Git URL mapping redirects the test URL to a local repository; nothing is fetched from or published to a hosted service.
3. Ask Codex for the resolved MCP launcher and confirm it points to the installed copy of the bundled executable.
4. Launch it with an empty PATH and exercise SQLite and Zstandard.
5. Load the conversation tool and UI, then read a two-node fixture tree from SQLite, a plain conversation file, and a compressed file.
6. Uninstall the plugin and remove the source in the temporary profile.

No existing conversation data or active plugin configuration is used for these fixtures. The temporary repository contains no README commit. Successful fixtures are removed; failed fixtures remain under `.session-tree/release-verification/` for diagnosis.

Desktop installation by clicking **Install (+)** and downloading the eventual real Git repository remain unverified. The candidate is Windows x64 only.

## Local preview and rollback

To review the client install manually, register the candidate folder using the command in the project README. Disable the old `session-tree@session-tree-local` development plugin before enabling the candidate, to avoid duplicate tools. This is a manual acceptance option; it has not been applied to the active profile.

Rollback is to uninstall `session-tree@session-tree`, remove the `session-tree` marketplace, and re-enable the old development plugin. Restart Codex if its current MCP connection has not refreshed. No client files are replaced, and original conversations remain intact.

## Before publication

The creator selected the personal publisher ether-zhang and the MIT License. The runtime retains its own upstream license and embedded dependency notices. Native desktop acceptance remains separate from the isolated CLI checks. See [publication status](PUBLISHING.md) for the official directory's remaining eligibility, identity, recording, and review prerequisites.

Official references: [repository marketplaces](https://developers.openai.com/plugins/build/plugins#add-a-marketplace-from-the-cli), [Node.js runtime and checksums](https://nodejs.org/download/release/v24.22.0/).
