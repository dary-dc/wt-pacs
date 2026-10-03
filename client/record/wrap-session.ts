/** Wrap a session so `delivered` (or a failure) stamps when an ask settles or a fill frame lands. */

import { getTap } from "./tap.ts";

type Frame = { frameIndex: number };

type SessionLike = {
  requestExactFrame(frameIndex: number): Promise<unknown>;
  fillFrames?(
    from: number,
    to: number,
    onFrame: (f: Frame) => void,
    onError?: (frameIndex: number, reason: string) => void,
  ): number;
};

async function settle<T>(frameIndex: number, p: Promise<T>): Promise<T> {
  try {
    const result = await p;
    getTap()?.onDelivered(frameIndex);
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
      if (prop === "fillFrames" && typeof target.fillFrames === "function") {
        return (
          from: number,
          to: number,
          onFrame: (f: Frame) => void,
          onError: (frameIndex: number, reason: string) => void = () => {},
        ) => {
          getTap()?.gesture();
          return target.fillFrames!(
            from,
            to,
            (f) => {
              getTap()?.onDelivered(f.frameIndex);
              onFrame(f);
            },
            (i, reason) => {
              getTap()?.onAskFailed(i, reason);
              onError(i, reason);
            },
          );
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
