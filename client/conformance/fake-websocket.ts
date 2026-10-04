/**
 * A WebSocket stand-in on the global scope, driven the way fake-transport.ts drives WebTransport.
 * It speaks ws-session.ts's wire: binary messages whose bytes, joined, are the media stream's;
 * a text message is one FoD message's JSON. One connection is one ordered stream, so a frame cut
 * short can only be the connection closing mid-frame.
 */
import type { FodMsg } from "../transport-ts/wire.ts";
import { frameBytes } from "./fake-transport.ts";

type Handler<E> = ((e: E) => void) | null;

export class FakeWebSocket {
  static last: FakeWebSocket;
  static dials = 0;
  static failNext = 0;
  static hangNext = 0;
  /** ms before the next dials open: a slower path, for racing it against the other. */
  static openAfterMs = 0;
  static all: FakeWebSocket[] = [];
  binaryType = "blob";
  readyState = 0;
  readonly sent: string[] = [];
  didClose = false;
  onopen: Handler<Event> = null;
  onmessage: Handler<{ data: string | ArrayBuffer }> = null;
  onclose: Handler<{ code: number; reason: string }> = null;
  onerror: Handler<Event> = null;

  constructor(readonly url: string) {
    const refuse = FakeWebSocket.failNext > 0;
    if (refuse) FakeWebSocket.failNext -= 1;
    const hang = !refuse && FakeWebSocket.hangNext > 0;
    if (hang) FakeWebSocket.hangNext -= 1;
    if (refuse) setTimeout(() => this.ended(1006, ""), 0);
    else if (!hang) setTimeout(() => this.opened(), FakeWebSocket.openAfterMs);
    FakeWebSocket.last = this;
    FakeWebSocket.all.push(this);
    FakeWebSocket.dials += 1;
  }

  private opened() {
    if (this.readyState !== 0) return;
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  private ended(code: number, reason: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  send(data: string) {
    if (this.readyState === 0) throw new Error("InvalidStateError: still connecting");
    if (this.readyState === 1) this.sent.push(data);
  }

  /** As a browser does, a close while connecting fails the dial with 1006. */
  close(code = 1000, reason = "") {
    this.didClose = true;
    const connecting = this.readyState === 0;
    if (this.readyState < 2) this.readyState = 2;
    setTimeout(() => this.ended(connecting ? 1006 : code, reason), 0);
  }

  serverClose(closeCode = 1000, reason = "server closed the session") {
    this.didClose = true;
    this.ended(closeCode, reason);
  }

  private binary(bytes: Uint8Array) {
    if (this.readyState === 1) this.onmessage?.({ data: bytes.slice().buffer });
  }

  pushRefusal(index: number, reason: string) {
    if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify({ op: "frame_error", frame_index: index, reason }) });
  }

  pushFrame(index: number, codestream: Uint8Array) {
    this.binary(frameBytes(index, codestream));
  }

  /** Several frames in one message: a message boundary is not a frame boundary. */
  pushOnOneStream(frames: [number, Uint8Array][]) {
    const parts = frames.map(([i, c]) => frameBytes(i, c));
    const merged = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      merged.set(p, at);
      at += p.length;
    }
    this.binary(merged);
  }

  trickleFrame(index: number, codestream: Uint8Array, chunks: number, everyMs: number) {
    const whole = frameBytes(index, codestream);
    const per = Math.ceil(whole.length / chunks);
    let at = 0;
    const next = () => {
      if (at >= whole.length) return;
      this.binary(whole.slice(at, (at += per)));
      setTimeout(next, everyMs);
    };
    next();
  }

  /** The only way TCP cuts a frame short: the connection ends inside it. */
  pushTruncatedFrame(index: number, codestream: Uint8Array, sent: number) {
    this.binary(frameBytes(index, codestream).slice(0, 8 + sent));
    this.serverClose(1006, "");
  }

  controlMessages(): FodMsg[] {
    return this.sent.map((s) => JSON.parse(s) as FodMsg);
  }
}

export function installFakeWebSocket() {
  (globalThis as Record<string, unknown>).WebSocket = FakeWebSocket;
}
