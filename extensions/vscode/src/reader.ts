import { FirstReply, SessionProvider, Snapshot } from './types';

/** Only the host's visibility/focus events may activate this reader. No watchers. */
export class VisibleReader {
  private active = false;
  private generation = 0;
  private provider?: SessionProvider;
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private again = false;
  private revision?: string;

  constructor(private readonly options: {
    create(): SessionProvider;
    accept(snapshot: Snapshot): void;
    error(error: unknown): void;
    intervalMs?: number;
  }) {}

  setActive(active: boolean): void {
    if (active === this.active) return;
    this.stop();
    this.active = active;
    if (active) void this.refresh(true);
  }

  async refresh(opening = true): Promise<void> {
    if (!this.active) return;
    if (this.busy) { this.again ||= opening; return; }
    clearTimeout(this.timer);
    const generation = this.generation;
    this.busy = true;
    try {
      this.provider ??= this.options.create();
      const snapshot = await this.provider.read(opening, this.revision);
      if (generation !== this.generation) return;
      this.revision = snapshot.revision;
      this.options.accept(snapshot);
    } catch (error) {
      if (generation === this.generation) {
        this.provider?.dispose();
        this.provider = undefined;
        this.revision = undefined;
        this.options.error(error);
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        if (this.active) {
          const again = this.again;
          this.again = false;
          this.timer = setTimeout(() => void this.refresh(again), again ? 0 : this.options.intervalMs ?? 30000);
        }
      }
    }
  }

  async firstReply(nativeId: string): Promise<FirstReply> {
    if (!this.active || !this.provider?.firstReply) return { status: 'unavailable' };
    const generation = this.generation;
    try {
      const result = await this.provider.firstReply(nativeId);
      return this.active && generation === this.generation ? result : { status: 'unavailable' };
    } catch { return { status: 'unavailable' }; }
  }

  private stop(): void {
    ++this.generation;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.provider?.dispose();
    this.provider = undefined;
    this.busy = false;
    this.again = false;
    // A new backend cannot answer "unchanged" before it has returned a snapshot.
    this.revision = undefined;
  }

  dispose(): void { this.active = false; this.stop(); }
}
