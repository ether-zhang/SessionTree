import { createIndex, selectFamily } from '../../core/tree.mjs';
import { HermesAdapter, hermesScope } from '../../adapters/hermes.mjs';
import { visibleConversations } from '../shared/conversation-view.mjs';

const sameOwner = (a, b) => a.connectionId === b.connectionId && a.profile === b.profile;

/** Hermes-owned context and actions translated to the shared panel's small host contract. */
export class HermesTreeHost {
  constructor({ readContext, readSessions, openSession, readAppearance = () => ({}) }) {
    this.readContext = readContext; this.readSessions = readSessions;
    this.navigate = openSession; this.readAppearance = readAppearance; this.listeners = new Map();
  }
  context() {
    const value = this.readContext();
    return { ...hermesScope(value), sessionId: value.sessionId || null };
  }
  adapterFor(context) {
    if (!this.adapter || !sameOwner(this.adapter.scope, context)) {
      this.adapter = new HermesAdapter({ ...context, readSessions: this.readSessions });
      this.index = null;
    }
    return this.adapter;
  }
  on(event, callback) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }
  emit(event, value) { for (const callback of this.listeners.get(event) || []) callback(value); }
  contextChanged() { this.emit('contextchange', {}); }
  appearanceChanged() { this.emit('contextchange', this.readAppearance()); }
  invalidate() { this.adapter?.invalidate(); }
  initialize() { return Promise.resolve({ hostContext: this.readAppearance() }); }
  async loadPanel({ refresh = false, selectedNodeId } = {}) {
    const before = this.context(), adapter = this.adapterFor(before);
    const result = await adapter.scan({ force: refresh });
    const after = this.context();
    if (adapter !== this.adapter || !sameOwner(before, after) || before.sessionId !== after.sessionId) throw new Error('Hermes session changed while loading.');
    if (!this.index || !result.unchanged) this.index = createIndex(result.records, { issues: result.issues });
    const index = visibleConversations(this.index);
    const mode = before.sessionId ? 'current' : selectedNodeId ? 'selected' : 'choose';
    const currentId = before.sessionId ? adapter.resolveId(before.sessionId) : selectedNodeId;
    if (selectedNodeId && before.sessionId && selectedNodeId !== currentId) throw new Error('Hermes session changed while selecting.');
    if (selectedNodeId && !index.nodes.some(node => node.id === selectedNodeId)) throw new Error('Hermes session is not in this owner index.');
    return {
      version: 1, mode, nativeId: before.sessionId || index.nodes.find(node => node.id === currentId)?.nativeId || null,
      revision: adapter.revision + ':' + (currentId || 'choose'),
      index: currentId ? selectFamily(index, currentId) : index,
    };
  }
  canOpen(node) {
    if (!node || node.agent !== 'hermes' || node.missing || node.archived || !node.navigation) return false;
    const current = this.context();
    return sameOwner(node.navigation, current) &&
      this.adapter?.result?.records.some(record => record.id === node.id && record.nativeId === node.nativeId);
  }
  async openNode(node) {
    const current = this.adapter?.result?.records.find(record => record.id === node?.id);
    if (!current || !this.canOpen(current)) throw new Error('This Hermes session cannot be opened from the current owner.');
    await this.navigate({ ...current.navigation });
  }
  describeError(error) { return error.message; }
  close() { this.listeners.clear(); this.adapter = null; this.index = null; }
}
