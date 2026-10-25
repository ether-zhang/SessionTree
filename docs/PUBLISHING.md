# Publication status

Publisher handle: ether-zhang. License: MIT. The creator selected free distribution, no payments, and all countries supported by the destination directory.

## Native 0.7.1 preview

The `codex/rust-backend` branch retains the React frontend and replaces the Node service with Rust. CI builds and verifies separate Windows x64, Apple Silicon Mac and Intel Mac packages. Each contains one native program, icons, manifests and licenses; no Node runtime, source tree or development dependencies are shipped. The public stable release and marketplace remain on 0.5.8. Native desktop import/rendering must still be accepted before promotion. See [development and rollback](DEVELOPMENT.md).

The [v0.7.1 preview release](https://github.com/ether-zhang/SessionTree/releases/tag/v0.7.1) provides plugin ZIPs and checksums for all three platforms. Git installation uses `codex/marketplace-windows-x64`, `codex/marketplace-macos-arm64`, or `codex/marketplace-macos-x64`. Users add `ether-zhang/SessionTree`, select the matching Git ref, and set sparse paths to `.agents/plugins` and `plugins/session-tree`, one per line. All branches retain the same plugin identity and use precompiled files without invoking Cargo. These payloads come from the verified [native build](https://github.com/ether-zhang/SessionTree/actions/runs/40167614124) at source commit 3edd5fd. Native desktop UI acceptance remains separate from the published package and native startup checks.

## GitHub distribution

The source repository is [ether-zhang/SessionTree](https://github.com/ether-zhang/SessionTree). Native source lives on codex/rust-backend; main retains the previous source with the current installation README. The old marketplace branch contains the stable Windows 0.5.8 package; the three codex/marketplace-* branches contain native 0.7.1 previews. GitHub distribution is separate from publishing to OpenAI's Plugin Directory.

For normal installation, use the client's left-sidebar **Plugins** page and upper-right **Add** menu, then choose **Upload plugin archive** or **Add plugin marketplace** as shown in [the README](../README.md). The creator selected both GUI installation paths on 2026-10-24. GitHub Release v0.7.1 provides the three platform ZIPs and SHA-256 files; v0.5.8 is retained as the previous Windows release.

The equivalent command-line alternative is:

~~~powershell
codex plugin marketplace add ether-zhang/SessionTree --ref codex/marketplace-windows-x64 --sparse .agents/plugins --sparse plugins/session-tree
~~~

Choose the matching platform ref on macOS. After adding the source, choose SessionTree from the **SessionTree (your platform)** source in Codex and use the native Install action.

## Official directory preparation

The portable submission ZIP contains exactly one plugin at its root. It has the local stdio MCP server, bundled runtime, icons, MIT license, listing URLs, five positive and three negative review cases, release notes, commerce declaration, and unrestricted country targeting. It excludes the custom marketplace wrapper, development Skills, local conversations, credentials, caches, and retired client experiments.

The case descriptions live in the plugin manifest. They cover native family display, searching the local index, archived search, missing host-context recovery, and refreshing the index. Negative scenarios cover deleting chats, cloud-only data, and external export. Natural-language intent in a review case does not replace the normal button entry.

Prepare the two archive layouts and check supported MCP behavior with:

~~~powershell
npm run build:release
npm run verify:release
npm run verify:review
npm run build:submission
~~~

Version 0.5.8 passed the isolated installation check and the five positive cases' MCP data paths using synthetic conversations, with zero model API calls. That result does not establish native UI behavior or natural-language tool selection. The three negative model scenarios are not run. The local reports retain those scope limits; no native-host or model-review result has been fabricated.

The review fixture uses IDs 00000000-0000-4000-8000-000000000001 through 00000000-0000-4000-8000-000000000005: parent, active fork, archived sibling, unrelated conversation, and newly added fork respectively. They are synthetic and are not real user conversation IDs.

Preparation still does not establish:

- Approved-partner eligibility and an allowlisted organization for local MCP submission.
- The selected individual publisher's verified OpenAI developer identity.
- A reviewer-accessible recording of the actual native workflow.
- Portal scans, policy attestations, review approval, or directory publication.

The GitHub handle is the source publisher. It must not be represented as an already-verified OpenAI developer identity. Enter any required private reviewer access information only in secure portal fields.

The public listing URLs point to the product README, support page, privacy information, and terms in this repository. All four were fetched anonymously on 2026-10-23, returned HTTP 200, and contained the expected publisher and page content. See [the URL verification report](listing-urls-0.5.8.json). Recheck them before a later portal submission.

See [the walkthrough](DEMO.md) for recording preparation and [desktop-only submission requirements](https://developers.openai.com/plugins/deploy/desktop-only) for the official eligibility gate.

Remote installation acceptance: the 2026-10-23 public GitHub fetch check was blocked during Git HTTPS cloning. The initial isolated-network attempt timed out; the follow-up using normal Git network settings reported a Windows schannel TLS handshake failure. Neither attempt establishes a successful remote installation. The source and marketplace branches were pushed successfully, and the four listing pages are anonymously accessible. See [the remote-check report](hosted-verification-0.5.8.json). No certificate checks were disabled.
