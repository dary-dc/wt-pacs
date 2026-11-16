// SESSION in the downloader (report-plan.md §3.3): one bidirectional stream per record, the record then FIN, and
// the record held until the server answers one byte, across the sessions that replace a dead or recycled one.
const encoder = new TextEncoder();

/** True once the server's byte arrives; false if the stream ends or fails without it. */
export async function write(wt, body) {
  try {
    const s = await wt.createBidirectionalStream();
    const w = s.writable.getWriter();
    await w.write(encoder.encode(body));
    await w.close();
    const { value } = await s.readable.getReader().read();
    return value?.length > 0;
  } catch {
    return false;
  }
}

export class Reports {
  /** body → the session it is in flight on, or null while it waits for one. */
  held = new Map();
  #current = null;

  /** Every WebTransport the downloader makes; the newest that opens carries what is held. */
  adopt(wt) {
    wt.ready.then(() => {
      this.#current = wt;
      for (const [body, on] of this.held) if (!on) this.#write(body);
    }, () => {});
    wt.closed.then(() => this.#gone(wt), () => this.#gone(wt));
  }

  send(body) {
    if (this.held.has(body)) return;
    this.held.set(body, null);
    this.#write(body);
  }

  #gone(wt) { if (this.#current === wt) this.#current = null; }

  #write(body) {
    const wt = this.#current;
    if (!wt) return;
    this.held.set(body, wt);
    write(wt, body).then((ok) => {
      if (ok) return void this.held.delete(body);
      this.held.set(body, null);
      if (this.#current && this.#current !== wt) this.#write(body);
    });
  }
}
