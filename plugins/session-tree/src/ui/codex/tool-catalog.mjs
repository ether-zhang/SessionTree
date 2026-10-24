import { BUTTON_URI, PANEL_URI, ICON_DATA_URI } from './resource.mjs';

const emptySchema = { type: 'object', properties: {}, additionalProperties: false };
const annotations = readOnlyHint => ({ readOnlyHint, destructiveHint: false, openWorldHint: false });
const treeIcons = [{ src: ICON_DATA_URI, mimeType: 'image/svg+xml' }];
export const tools = [
  { name: 'open_session_tree_button', title: '本对话会话树',
    description: 'Native conversation-panel action. A user click opens this conversation’s own tree directly, with no chat message or model call.',
    inputSchema: emptySchema, annotations: annotations(true),
    icons: treeIcons,
    _meta: { ui: { resourceUri: BUTTON_URI, visibility: ['app'] },
      'openai/ui': { entrypoints: [{ type: 'thread' }] } } },
  { name: 'open_session_tree_panel', title: '会话树',
    icons: treeIcons,
    description: 'Compatibility helper for explicitly requested assistant-driven display. It is not the normal user entrypoint; the normal entrypoint is the native open_session_tree_button action. Uses the host thread ID, never a remembered ID or project path.',
    inputSchema: emptySchema, annotations: annotations(true),
    _meta: { ui: { resourceUri: PANEL_URI, visibility: ['model', 'app'] },
      'openai/ui': { preferredModelDisplayMode: 'fullscreen' } } },
  { name: 'open_session_tree_file', title: '会话树',
    icons: treeIcons,
    description: 'Official file viewer for a .sessiontree shortcut. Opens the current conversation tree; never reads a filesystem path from tool arguments.',
    inputSchema: { type: 'object', properties: { file: {
      type: 'object', properties: {
        name: { type: 'string', maxLength: 240, pattern: '^[^/\\\\\\u0000]+\\.sessiontree$' },
        resourceUri: { type: 'string', minLength: 1, maxLength: 4096 },
      }, required: ['name', 'resourceUri'], additionalProperties: false,
    } }, required: ['file'], additionalProperties: false },
    annotations: annotations(false),
    _meta: { ui: { resourceUri: PANEL_URI, visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'file', extensions: ['.sessiontree'] }] } } },
  { name: 'session_tree_panel_data', title: '读取对话面板中的会话树',
    description: 'Use the host-provided current thread ID. If unavailable, require explicit user selection instead of guessing.',
    inputSchema: { type: 'object', properties: {
      refresh: { type: 'boolean' },
      since_revision: { type: 'string', maxLength: 128 },
      current_thread_id: { type: 'string', maxLength: 36, pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
    }, additionalProperties: false },
    annotations: annotations(false), _meta: { ui: { visibility: ['app'] } } },
  { name: 'session_tree_family', title: '读取当前对话所属的树',
    description: 'UI-only family lookup for an exact current Codex thread ID supplied by the client. Never infers the active thread from recency or title.',
    inputSchema: { type: 'object', properties: {
      current_thread_id: { type: 'string', maxLength: 36, pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' },
      refresh: { type: 'boolean' },
    }, required: ['current_thread_id'], additionalProperties: false },
    annotations: annotations(false), _meta: { ui: { visibility: ['app'] } } },
  { name: 'refresh_session_tree', title: 'Refresh session index',
    description: 'Rebuild the plugin-owned session tree index from local Codex metadata. Does not change original conversations.',
    inputSchema: emptySchema, annotations: annotations(false) },
  { name: 'get_session_tree', title: 'Find sessions',
    description: 'Search the saved SessionTree index by title, workspace or native ID; results retain parent IDs. If no index exists, first call refresh_session_tree or open_session_tree_panel.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 300 },
      include_archived: { type: 'boolean' }, include_subagents: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 50 } }, additionalProperties: false }, annotations: annotations(true) },
];
