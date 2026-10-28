/** Shared view contract. Storage and protocol details belong to each agent adapter. */
export interface SessionNode {
  id: string;
  agent: string;
  nativeId?: string | null;
  parentId?: string | null;
  title: string;
  workspace: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  archived?: boolean;
  missing?: boolean;
  subagent?: boolean;
}

export interface Snapshot {
  revision: string;
  nodes?: SessionNode[];
}

export interface SessionProvider {
  read(opening: boolean, sinceRevision?: string): Promise<Snapshot>;
  firstReply?(nativeId: string): Promise<FirstReply>;
  dispose(): void;
}

export interface FirstReply {
  status: 'available' | 'empty' | 'limited' | 'unavailable';
  text?: string;
  user?: string;
}

export interface Agent {
  id: string;
  label: string;
  create(): SessionProvider;
  open?(node: SessionNode): Promise<boolean>;
}

export interface GraphSnapshot {
  type: 'snapshot';
  selectedId: string | null;
  nodes: SessionNode[];
  locale: string;
  agentLabel: string;
  message?: string;
  labels: {
    title: string; listTitle: string; zoomIn: string; zoomOut: string; fit: string; locate: string;
    selected: string; archived: string; missing: string; origin: string; updated: string;
    firstReply: string; loadingReply: string; emptyReply: string; limitedReply: string; unavailableReply: string;
    user: string; emptyUser: string;
  };
}
