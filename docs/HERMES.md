# SessionTree for Hermes Desktop

Experimental adaptation on `feat/hermes-adapter`, using the real Hermes Desktop SDK, titlebar and pane host. No replacement desktop UI or copied client resources are involved.

## Build

With Node.js 24+, run from SessionTree:

```powershell
npm run build:hermes
```

Output: `dist/session-tree-hermes/plugin.js`. Its only external imports are `react` and `@hermes/plugin-sdk`, supplied by Hermes. The embedded graph is built from the same shared renderer as Codex.

## Load in an isolated Hermes instance

Use the real Hermes development app with a throwaway `HERMES_HOME` and separate Electron data. Its `scripts/dev-sandbox.sh` provides isolation; do not seed it from real account data. Hermes also has a `dev:mock` inference flow that retains the real desktop UI.

Copy the generated file to `<isolated HERMES_HOME>/desktop-plugins/session-tree/plugin.js`. Enable SessionTree in the desktop plugin inventory; it is opt-in by default.

Click SessionTree in the application titlebar. This explicit action registers a native right-hand pane. Both the action and pane belong to the application, so chat changes do not close or remount the graph. The shared renderer mounts inside a scoped ShadowRoot and follows the focused stored session and resolved connection/profile. Close using native pane controls; reopen from the titlebar. Disabling the plugin disposes contributions and subscriptions.

## Current SDK limits and acceptance

- Requires focused-session ownership, scoped persisted-session reads, native session navigation, pane visibility and titlebar/pane contributions from the SDK.
- The SDK's list helper caps reads at 500 rows and excludes archived sessions. Incomplete coverage is recorded as a partial-index issue; missing ancestors remain explicit placeholders. The data adapter supports archives when a source provides them.
- Cards show the native visible session summary. The plugin does not download unbounded transcripts or label a summary as the latest user/assistant message.
- Older data containing only an ambiguous parent pointer is marked as unknown ancestry.
- Adapter checks and a successful build do not prove native UI rendering or pane lifetime. Real desktop acceptance is tracked separately.

## Reference source

`D:/Project/hermes-agent` is beside `D:/Project/codex`. Inspected commit: `db1fa153`, 2026-10-23.

[Desktop SDK](https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/sdk/index.ts) · [Permanent titlebar areas](https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/sdk/areas.ts) · [Runtime loader](https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/contrib/runtime-loader.ts) · [Branch semantics](https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/src/lib/session-branch-tree.ts)
