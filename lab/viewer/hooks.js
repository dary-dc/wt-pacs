/** The page hooks: what the viewer check and a lab harness do with the product's page. Loaded by levers.js alone. */
import { run as runCheck } from "./check-page.js";

const CHECK_VIEW = new URL("./check-view.js", import.meta.url).href;

const carriesPixels = (v) => v instanceof SharedArrayBuffer || v instanceof ArrayBuffer || ArrayBuffer.isView(v) || v instanceof MessagePort ||
  (typeof v === "object" && v !== null && Object.values(v).some(carriesPixels));

/** `lab`, the levers' settings; `?check=` makes these the viewer check's (client/viewer/check.mjs). */
export function pageHooks(q, lab) {
  const checking = Boolean(q.get("check"));
  /** The worker variant's check counts what reaches the page, and any pixel or port among it. */
  const seen = checking && q.get("view") === "worker" ? { messages: 0, pixels: 0, fromDownloader: 0 } : null;

  function report(result) {
    globalThis.__viewerResult = result;
    // Read off the page in Chromium and off stdout in Firefox: client/viewer/check.mjs.
    if (checking) console.log(`viewer-result ${JSON.stringify(result)}`);
  }

  return {
    check: checking ? CHECK_VIEW : undefined,
    watch: seen && ((data, from) => {
      seen.messages += 1;
      if (carriesPixels(data)) seen.pixels += 1;
      if (from === "downloader") seen.fromDownloader += 1;
    }),
    report,

    /** A page that stops short still says why, and when; `state()` is what it had received. */
    arm(state) {
      if (!checking) return;
      const stop = (why) => globalThis.__viewerResult || report({ error: why, ...state() });
      addEventListener("error", (e) => stop(`uncaught: ${e.message}`));
      addEventListener("unhandledrejection", (e) => stop(`unhandled: ${e.reason?.message ?? e.reason}`));
      setTimeout(() => stop(`no result in ${q.get("deadline") ?? 120} s`), (q.get("deadline") ?? 120) * 1000);
    },

    failed(error) {
      report({ error });
      lab.finished?.({ error });
    },

    /** Once the page has dialled: the lab's trace and steps, then the check or the lab's ledger after the fill. */
    async run({ n, fillMode, view, worker, controller, progress, errors, shown, show, toggleCine, cineFps, rendererName, boot, issuedAt, at }) {
      const stepped = [];
      const until = (done) => new Promise((resolve) => {
        const poll = setInterval(() => done() && (clearInterval(poll), resolve()), 5);
      });
      // From frame 0 on screen, one step every `everyMs`, each on time however the last went: lab/viewer/trace.js.
      const traced = lab.trace && (async () => {
        await until(() => shown()?.i === 0 || errors.length);
        const t0 = performance.now();
        for (const [k, i] of lab.trace.steps(n).entries()) {
          await new Promise((r) => setTimeout(r, t0 + (k + 1) * lab.trace.everyMs - performance.now()));
          stepped.push({ i, at: at() });
          show(i);
        }
        // On demand a frame the reader left may never be asked, so the trace ends on its last step's frame.
        await until(() => shown()?.i === stepped.at(-1)?.i || errors.length);
      })();
      if (!checking && !lab.finished) return;

      const giveUp = checking ? performance.now() + 60000 : Infinity;
      // The check judges a fill that stops short rather than waiting on it.
      await until(() => progress().have + errors.length >= n || (!fillMode && progress().have) || performance.now() > giveUp);
      await lab.filled?.();
      await view.repaint();
      if (checking) {
        const check = worker ? (phase, args) => worker.check(phase, args)
          : async (phase, args) => (await import(CHECK_VIEW))[phase]({ controller, ...args });
        return runCheck({ q, n, check, errors, report, rendererName: rendererName(), toggleCine, current: () => view.current, seen,
          close: () => (worker ?? controller.client).close() });
      }
      await traced;
      for (const i of lab.steps ?? []) {
        stepped.push({ i, at: at() });
        show(i);
        await until(() => shown()?.i === i || errors.length);
      }
      const cine = await lab.cine?.({ worker, controller, fps: cineFps });
      const ledger = await (worker ?? controller).ledger({ flip: q.get("mutate") === "sample" });
      lab.finished({ ...ledger, boot: { ...boot, ...ledger.boot }, issuedAt, errors, stepped, cine });
    },
  };
}
