/** Proxy helpers — must forward getPrototypeOf so instanceof / dyn_into survive. */

import { getTap } from "./tap.ts";

function bindGet(target: object): ProxyHandler<object> {
  return {
    get(t, prop, _receiver) {
      // Use the real target as Reflect receiver so brand-checked accessors
      // (WebTransport.ready, etc.) are not invoked with the Proxy as `this`.
      const v = Reflect.get(t, prop, t);
      if (typeof v === "function") {
        return v.bind(t);
      }
      return v;
    },
    getPrototypeOf(t) {
      return Reflect.getPrototypeOf(t);
    },
    has(t, prop) {
      return Reflect.has(t, prop);
    },
    ownKeys(t) {
      return Reflect.ownKeys(t);
    },
    getOwnPropertyDescriptor(t, prop) {
      return Reflect.getOwnPropertyDescriptor(t, prop);
    },
  };
}

export function proxyWriter(writer: WritableStreamDefaultWriter<Uint8Array>) {
  const base = bindGet(writer);
  return new Proxy(writer, {
    ...base,
    get(t, prop, receiver) {
      if (prop === "write") {
        return (chunk: Uint8Array) => {
          const tap = getTap();
          if (tap && chunk) {
            const bytes =
              chunk instanceof Uint8Array
                ? chunk
                : new Uint8Array(chunk as ArrayBuffer);
            tap.onControlWrite(bytes);
          }
          const p = writer.write(chunk);
          return Promise.resolve(p).then((v) => {
            getTap()?.onAskFlush();
            return v;
          });
        };
      }
      return base.get!(t, prop, receiver);
    },
  });
}

export function proxyReader(reader: ReadableStreamDefaultReader<Uint8Array>, streamId: number) {
  const base = bindGet(reader);
  return new Proxy(reader, {
    ...base,
    get(t, prop, receiver) {
      if (prop === "read") {
        return () => {
          return reader.read().then((result) => {
            const tap = getTap();
            if (tap && result && !result.done && result.value) {
              const v = result.value;
              const bytes =
                v instanceof Uint8Array
                  ? v
                  : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
              tap.onMediaRead(streamId, bytes);
            }
            return result;
          });
        };
      }
      return base.get!(t, prop, receiver);
    },
  });
}

export function proxyMediaStream(stream: ReadableStream<Uint8Array>) {
  const tap = getTap();
  const streamId = tap ? tap.nextStreamId() : -1;
  const base = bindGet(stream);
  return new Proxy(stream, {
    ...base,
    get(t, prop, receiver) {
      if (prop === "getReader") {
        return (...args: unknown[]) => {
          const reader = (stream.getReader as (...a: unknown[]) => ReadableStreamDefaultReader)(
            ...args,
          );
          if (streamId < 0) return reader;
          return proxyReader(reader as ReadableStreamDefaultReader<Uint8Array>, streamId);
        };
      }
      return base.get!(t, prop, receiver);
    },
  });
}

export function proxyBidi(bidi: {
  readable: ReadableStream;
  writable: WritableStream;
}) {
  const base = bindGet(bidi as object);
  return new Proxy(bidi as object, {
    ...base,
    get(t, prop, receiver) {
      if (prop === "writable") {
        const writable = bidi.writable;
        return new Proxy(writable, {
          ...bindGet(writable),
          get(wt, wprop, wrecv) {
            if (wprop === "getWriter") {
              return () => proxyWriter(writable.getWriter());
            }
            return bindGet(writable).get!(wt, wprop, wrecv);
          },
        });
      }
      return base.get!(t, prop, receiver);
    },
  });
}

export function proxyIncomingUnis(incoming: ReadableStream<ReadableStream<Uint8Array>>) {
  const base = bindGet(incoming);
  return new Proxy(incoming, {
    ...base,
    get(t, prop, receiver) {
      if (prop === "getReader") {
        return (...args: unknown[]) => {
          const reader = (
            incoming.getReader as (...a: unknown[]) => ReadableStreamDefaultReader
          )(...args);
          const rbase = bindGet(reader);
          return new Proxy(reader, {
            ...rbase,
            get(rt, rprop, rrecv) {
              if (rprop === "read") {
                return () =>
                  reader.read().then((result) => {
                    if (result && !result.done && result.value) {
                      return {
                        ...result,
                        value: proxyMediaStream(
                          result.value as ReadableStream<Uint8Array>,
                        ),
                      };
                    }
                    return result;
                  });
              }
              return rbase.get!(rt, rprop, rrecv);
            },
          });
        };
      }
      // Also support async iteration if used
      return base.get!(t, prop, receiver);
    },
  });
}

export function proxyTransport(transport: WebTransport) {
  const base = bindGet(transport as unknown as object);
  return new Proxy(transport as unknown as object, {
    ...base,
    get(t, prop, receiver) {
      if (prop === "createBidirectionalStream") {
        return (...args: unknown[]) => {
          const p = (
            transport.createBidirectionalStream as (...a: unknown[]) => Promise<unknown>
          )(...args);
          return Promise.resolve(p).then((bidi) =>
            proxyBidi(bidi as { readable: ReadableStream; writable: WritableStream }),
          );
        };
      }
      if (prop === "incomingUnidirectionalStreams") {
        return proxyIncomingUnis(
          transport.incomingUnidirectionalStreams as ReadableStream<
            ReadableStream<Uint8Array>
          >,
        );
      }
      return base.get!(t, prop, receiver);
    },
  }) as unknown as WebTransport;
}
