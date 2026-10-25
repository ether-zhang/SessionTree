export interface SessionNode {
  id: string;
  nativeId?: string;
  agent: string;
  parentId?: string | null;
  title: string;
  workspace?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  openUrl?: string;
  missing?: boolean;
  archived?: boolean;
  subagent?: boolean;
  contextOnly?: boolean;
  latestMessages?: { user?: string | null; assistant?: string | null };
  latestMessage?: { role: string; text: string } | null;
  previewStatus?: Record<string, string>;
}

export interface SessionIndex {
  version: number;
  nodes: SessionNode[];
  currentId?: string;
  rootId?: string;
  issues: Array<Record<string, unknown>>;
}

export interface Panel {
  version: number;
  mode: 'current' | 'selected' | 'choose';
  nativeId: string | null;
  revision?: string;
  index: SessionIndex;
}

export interface HostContext {
  theme?: string;
  locale?: string;
  [key: string]: unknown;
}

export interface LoadOptions { refresh?: boolean; background?: boolean; context?: boolean; opening?: boolean }
export interface Bridge {
  closed?: boolean;
  locale?: string;
  initialize(): Promise<{ hostContext?: HostContext }>;
  loadPanel(options?: { refresh?: boolean; currentThreadId?: string; check?: boolean }): Promise<Panel>;
  openThread(url: string): Promise<unknown>;
  on(method: string, callback: (context: HostContext) => void): () => unknown;
  close(): void;
}

export interface PositionedNode {
  node: SessionNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  hasChildren: boolean;
  folded: boolean;
}
export interface Edge { from: string; to: string; x1: number; y1: number; x2: number; y2: number }
export interface Geometry { nodes: PositionedNode[]; edges: Edge[]; width: number; height: number }
export interface View { x: number; y: number; scale: number }

declare global {
  interface Window { openai?: { locale?: string } }
}
