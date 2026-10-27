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
  dispose(): void;
}

export interface Agent {
  id: string;
  label: string;
  create(): SessionProvider;
}
