// Shows new dice rolls one after another. Rolls already in the log when the page opened are skipped.
import type { Message, RollData } from "../../shared/types";

export class DiceQueue {
  current = $state<RollData | null>(null);
  private queue: RollData[] = [];
  private lastSeen: number | null = null;

  constructor(private wants: (roll: RollData) => boolean) {}

  feed(log: Message[]) {
    const rolls = log.filter((m) => m.roll);
    const maxId = log.at(-1)?.id ?? 0;
    if (this.lastSeen === null) {
      this.lastSeen = maxId;
      return;
    }
    for (const m of rolls) if (m.id > this.lastSeen && this.wants(m.roll!)) this.queue.push(m.roll!);
    this.lastSeen = Math.max(this.lastSeen, maxId);
    if (!this.current) this.next();
  }

  next = () => {
    this.current = this.queue.shift() ?? null;
  };
}
