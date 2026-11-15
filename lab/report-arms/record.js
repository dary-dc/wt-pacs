// The records every carrier arm sends, built where the values are and serialized there: report-plan.md §3, §7.1.
const SCHEMA = 1;
const id = () => crypto.randomUUID().replaceAll("-", "");

export class Load {
  #ctx;
  #seq = 0;
  #frames = [];
  #routes = {};
  #checks = {};
  #presses = [];
  #labels = [];
  #errors = [];
  #sent = { presses: 0, labels: 0, errors: 0, received: 0, checks: "{}" };
  fill = { fillFrom: null, fillTo: null, fillMs: null };

  constructor(ctx) {
    this.#ctx = ctx;
  }

  frame(f) {
    this.#frames.push(f);
    this.#routes[f.route] = (this.#routes[f.route] ?? 0) + 1;
  }

  check(route, exact) {
    const c = (this.#checks[route] ??= { checked: 0, failed: 0 });
    c.checked++;
    if (!exact) c.failed++;
  }

  press(p) { this.#presses.push(p); }
  label(l) { this.#labels.push(l); }
  error(e) { this.#errors.push(e); }

  #base() {
    const { load, session, build, codec, source, frameCount } = this.#ctx;
    return { v: SCHEMA, kind: "load", reportId: id(), load, session, build, seq: this.#seq++, codec, source, frameCount,
             received: this.#frames.length };
  }

  #mark() {
    this.#sent = { presses: this.#presses.length, labels: this.#labels.length, errors: this.#errors.length,
                   received: this.#frames.length, checks: JSON.stringify(this.#checks) };
  }

  /** The whole record: the fill's send, or the only one at hidden. */
  record() {
    const r = { ...this.#base(), routes: this.#routes, checks: this.#checks, frames: this.#frames, ...this.fill,
                presses: this.#presses, labels: this.#labels, errors: this.#errors };
    this.#mark();
    return r;
  }

  /** What changed since the last send, or `null` when nothing did. */
  delta() {
    const s = this.#sent;
    const changed = this.#presses.length > s.presses || this.#labels.length > s.labels ||
      this.#errors.length > s.errors || this.#frames.length > s.received || JSON.stringify(this.#checks) !== s.checks;
    if (!changed) return null;
    const r = { ...this.#base(), routes: this.#routes, checks: this.#checks, ...this.fill,
                presses: this.#presses.slice(s.presses), labels: this.#labels.slice(s.labels),
                errors: this.#errors.slice(s.errors) };
    this.#mark();
    return r;
  }
}

/** One failed check, sent at once whatever the rate: exactness-in-production.md §5, amendment 9's fields. */
export function safetyRecord({ load, session, build, source, codec }, failure, env) {
  const { frame, route, codecString = null, check, expected, actual, secondDecode, followed, at } = failure;
  return { v: SCHEMA, kind: "safety", reportId: id(), load, session, build, at, source, frame, codec, route,
           codecString, engine: env.engine, hardwareConcurrency: env.hardwareConcurrency, check, expected, actual,
           secondDecode, followed };
}
