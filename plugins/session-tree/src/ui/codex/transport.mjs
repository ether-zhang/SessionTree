/** Host-managed MCP Apps transport; standalone HTTP is only a development harness. */
export function dataLoadError(error) {
  return /Transport closed/i.test(error.message)
    ? '插件连接已关闭，Codex 尚未重新连接。若刷新仍失败，请完全退出 Codex 后重新打开，再打开会话树。'
    : error.message;
}

export class AppBridge {
  constructor(viewWindow, { timeoutMs = 15000, initialResultTimeoutMs = 300, displayModes = ['inline', 'fullscreen'] } = {}) {
    this.window = viewWindow;
    this.timeoutMs = timeoutMs;
    this.initialResultTimeoutMs = initialResultTimeoutMs;
    this.displayModes = displayModes;
    this.openingResultConsumed = false;
    this.pending = new Map();
    this.notifications = new Map();
    this.nextId = 1;
    this.listener = event => {
      if (event.source !== viewWindow.parent || event.data?.jsonrpc !== '2.0') return;
      const message = event.data;
      if (this.pending.has(message.id)) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
      } else if (message.method === 'ping' && message.id !== undefined) {
        this.post({ id: message.id, result: {} });
      } else if (message.method === 'ui/resource-teardown' && message.id !== undefined) {
        this.post({ id: message.id, result: {} });
        this.close();
      } else if (message.id === undefined) {
        for (const callback of this.notifications.get(message.method) || []) callback(message.params);
      }
    };
    viewWindow.addEventListener('message', this.listener);
    // Entrypoints already return the data needed to render their first view.
    // Register before initialize so the host's initial result cannot be missed.
    this.on('ui/notifications/tool-result', result => { this.openingResult ??= { value: result }; });
    this.on('ui/notifications/host-context-changed', () => this.discardOpeningResult());
  }
  on(method, callback) {
    if (!this.notifications.has(method)) this.notifications.set(method, new Set());
    this.notifications.get(method).add(callback);
    return () => this.notifications.get(method)?.delete(callback);
  }
  post(message) { this.window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*'); }
  request(method, params) {
    if (this.closed) return Promise.reject(new Error('会话树界面已关闭'));
    const id = `session-tree-${this.nextId++}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`客户端请求超时：${method}`)); }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.post({ id, method, params });
    });
  }
  initialize() {
    this.ready ??= this.request('ui/initialize', {
      protocolVersion: '2026-01-26', appInfo: { name: 'SessionTree', version: '0.5.8' },
      appCapabilities: { availableDisplayModes: this.displayModes },
    }).then(context => {
      this.post({ method: 'ui/notifications/initialized' });
      return context;
    });
    return this.ready;
  }
  async takeOpeningResult() {
    if (this.openingResultConsumed || this.closed) return;
    this.openingResultConsumed = true;
    if (this.openingResult) return this.openingResult.value;
    return new Promise(resolve => {
      const finish = value => {
        clearTimeout(timer);
        off();
        this.cancelOpeningWait = undefined;
        resolve(value);
      };
      const off = this.on('ui/notifications/tool-result', finish);
      const timer = setTimeout(() => finish(undefined), this.initialResultTimeoutMs);
      this.cancelOpeningWait = () => finish(undefined);
    });
  }
  discardOpeningResult() {
    this.openingResultConsumed = true;
    this.openingResult = undefined;
    this.cancelOpeningWait?.();
  }
  async loadPanel({ refresh = false, currentThreadId, check = false } = {}) {
    await this.initialize();
    const args = { refresh };
    if (currentThreadId) args.current_thread_id = currentThreadId;
    if (!refresh && !check && this.panel?.revision) args.since_revision = this.panel.revision;
    if (refresh || currentThreadId) this.discardOpeningResult();
    const result = await this.takeOpeningResult() ?? await this.request('tools/call', { name: 'session_tree_panel_data', arguments: args });
    if (typeof result._meta?.locale === 'string') this.locale = result._meta.locale;
    if (result.isError) throw new Error(result.content?.[0]?.text || '客户端无法读取会话树');
    const unchanged = result._meta?.sessionTreeUnchanged;
    if (unchanged) {
      if (this.panel?.revision !== unchanged.revision || this.panel.nativeId !== unchanged.nativeId ||
          this.panel.mode !== unchanged.mode) throw new Error('当前对话已经变化，请重新载入。');
      return this.panel;
    }
    const panel = result._meta?.sessionTreePanel;
    if (panel?.version !== 1 || !['current', 'selected', 'choose'].includes(panel.mode) ||
        panel.index?.version !== 1 || !Array.isArray(panel.index.nodes)) throw new Error('客户端未返回有效的面板数据');
    this.panel = panel;
    return panel;
  }
  async openThread(url) {
    if (!/^codex:\/\/threads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(url)) throw new Error('无效的 Codex 会话链接。');
    await this.initialize();
    const result = await this.request('ui/open-link', { url });
    if (result?.isError) throw new Error(result.message || '客户端未能打开会话。');
    return result;
  }
  close() {
    this.closed = true;
    this.discardOpeningResult();
    this.window.removeEventListener('message', this.listener);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('会话树界面已关闭')); }
    this.pending.clear();
    this.notifications.clear();
  }
}

