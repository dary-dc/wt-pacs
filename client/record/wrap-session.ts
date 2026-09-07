/** Wrap a session so `delivered` (or a failure) stamps when public methods settle. */

import { getTap } from "./tap.ts";

type SessionLike = {
  requestExactFrame(frameIndex: number): Promise<unknown>;
  waitExactFrame(frameIndex: number, askMs: number): Promise<unknown>;
  startExactFrames(indices: ArrayLike<number>): number;
  requestExactFrames?(indices: ArrayLike<number>): Promise<unknown>;
};

async function settle<T>(frameIndex: number, p: Promise<T>, via: "single" | "batch" = "single"): Promise<T> {
  try {
    const result = await p;
    getTap()?.onDelivered(frameIndex, via);
    return result;
  } catch (e) {
    // A refusal already closed the row from the control stream; this then finds no open row
    // and is ignored. Timeouts and other rejections close it here.
    getTap()?.onAskFailed(frameIndex, e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export function wrapSession<T extends object & SessionLike>(session: T): T {
  const handler: ProxyHandler<T> = {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === "requestExactFrame") {
        return (frameIndex: number) => {
          getTap()?.gesture(frameIndex);
          return settle(frameIndex, target.requestExactFrame(frameIndex));
        };
      }
      if (prop === "waitExactFrame") {
        return (frameIndex: number, askMs: number) =>
          settle(frameIndex, target.waitExactFrame(frameIndex, askMs));
      }
      if (prop === "startExactFrames") {
        return (indices: ArrayLike<number>) => {
          getTap()?.gesture();
          return target.startExactFrames(indices);
        };
      }
      if (prop === "requestExactFrames" && typeof target.requestExactFrames === "function") {
        return async (indices: ArrayLike<number>) => {
          getTap()?.gesture();
          const list = Array.from(indices);
          try {
            const result = await target.requestExactFrames!(indices);
            // The whole batch has landed by now; rows say so rather than posing as per-frame.
            for (const i of list) getTap()?.onDelivered(i, "batch");
            return result;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            for (const i of list) getTap()?.onAskFailed(i, msg);
            throw e;
          }
        };
      }
      if (typeof v === "function") {
        return (v as (...a: unknown[]) => unknown).bind(target);
      }
      return v;
    },
    getPrototypeOf(t) {
      return Reflect.getPrototypeOf(t);
    },
  };
  return new Proxy(session, handler);
}
