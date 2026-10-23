# SessionTree layers

Codex MCP Apps and the Hermes Desktop SDK share one tree core and graph renderer. The standalone Lab is an interaction fixture, not a client compatibility test.

| Layer | Ownership | Modules under plugins/session-tree/src |
| --- | --- | --- |
| Tree core | Generic records, ancestry, family selection, layout and storage | core/, service.mjs |
| Agent adapters | Native identities, provenance, metadata and change detection | adapters/codex*.mjs, adapters/hermes.mjs |
| Host UI | Current context, transport, native navigation and lifecycle | ui/codex/, ui/hermes/ |

## Shared presentation

`ui/shared/` owns the HTML, CSS, language tables and graph interaction. It has no UUID rule, native URI scheme, MCP call, gateway client or credentials.

The supplied host implements `initialize()`, `loadPanel({ refresh, selectedNodeId, check })`, `canOpen(node)`, `openNode(node)`, `on('contextchange', listener)`, `describeError(error)` and `close()`. Visibility notifications let a hidden host pause refresh. Only the host translates opaque graph node IDs to native identities.

Existing Codex resource URIs and public exports remain compatible. Its bootstrap supplies AppBridge, which owns MCP, globals notifications and protected deep links. Hermes supplies a permanent application titlebar action and a persistent native pane. The same renderer mounts in a scoped ShadowRoot, with local styles and DOM IDs; it does not replace the app's language, title or theme. Native code runs through the SDK's ESM loader, without an executable iframe or script injection.

## Hermes identity

A record is qualified by connection + profile + compression lineage root. The separate navigation target retains the current stored session ID. Compression can rotate that target without replacing the graph node.

`_branched_from` declares a fork, `_reset_from` starts a separate conversation, and `_lineage_root_id` / `_lineage_ids` identify continuation segments. A bare, unclassified parent pointer is reported as unknown ancestry rather than guessed to be a fork.

The adapter receives a source callback; it has no filesystem, network, DOM or SDK import. Warm unchanged reads use its cache, and native metadata events invalidate it. Scope changes create another adapter; responses from an obsolete scope/session are rejected. Native summaries remain summaries, not alleged recent user/assistant messages.
