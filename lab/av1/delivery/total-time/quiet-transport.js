/**
 * The product's transport, its silences told to the page (row ASKDEADLINE): each gap over 1 s between
 * bytes a session delivered, and how long it had been quiet when it closed. lab/av1/delivery/total-time/README.md
 */
import { TransportSession as Real } from "/client/transport/ts/dist/session.js";

const page = new BroadcastChannel("quiet");

export class TransportSession {
  static async connect(...args) {
    const s = await Real.connect(...args);
    let last = 0;
    const poll = setInterval(() => {
      const { closed, lastByteAt = 0 } = s.stats();
      if (closed) {
        clearInterval(poll);
        if (last) page.postMessage({ closedAfter: performance.now() - last });
        return;
      }
      if (lastByteAt === last) return;
      if (last && lastByteAt - last > 1000) page.postMessage({ survived: lastByteAt - last });
      last = lastByteAt;
    }, 20);
    return s;
  }
}
