/**
 * Outstanding-ask window for on-demand asks: the smallest depth that saturates the link.
 * `docs/adr-client-window-depth.md`; the estimator is `docs/lanes/L2-ask-policy.md`'s.
 */

export type AskWindow = { depth: number } | { depth: "auto"; initial?: number };

const UTILISATION = 0.95;
const SAMPLES = 8;
const MIN_DEPTH = 1;
const MAX_DEPTH = 16;

export class Window {
  private depth: number;
  private readonly auto: boolean;
  private readonly queue: Array<() => void> = [];
  private outstanding = 0;
  private readonly inFlight = new Set<number>();
  private readonly arrivals: number[] = [];
  private completed = 0;
  private proposed: number | null = null;

  constructor(
    cfg: AskWindow,
    private readonly smoothedRtt: () => Promise<number | undefined>,
  ) {
    this.auto = cfg.depth === "auto";
    const initial = cfg.depth === "auto" ? (cfg.initial ?? 2) : cfg.depth;
    this.depth = clamp(Math.floor(initial));
  }

  current(): number {
    return this.depth;
  }

  /** Queue `send`; it runs when fewer than `depth` asks are outstanding, in ask order. */
  ask(frameIndex: number, send: () => void): void {
    this.queue.push(() => {
      this.inFlight.add(frameIndex);
      send();
    });
    this.pump();
  }

  /** The frame arrived (or was refused, `bytes` 0): free its slot and feed the estimator. */
  done(frameIndex: number, bytes: number, receivedMs: number): void {
    if (!this.inFlight.delete(frameIndex)) return;
    this.outstanding -= 1;
    if (bytes > 0) {
      this.arrivals.push(receivedMs);
      if (this.arrivals.length > SAMPLES) this.arrivals.shift();
      this.completed += 1;
      if (this.auto && this.completed % SAMPLES === 0 && this.arrivals.length === SAMPLES) {
        void this.evaluate();
      }
    }
    this.pump();
  }

  private pump(): void {
    while (this.outstanding < this.depth && this.queue.length > 0) {
      this.outstanding += 1;
      this.queue.shift()!();
    }
  }

  // Ask-to-receive time is not an RTT once asks queue behind each other, so without the
  // transport's own estimate the depth stays where it is. Tf is the time between arrivals:
  // the link's per-frame time once the depth saturates it, the delivered pace below that.
  private async evaluate(): Promise<void> {
    const rtt = await this.smoothedRtt();
    if (rtt === undefined) return;
    const tf = median(this.arrivals.slice(1).map((t, i) => t - this.arrivals[i]));
    if (!(tf > 0) || !(rtt >= 0)) return;
    const d = clamp(Math.ceil(UTILISATION * (1 + rtt / tf)));
    if (d === this.depth) {
      this.proposed = null;
    } else if (this.proposed === d) {
      this.depth = d;
      this.proposed = null;
      this.pump();
    } else {
      this.proposed = d;
    }
  }
}

function clamp(d: number): number {
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, d));
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}
