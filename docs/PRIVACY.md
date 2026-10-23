# SessionTree privacy information

Last updated: 2026-10-23

Publisher and maintainer: [ether-zhang](https://github.com/ether-zhang). Contact: [the support page](../SUPPORT.md).

## Local conversation data

SessionTree runs as a local MCP process. It reads Codex conversation files and local metadata to identify conversation IDs, titles, source and fork relationships, timestamps, workspace paths, archive state, and recent user and Codex message excerpts.

The plugin stores an index containing this metadata and excerpts in its own data directory. The installed package uses the host-provided plugin data directory. Source development can use an explicitly selected data directory. An assistant-requested compatibility view can also create a small local .sessiontree shortcut in that directory.

SessionTree does not edit or delete original Codex conversations. Subagent conversations are hidden from the normal graph, but their metadata can be present in the local index and can be requested through the advanced search tool.

## Network and host processing

The production plugin contains no standalone network service, analytics, advertising, or external translation integration. It does not send conversation data to a service operated by the maintainer.

The panel communicates with the Codex host using MCP Apps messages. When a user explicitly asks the assistant to search sessions or display the tree, tool results such as conversation titles, IDs, paths, and counts are returned to that host. The host may process those results under its own settings and privacy terms. Local execution does not mean that every host interaction is exempt from the host's data processing.

Downloading the plugin or its source involves GitHub. Codex and GitHub remain separate services with their own data practices.

## Retention and deletion

The index remains in the selected plugin data directory until it is replaced by an index refresh or removed by the user or host. Uninstalling the plugin should not be assumed to erase all cached data.

To remove the cache, stop the plugin and delete its own data directory using the host's data-management controls or the directory you explicitly selected for development. Do not delete the Codex conversation directory. Removing the cache does not remove original conversations.

## Support

The maintainer receives only information users voluntarily post to the public GitHub issue tracker or other GitHub interactions. Do not post private conversations, credentials, or personal information. GitHub controls retention and removal of content hosted on its service.

For questions about these practices, use the [support page](../SUPPORT.md).
