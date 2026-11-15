/** Batches "seen" listing ids and flushes them periodically (and on page hide). */
export class SeenBatcher {
  private pending = new Set<number>();
  private sent = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private send: (ids: number[]) => Promise<unknown>,
    private delayMs = 4000,
  ) {}

  add(id: number): void {
    if (this.sent.has(id) || this.pending.has(id)) return;
    this.pending.add(id);
    if (!this.timer) this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const ids = [...this.pending];
    this.pending.clear();
    ids.forEach((i) => this.sent.add(i));
    try {
      await this.send(ids);
    } catch {
      ids.forEach((i) => {
        this.sent.delete(i);
        this.pending.add(i);
      });
    }
  }
}
