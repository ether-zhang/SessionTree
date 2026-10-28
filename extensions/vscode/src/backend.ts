import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';

type Pending = { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };

/** Private local transport to the existing Rust reader; no model or network calls. */
export class BackendClient {
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, Pending>();
  private nextId = 0;
  private output = '';
  private stderr = '';
  private closed = false;

  constructor(binary: string, home: string, data: string) {
    this.child = spawn(binary, ['mcp', '--track-activity', '--codex-home', home, '--data-dir', data], {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => this.receive(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-4000); });
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', () => this.fail(new Error(this.stderr.trim() || 'The session reader stopped.')));
    this.child.stdin.on('error', error => this.fail(error));
  }

  async initialize(): Promise<void> {
    await this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'session-tree-vscode', version: '0.1.5' } });
    this.child?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  }

  request(method: string, params: unknown): Promise<any> {
    if (this.closed) return Promise.reject(new Error('The session reader is closed.'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('The session reader timed out.')), 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  private receive(chunk: string): void {
    this.output += chunk;
    if (this.output.length > 32 * 1024 * 1024) { this.fail(new Error('Session metadata exceeds the response limit.')); return; }
    let newline: number;
    while ((newline = this.output.indexOf('\n')) !== -1) {
      const line = this.output.slice(0, newline);
      this.output = this.output.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
        const pending = this.pending.get(response.id);
        if (!pending) continue;
        this.pending.delete(response.id);
        clearTimeout(pending.timer);
        if (response.error) pending.reject(new Error(String(response.error.message)));
        else pending.resolve(response.result);
      } catch { this.fail(new Error('The session reader returned invalid metadata.')); return; }
    }
  }

  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    this.child?.kill();
    this.child = undefined;
    this.output = '';
  }

  dispose(): void { this.fail(new Error('The session tree is hidden or closed.')); }
}
