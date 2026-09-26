// The product session, run inside a module Worker. Frames cross as transferable buffers, so
// the boundary is a move and not a copy. Lab only — the product's worker shape is
// `docs/ARCHITECTURE.md` on the client branch. Measurement: `docs/CLIENTS.md`.
import { TransportSession } from "/client/transport-ts/dist/session.js";

let session = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.t === "connect") {
      session = await TransportSession.connect(m.url, m.hash, m.opts || {});
      self.postMessage({ t: "ready", id: m.id });
    } else if (m.t === "ask") {
      const r = await session.requestExactFrame(m.frame);
      self.postMessage({ t: "frame", id: m.id, frameIndex: r.frameIndex, bytes: r.bytes },
                       [r.bytes.buffer]);
    } else if (m.t === "close") {
      session.close();
      self.postMessage({ t: "closed", id: m.id });
    }
  } catch (err) {
    self.postMessage({ t: "err", id: m.id, message: String((err && err.message) || err) });
  }
};
