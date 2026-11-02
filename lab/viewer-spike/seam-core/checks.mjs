// Each check states its claim and returns `{ ok, seen }`; each mutant breaks one place, and the check named must fail on it.
import { decodePng } from "./png.mjs";
import { sample } from "./shape.mjs";

/** ms: the tools' mouse-down listener holds a press this long to tell a double click (DOUBLE_CLICK_TOLERANCE_MS, 400). */
const DOUBLE_CLICK_MS = 450;
const near = (a, b, tol) => Math.abs(a - b) <= tol;

async function at(page, [x, y], id = "vp1") {
  const [ox, oy] = await page.evaluate((id) => spike.origin(id), id);
  return [ox + x, oy + y];
}

/** Both view workers have painted what their viewports last asked, and the compositor has had two frames. */
async function settle(page, { render = true } = {}) {
  await page.evaluate(async (render) => {
    if (render) for (const v of Object.values(spike.viewports)) v.render();
    await new Promise((r) => requestAnimationFrame(r));
    await spike.shownAll();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  }, render);
}

async function drag(page, from, to, id, { render = true } = {}) {
  const a = await at(page, from, id), b = await at(page, to, id);
  await page.mouse.move(...a);
  await page.mouse.down();
  for (let s = 1; s <= 5; s++) {
    await page.mouse.move(a[0] + ((b[0] - a[0]) * s) / 5, a[1] + ((b[1] - a[1]) * s) / 5);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await page.waitForTimeout(DOUBLE_CLICK_MS);
  await settle(page, { render });
}

async function click(page, p) {
  await page.mouse.move(...(await at(page, p)));
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForTimeout(DOUBLE_CLICK_MS);
}

/** The grey code on screen at a canvas point: what the user sees, the worker's canvas composited. */
async function screenCode(page, p, id = "vp1") {
  const [x, y] = (await at(page, p, id)).map(Math.floor);
  return decodePng(await page.screenshot({ clip: { x, y, width: 1, height: 1 } })).at(0, 0)[0];
}

/** The probe's value at a canvas point; it arrives from the view worker a round trip after the tool first draws. */
async function probeAt(page, p) {
  await page.evaluate(() => { spike.clear(); spike.activate("Probe"); });
  await click(page, p);
  await page.waitForFunction(() => { const a = spike.annotations("Probe"); return a.length === 1 && Object.values(a[0].stats)[0]?.value != null; }, null, { timeout: 5000 });
  const [a] = await page.evaluate(() => spike.annotations("Probe"));
  return Object.values(a.stats)[0].value;
}

/** The probe's value and the code on screen at one canvas point agree under the tools' window. */
async function registered(page, p, id = "vp1") {
  const value = await probeAt(page, p);
  await settle(page);
  const painted = await screenCode(page, p, id);
  const expected = await page.evaluate(([v, id]) => spike.expectedCode(v, id), [value, id]);
  return { value, painted, expected, ok: near(painted, expected, 1) };
}

/** Two clicks of the length tool at the centres of two pixels. */
async function lengthOn(page, a, b) {
  await page.evaluate(() => spike.activate("Length"));
  const [p, q] = await page.evaluate(([a, b]) => [spike.pixelCentre(...a), spike.pixelCentre(...b)], [a, b]);
  await drag(page, p, q);
}

const centre = (page, i, j, id) => page.evaluate(([i, j, id]) => spike.pixelCentre(i, j, id), [i, j, id]);

export const CHECKS = {
  /** Every frame of the series reached both viewports exact through our transport, decoders and digest check. */
  async exact(page) {
    const p = await page.evaluate(() => Object.values(spike.viewports).map((v) => v.heard.findLast((e) => e.type === "progress")));
    const ok = p.every((e) => e.have === e.total && e.seen.exact === e.total && e.seen.inexact === 0 && e.seen.unchecked === 0);
    return { ok, seen: p.map((e) => `${e.seen.exact}/${e.total} exact, fill ${Math.round(e.fillMs)} ms`).join("; ") };
  },
  /** Under the product's isolation headers and policy the page is cross-origin isolated and nothing is refused. */
  async policy(page) {
    const r = await page.evaluate(() => ({ isolated: crossOriginIsolated, violations: spike.seen.violations, contexts: spike.seen.contexts }));
    const tally = Object.entries(r.contexts.reduce((m, c) => ((m[c] = (m[c] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ×${n}`).join(", ");
    return { ok: r.isolated && r.violations.length === 0, seen: `isolated ${r.isolated}, ${r.violations.length} refused ${r.violations.join("; ")}; contexts on the page: ${tally}` };
  },
  /** Through every tool, Cornerstone3D asks its image loader for nothing and caches nothing: our download order is the only one. */
  async ["no loads"](page) {
    await lengthOn(page, [10, 10], [40, 30]);
    await page.mouse.move(...(await at(page, [128, 96])));
    await page.mouse.wheel(0, 120);
    await settle(page);
    const a = await page.evaluate(() => spike.asked());
    return { ok: a.loads === 0 && a.cacheBytes === 0, seen: `${a.loads} loads, ${a.cacheBytes} B cached` };
  },
  /** Cornerstone3D's stack prefetch, if enabled on our viewport, asks its loader for every other slice: a second download order. */
  async ["prefetch competes"](page) {
    await page.evaluate(() => spike.prefetch());
    await page.waitForTimeout(300);
    const a = await page.evaluate(() => spike.asked());
    const n = await page.evaluate(() => spike.meta.frameCount);
    return { ok: a.loads === n - 1, seen: `${a.loads} loads asked of ${n - 1} other slices` };
  },
  /** With no metadata provider answering, length and probe still give mm and samples; the modules the tools asked for are listed. */
  async metadata(page) {
    await lengthOn(page, [10, 10], [40, 30]);
    const [ann] = await page.evaluate(() => spike.annotations("Length"));
    const length = Object.values(ann.stats)[0].length;
    const value = await probeAt(page, await centre(page, 20, 15));
    const { metadata } = await page.evaluate(() => spike.asked());
    const ok = near(length, 0.5 * Math.hypot(30, 20), 0.01) && value === sample(20, 15, 0);
    return { ok, seen: `length ${length?.toFixed(3)} mm, probe ${value}; asked: ${metadata.join(", ")}` };
  },
  /** The length tool between the centres of pixels (10, 10) and (40, 30) measures 0.5 mm × √(30² + 20²). */
  async length(page) {
    await lengthOn(page, [10, 10], [40, 30]);
    const [ann] = await page.evaluate(() => spike.annotations("Length"));
    const length = Object.values(ann.stats)[0].length;
    const want = 0.5 * Math.hypot(30, 20);
    return { ok: near(length, want, 0.01), seen: `length ${length?.toFixed(3)} mm, want ${want.toFixed(3)}` };
  },
  /** The angle tool's three clicks at pixels (10, 10), (40, 10), (70, 40) measure 135°. */
  async angle(page) {
    await page.evaluate(() => { spike.clear(); spike.activate("Angle"); });
    for (const [i, j] of [[10, 10], [40, 10], [70, 40]]) await click(page, await centre(page, i, j));
    await settle(page);
    const anns = await page.evaluate(() => spike.annotations("Angle"));
    const angle = anns.length === 1 ? Object.values(anns[0].stats)[0]?.angle : undefined;
    return { ok: anns.length === 1 && near(angle, 135, 0.05), seen: `${anns.length} angle annotations, ${angle?.toFixed?.(2)}°` };
  },
  /** The probe at the centre of pixel (20, 15) on slice 0 reads that sample, asked of the view worker. */
  async probe(page) {
    const value = await probeAt(page, await centre(page, 20, 15));
    return { ok: value === sample(20, 15, 0), seen: `value ${value}, want ${sample(20, 15, 0)}` };
  },
  /** At the fit, the code on screen under a canvas point is the windowed value the probe reads there. */
  async registration(page) {
    const r = await registered(page, await centre(page, 20, 15));
    return { ok: r.ok, seen: `value ${r.value}: on screen ${r.painted}, expected ${r.expected}` };
  },
  /** After the zoom tool's drag and the pan tool's, the image on screen is still under the tools' coordinates. */
  async ["zoom and pan"](page) {
    await page.evaluate(() => spike.activate("Zoom"));
    await drag(page, [128, 96], [128, 140]);
    await page.evaluate(() => spike.activate("Pan"));
    await drag(page, [128, 96], [110, 85]);
    const zoom = await page.evaluate(() => spike.viewports.vp1.getZoom());
    const r = await registered(page, await centre(page, 60, 45));
    return { ok: zoom > 1.05 && r.ok, seen: `zoom ${zoom.toFixed(3)}; value ${r.value}: on screen ${r.painted}, expected ${r.expected}` };
  },
  /** The window-level drag changes the tools' window, and the view worker paints with it. */
  async ["window drag"](page) {
    await page.evaluate(() => spike.activate("WindowLevel"));
    const before = await page.evaluate((v) => spike.expectedCode(v), sample(100, 80, 0));
    await drag(page, [40, 40], [240, 40]);
    const voi = await page.evaluate(() => spike.viewports.vp1.getProperties().voiRange);
    const r = await registered(page, await centre(page, 100, 80));
    return { ok: Math.abs(r.expected - before) > 2 && r.ok, seen: `window ${voi.lower.toFixed(0)}–${voi.upper.toFixed(0)}; code ${before} before; on screen ${r.painted}, expected ${r.expected}` };
  },
  /** One wheel step shows slice 1: the probe reads slice 1's sample, and slice 1 is on screen. */
  async scroll(page) {
    await page.mouse.move(...(await at(page, [128, 96])));
    await page.mouse.wheel(0, 120);
    await settle(page);
    const index = await page.evaluate(() => spike.viewports.vp1.getCurrentImageIdIndex());
    const r = await registered(page, await centre(page, 2, 2));
    return { ok: index === 1 && r.value === sample(2, 2, 1) && r.ok, seen: `index ${index}; value ${r.value} (want ${sample(2, 2, 1)}): on screen ${r.painted}, expected ${r.expected}` };
  },
  /** An annotation drawn on slice 0 is drawn on slice 0 only: gone on slice 1, back on slice 0. */
  async ["per slice"](page) {
    await lengthOn(page, [10, 10], [40, 30]);
    const seen = [await page.evaluate(() => spike.drawn())];
    for (const i of [1, 0]) {
      await page.evaluate((i) => spike.viewports.vp1.setImageIdIndex(i), i);
      await settle(page);
      seen.push(await page.evaluate(() => spike.drawn()));
    }
    return { ok: seen[0] > 0 && seen[1] === 0 && seen[2] === seen[0], seen: `SVG elements on slice 0, 1, 0: ${seen.join(", ")}` };
  },
  /** Cornerstone3D's own VOI synchronizer does not reach our viewport; its zoom-pan synchronizer does, through getZoom and getPan. */
  async ["stock links"](page) {
    await page.evaluate(() => { spike.link("stockVoi"); spike.activate("WindowLevel"); });
    await drag(page, [128, 96], [168, 116]);
    const [v1, v2] = await page.evaluate(() => [spike.viewports.vp1.voiRange, spike.viewports.vp2.voiRange]);
    await page.evaluate(() => { spike.link("stockZoomPan"); spike.activate("Zoom"); });
    await drag(page, [128, 96], [128, 140]);
    await page.evaluate(() => spike.activate("Pan"));
    await drag(page, [128, 96], [110, 85]);
    const [z1, z2, p1, p2] = await page.evaluate(() => { const [a, b] = [spike.viewports.vp1, spike.viewports.vp2]; return [a.getZoom(), b.getZoom(), a.getPan(), b.getPan()]; });
    const voiReached = v2.upper === v1.upper && v2.lower === v1.lower;
    const r = await registered(page, await centre(page, 60, 45, "vp2"), "vp2");
    const linked = near(z2, z1, 1e-6) && z1 > 1.05 && near(p2[0], p1[0], 1e-6) && near(p2[1], p1[1], 1e-6) && p1[0] !== 0;
    return { ok: !voiReached && linked && r.ok, seen: `VOI ${voiReached ? "reached" : "not reached"} (vp2 ${v2.lower}–${v2.upper}); zoom ${z1.toFixed(3)} → vp2 ${z2.toFixed(3)}, pan ${p1.map((v) => v.toFixed(1))} → vp2 ${p2.map((v) => v.toFixed(1))}; vp2 on screen ${r.painted}, expected ${r.expected}` };
  },
  /** Our VOI callback on Cornerstone3D's synchronizer: a window drag on one view is painted on the other. */
  async ["our VOI link"](page) {
    await page.evaluate(() => { spike.link("ourVoi"); spike.activate("WindowLevel"); });
    const before = await page.evaluate((v) => spike.expectedCode(v, "vp2"), sample(100, 80, 0));
    // No render here but the link's own: the callback must paint the other view itself.
    await drag(page, [40, 40], [240, 40], "vp1", { render: false });
    const [v1, v2] = await page.evaluate(() => [spike.viewports.vp1.voiRange, spike.viewports.vp2.voiRange]);
    const painted = await screenCode(page, await centre(page, 100, 80, "vp2"), "vp2");
    const expected = await page.evaluate((v) => spike.expectedCode(v, "vp2"), sample(100, 80, 0));
    const ok = v2.lower === v1.lower && v2.upper === v1.upper && Math.abs(expected - before) > 2 && near(painted, expected, 1);
    return { ok, seen: `vp1 ${v1.lower.toFixed(0)}–${v1.upper.toFixed(0)}, vp2 ${v2.lower.toFixed(0)}–${v2.upper.toFixed(0)}; vp2 code ${before} before, on screen ${painted}, expected ${expected}` };
  },
  /** Our cine, the view worker's clock: it moves the frame, the tools follow, and the slice's annotation shows only on its slice. */
  async cine(page) {
    await lengthOn(page, [10, 10], [40, 30]);
    await page.evaluate(() => spike.viewports.vp1.play(20));
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const v = spike.viewports.vp1;
      v.pause();
      await new Promise((res) => setTimeout(res, 200));
      await spike.shownAll();
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      const log = await v.view.cine();
      return { log, index: v.index, shown: v.shown.i, drawn: spike.drawn() };
    });
    const late = r.log.filter((e) => e.start - e.tick > 50).length;
    const ok = r.log.length >= 20 && r.index === r.shown && r.drawn === (r.index === 0 ? 1 : 0);
    return { ok, seen: `${r.log.length} frames painted in 1.5 s at 20/s (${late} started > 50 ms late); page index ${r.index}, view worker ${r.shown}; annotation drawn ${r.drawn}` };
  },
};

export const MUTANTS = [
  { name: "the view worker's series is not checked", check: "exact", from: "const digests = meta.digests?.frames;", to: "const digests = undefined;" },
  { name: "the page connects off its policy", check: "policy", file: "page.js", from: "await initCore();", to: "await initCore(); fetch(\"https://example.invalid/\").catch(() => {});" },
  { name: "the page enables Cornerstone3D's prefetch", check: "no loads", file: "page.js", from: "window.spikeReady = true;", to: "tools.utilities.stackPrefetch.enable(vp.element); window.spikeReady = true;" },
  { name: "the viewport says it holds no image URI", check: "prefetch competes", from: "hasImageURI = (uri) =>", to: "hasImageURIx = (uri) =>" },
  { name: "the image data has no spacing", check: "metadata", from: "spacing: [sx, sy, 1],\n      origin", to: "spacing: [1, 1, 1],\n      origin" },
  { name: "canvasToWorld scaled 1.1 in x", check: "length", from: "dest[0] = ((p[0] - this.corner[0]) / this.scale - 0.5) * sx;", to: "dest[0] = ((p[0] - this.corner[0]) / (this.scale * 1.1) - 0.5) * sx;" },
  { name: "canvasToWorld scaled 1.1 in y", check: "angle", from: "dest[1] = ((p[1] - this.corner[1]) / this.scale - 0.5) * sy;", to: "dest[1] = ((p[1] - this.corner[1]) / (this.scale * 1.1) - 0.5) * sy;" },
  { name: "the sample one off", check: "probe", from: "this.samples.set(key, v.stored[0]);", to: "this.samples.set(key, v.stored[0] + 1);" },
  { name: "the painter's pan 8 px off", check: "registration", from: "const panX = (this.corner[0] * dpr", to: "const panX = 8 + (this.corner[0] * dpr" },
  { name: "the painter's zoom 5 % off", check: "zoom and pan", from: "const zoom = this.scale * dpr;", to: "const zoom = this.scale * dpr * 1.05;" },
  { name: "the window never reaches the view worker", check: "window drag", from: "if (key !== this.#sent.display) this.view.setDisplay(display);", to: "if (!this.#sent.display) this.view.setDisplay(display);" },
  { name: "a step never reaches the view worker", check: "scroll", from: "this.view.show(this.index);", to: "this.view.show(0);" },
  { name: "world z is not the slice", check: "per slice", from: "dest[2] = this.index;", to: "dest[2] = 0;" },
  { name: "the viewport has no getPan", check: "stock links", from: "getPan = () => {", to: "getPanX = () => {" },
  { name: "our VOI callback does not render", check: "our VOI link", file: "page.js", from: "target.voiRange = { ...e.detail.range };\n      target.render();", to: "target.voiRange = { ...e.detail.range };" },
  { name: "the page does not follow the cine", check: "cine", from: "if (this.playing && e.i !== this.index) {", to: "if (false) {" },
];
