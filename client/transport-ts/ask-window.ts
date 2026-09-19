/**
 * Outstanding-ask window for on-demand asks: the smallest depth that saturates the link.
 * `docs/adr-client-window-depth.md`; the estimator is `docs/lanes/L2-ask-policy.md`'s.
 */

export type AskWindowConfig = { depth: number } | { depth: "auto"; initial?: number };

const UTILISATION = 0.95;
const SAMPLES = 8;
const MIN_DEPTH = 1;
const MAX_DEPTH = 16;
const IDLE_TRIPS = 4;

export class AskWindow {
  private depth: number;
  private readonly auto: boolean;
  private readonly queue: Array<() => void> = [];
  private outstanding = 0;
  private readonly inFlight = new Map<number, { sentMs: number; idle: boolean }>();
  private readonly arrivals: number[] = [];
  private readonly idleTrips: number[] = [];
  private completed = 0;
  private proposed: number | null = null;

  constructor(
    cfg: AskWindowConfig,
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
      this.inFlight.set(frameIndex, { sentMs: performance.now(), idle: this.outstanding === 1 });
      send();
    });
    this.pump();
  }

  /** The frame arrived (or was refused, `bytes` 0): free its slot and feed the estimator. */
  done(frameIndex: number, bytes: number, receivedMs: number): void {
    const sent = this.inFlight.get(frameIndex);
    if (!sent) return;
    this.inFlight.delete(frameIndex);
    this.outstanding -= 1;
    if (bytes > 0) {
      this.arrivals.push(receivedMs);
      if (this.arrivals.length > SAMPLES) this.arrivals.shift();
      if (sent.idle) {
        this.idleTrips.push(receivedMs - sent.sentMs);
        if (this.idleTrips.length > IDLE_TRIPS) this.idleTrips.shift();
      }
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

  // Tf is the time between arrivals: the link's per-frame time once the depth saturates it,
  // the delivered pace below that. An ask queued behind others reads RTT + D·Tf, so without
  // the transport's RTT only asks sent into an idle window count: their trip is RTT + Tf, and
  // noise only inflates it, so the smallest wins — of at least two, since a session's first
  // ask alone carries its warm-up.
  private async evaluate(): Promise<void> {
    const tf = median(this.arrivals.slice(1).map((t, i) => t - this.arrivals[i]));
    const idle = this.idleTrips.length >= 2 ? Math.min(...this.idleTrips) - tf : undefined;
    const rtt = (await this.smoothedRtt()) ?? idle;
    if (rtt === undefined || !(tf > 0)) return;
    const d = clamp(Math.ceil(UTILISATION * (1 + Math.max(0, rtt) / tf)));
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
