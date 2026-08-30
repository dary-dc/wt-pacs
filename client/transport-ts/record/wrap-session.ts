/** Wrap a session so `delivered` stamps when public methods return. */

import { getTap } from "./tap.ts";

type SessionLike = {
  requestExactFrame(frameIndex: number): Promise<unknown>;
  waitExactFrame(frameIndex: number, askMs: number): Promise<unknown>;
  startExactFrames(indices: ArrayLike<number>): number;
  requestExactFrames?(indices: ArrayLike<number>): Promise<unknown>;
  [k: string]: unknown;
};

export function wrapSession<T extends SessionLike>(session: T): T {
  const handler: ProxyHandler<T> = {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (prop === "requestExactFrame") {
        return async (frameIndex: number) => {
          getTap()?.gesture(frameIndex);
          const result = await target.requestExactFrame(frameIndex);
          getTap()?.onDelivered(frameIndex);
          return result;
        };
      }
      if (prop === "waitExactFrame") {
        return async (frameIndex: number, askMs: number) => {
          const result = await target.waitExactFrame(frameIndex, askMs);
          getTap()?.onDelivered(frameIndex);
          return result;
        };
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
          const result = await target.requestExactFrames!(indices);
          const list = Array.from(indices);
          for (const i of list) getTap()?.onDelivered(i);
          return result;
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
