/**
 * Stage 3's visit, every arm on one page: the fill (the OQ series through the product's route, or S★'s bands at the
 * fit), a Lossless request on the middle slice once every slice is pictured, the pictures kept in the lab store; with
 * `reopen`, every slice from the store. Every picture is hashed after the clock. lab/htj2k-tiles/improve/README.md §Stage 3
 *
 *   ?cfg=<JSON: arm, key, N, fit, frames, oq, exact, bands, mutate, reopen, truth>&post=URL   (run.mjs writes it)
 */
import { DownloaderClient } from "/client/transport/consumer.js";
import { built } from "/client/decode/wasm-glue.js";

const C = JSON.parse(new URLSearchParams(location.search).get("cfg"));
const POST = new URLSearchParams(location.search).get("post");
/** Where the visit is, for the driver to read when a visit never reports: lab/htj2k-tiles/improve/README.md §Stage 3 */
const stage = (name) => (globalThis.__stage = { name, pictured: pictured.size, failures: failures.length, writes: writes.length, settled: settledWrites, ...counts });
const log = (...a) => (C.debug && console.log(...a), typeof a[0] === "string" && !a[0].startsWith("picture") && stage(a[0]));
const at = () => performance.timeOrigin + performance.now();
/** Layout 1: three strips, bands = levels 2, 1, 0, entry e = b·N·T + f·T + t. docs/disk-layout/target.md §Layout 1 */
const T = 3;
const B = 3;
const EOC = [0xff, 0xd9];
const entry = (b, f, t) => b * C.N * T + f * T + t;
const bandsTo = (level) => B - level;

const meta = await (await fetch(C.frames)).json();
const failures = [];
const pictured = new Map();
const pixels = new Map();
const writes = [];
let settledWrites = 0;
const counts = { decodes: 0, bytes: 0, asks: 0 };
let issuedAt = 0;

const report = (r) => fetch(`${POST}${r.kind}`, { method: "POST", body: JSON.stringify(r) });
await fetch(`${POST}hello`, { method: "POST" });

let storeId = 0;
let store = new Worker("/lab/htj2k-tiles/improve/stage3/store.js");
let storeChain = Promise.resolve();
let storeRetries = 0;
/** A store write in OPFS now and then never returns (Chromium 153 here): past this, the store is restarted and the operation sent again. */
const STORE_MS = 30000;
function once(m) {
  return new Promise((resolve, reject) => {
    const id = storeId++;
    const timer = setTimeout(() => (store.removeEventListener("message", done), reject(new Error("store timeout"))), STORE_MS);
    const done = ({ data }) => {
      if (data.id !== id) return;
      clearTimeout(timer);
      store.removeEventListener("message", done);
      data.error ? reject(new Error(data.error)) : resolve(data);
    };
    store.addEventListener("message", done);
    store.postMessage({ ...m, id, debug: C.debug });
  });
}
async function retried(m) {
  try {
    return await once(m);
  } catch (e) {
    if (e.message !== "store timeout") throw e;
    storeRetries += 1;
    store.terminate();
    store = new Worker("/lab/htj2k-tiles/improve/stage3/store.js");
    await once({ op: "open", key: C.key });
    return once({ ...m, hang: false });
  }
}
/** One operation at a time, each kept until answered so that it can be sent again. */
function stored(m) {
  const p = storeChain.then(() => retried(m));
  storeChain = p.catch(() => {});
  return p;
}
let hang = C.mutate === "store-hang";
const keep = (name, bytes) => {
  writes.push(stored({ op: "put", name, bytes: new Uint8Array(bytes).buffer, hang }).finally(() => settledWrites++));
  hang = false;
};
await stored({ op: "open", key: C.key });

async function sha256(px) {
  const copy = new Uint8Array(px.byteLength);
  copy.set(px);
  if (C.mutate === "sample") copy[copy.length >> 1] ^= 1;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A picture: "oq", or an exact level; a level coarser than the viewport's is a preview, refused (the owner's rule). */
function picture(f, level, px, from = "decode") {
  log("picture", f, level, pictured.size);
  if (level !== "oq" && level > C.fit) return void failures.push({ f, reason: `level ${level} below the viewport's ${C.fit}: a preview, refused` });
  const was = pictured.get(f);
  if (was && rank(was.level) <= rank(level)) return;
  pictured.set(f, { level, at: at(), from });
  pixels.set(`${f}.${level}`, px);
  onPicture(f, level);
}
let onPicture = () => {};
const rank = (level) => (level === "oq" ? Infinity : level);

// ---- the reopen: every slice from the store, nothing asked, nothing decoded ----
if (C.reopen) {
  log("reopen");
  issuedAt = at();
  const names = new Set((await stored({ op: "names" })).names);
  let wouldAsk = 0;
  let bandsAgain = 0;
  for (let f = 0; f < C.N; f++) {
    const name = C.arm === "S★" ? [0, C.fit].map((l) => `p${f}.L${l}`).find((n) => names.has(n)) : names.has(`p${f}.L0`) && f === C.mid ? `p${f}.L0` : `q${f}`;
    const bytes = name && names.has(name) ? (await stored({ op: "get", name })).bytes : null;
    if (!bytes) wouldAsk += 1;
    else picture(f, name.startsWith("q") ? "oq" : Number(name.split(".L")[1]), bytes, "store");
    // S★: a later Lossless ask on f fetches only the finer bands; a fit band not kept would be fetched again.
    if (C.arm === "S★" && !names.has(`p${f}.L0`)) for (let t = 0; t < T; t++) for (let b = 0; b < bandsTo(C.fit); b++) bandsAgain += !names.has(`b${f}.${t}.${b}`);
  }
  const allAt = at();
  const sha = {};
  for (const [f, { level }] of pictured) sha[f] = await sha256(pixels.get(`${f}.${level}`));
  await report({ kind: "result", reopen: true, issuedAt, allAt, wouldAsk, bandsAgain, decodes: counts.decodes, storeRetries, pictured: Object.fromEntries([...pictured].map(([f, p]) => [f, p.level])), sha, failures });
} else {
  await visit().catch((e) => report({ kind: "result", error: String(e?.stack ?? e) }));
}

// ---- the decoders: strip t on worker t, the delivered build whole, the lab binding at a level ----
async function decoders() {
  const pool = [0, 1, 2].map(() => new Worker("/lab/htj2k-tiles/improve/decode/worker.js"));
  await Promise.all(pool.map((w) => new Promise((r) => { w.onmessage = ({ data }) => data.ready && r(); w.postMessage({ load: true }); })));
  for (const w of pool) w.onmessage = null;
  let id = 0;
  return (t, parts, level) => {
    counts.decodes += 1;
    const n = parts.reduce((s, p) => s + p.length, 0) + (level ? EOC.length : 0);
    const bytes = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { bytes.set(p, o); o += p.length; }
    if (level) bytes.set(EOC, o);
    return new Promise((resolve, reject) => {
      const mine = id++;
      const done = ({ data }) => {
        if (data.id !== mine) return;
        pool[t].removeEventListener("message", done);
        data.error ? reject(new Error(data.error)) : resolve(new Uint8Array(data.px));
      };
      pool[t].addEventListener("message", done);
      pool[t].postMessage({ id: mine, bytes: bytes.buffer, level }, [bytes.buffer]);
    });
  };
}

/** A strip series' entries as they land: each strip decoded at every level its frame wants once its bands are here. */
function strips(decode) {
  const coded = new Map();
  const done = new Set();
  const held = new Map();
  const wants = new Map();
  const tryStrip = (f, t) => {
    const bands = coded.get(`${f}.${t}`) ?? [];
    for (const level of wants.get(f) ?? []) {
      const k = `${f}.${t}.${level}`;
      if (done.has(k) || !range(0, bandsTo(level)).every((b) => bands[b])) continue;
      done.add(k);
      decode(t, bands.slice(0, bandsTo(level)), level).then((px) => {
        const parts = held.get(`${f}.${level}`) ?? Array(T);
        parts[t] = px;
        held.set(`${f}.${level}`, parts);
        if (parts.filter(Boolean).length < T) return;
        held.delete(`${f}.${level}`);
        const whole = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
        let o = 0;
        for (const p of parts) { whole.set(p, o); o += p.length; }
        picture(f, level, whole);
      }, (e) => failures.push({ f, t, level, reason: String(e.message ?? e) }));
    }
    if (C.mutate === "preview" && bands[0] && !done.has(`${f}.${t}.2`)) {
      done.add(`${f}.${t}.2`);
      decode(t, [bands[0]], 2).then((px) => picture(f, 2, px));
    }
  };
  return {
    coded,
    want(f, levels) {
      wants.set(f, levels);
      for (let t = 0; t < T; t++) tryStrip(f, t);
    },
    landed(e, bytes) {
      counts.bytes += bytes.length;
      const b = Math.floor(e / (C.N * T));
      const f = Math.floor((e % (C.N * T)) / T);
      const t = e % T;
      const bands = coded.get(`${f}.${t}`) ?? [];
      bands[b] = bytes;
      coded.set(`${f}.${t}`, bands);
      tryStrip(f, t);
    },
  };
}

async function visit() {
  const decode = C.arm === "D" || C.arm === "D′" ? null : await decoders();
  log("decoders up");
  const S = decode && strips(decode);
  const bandsClient = C.bands && await DownloaderClient.connect(C.bands.url, C.bands.hash, {
    decode: false, onFrame: (fr) => S.landed(fr.frameIndex, fr.bytes), onError: (e) => failures.push({ e: e.frameIndex, reason: e.reason }) });
  const askEntries = (list) => {
    counts.asks += list.length;
    for (const e of list) bandsClient.requestExactFrame(e).then((fr) => S.landed(e, fr.bytes), (err) => failures.push({ e, reason: String(err.message ?? err) }));
  };
  log("bands client", Boolean(bandsClient));
  const exactClient = C.exact && await DownloaderClient.connect(C.exact.url, C.exact.hash, {
    decoders: 1, decoder: await built("openjph"), digests: C.exact.digests });
  const oqInfo = { exact: 0, inexact: 0, unchecked: 0, paths: {} };
  let oqClient = null;
  const allPictured = new Promise((resolve) => (onPicture = () => pictured.size === C.N && resolve(at())));

  if (C.arm === "S★") {
    issuedAt = at();
    for (let f = 0; f < C.N; f++) S.want(f, [C.fit]);
    const run = [...Array(bandsTo(C.fit) * C.N * T).keys()];
    const first = run.filter((e) => Math.floor((e % (C.N * T)) / T) === 0);
    askEntries(first);
    counts.asks += run.length - first.length;
    bandsClient.fill(run.filter((e) => !first.includes(e)));
  } else {
    const oqMeta = await (await fetch(C.oq.meta)).json();
    const decoder = { codec: "av1", lossy: true, ...(await built("dav1d")) };
    const g = oqMeta.lossy?.g ?? 1;
    issuedAt = at();
    oqClient = await DownloaderClient.connect(C.oq.url, C.oq.hash, {
      decoder, digests: oqMeta.digests?.frames, ...(g > 1 && { groupLength: g, frameCount: C.N }),
      onFrame: (fr) => {
        counts.bytes += fr.info.wireBytes ?? 0;
        oqInfo[fr.info.exact === true ? "exact" : fr.info.exact === false ? "inexact" : "unchecked"] += 1;
        oqInfo.paths[fr.info.path] = (oqInfo.paths[fr.info.path] ?? 0) + 1;
        const px = new Uint8Array(fr.bytes.byteLength);
        px.set(fr.bytes);
        picture(fr.frameIndex, "oq", px);
      },
      onError: (e) => failures.push({ f: e.frameIndex, reason: e.reason }),
    });
    counts.asks += C.N;
    oqClient.fill([...Array(C.N).keys()]);
  }
  log("fill issued");
  const allAt = await Promise.race([allPictured, new Promise((r) => setTimeout(() => r(null), 540000))]);
  const firstAt = Math.min(...[...pictured.values()].map((p) => p.at));
  const fillBytes = counts.bytes;

  // ---- the Lossless request on the middle slice ----
  const f = C.mid;
  const askAt = at();
  log("lossless asked");
  let levelAt = null;
  let losslessAt = null;
  if (allAt !== null) {
    const lossless = new Promise((resolve) => (onPicture = (i, level) => {
      if (i !== f) return;
      if (level === 0) resolve(at());
      else if (C.arm === "D+L★") levelAt = at();
    }));
    if (exactClient) {
      counts.asks += 1;
      const fr = await exactClient.requestExactFrame(f);
      counts.bytes += fr.info.wireBytes ?? 0;
      const px = new Uint8Array(fr.bytes.byteLength);
      px.set(fr.bytes);
      picture(f, 0, px);
    } else if (C.arm === "S★" && C.fit === 0) {
      onPicture(f, 0);
    } else {
      const levels = C.arm === "D+L★" && C.fit > 0 ? [C.fit, 0] : [0];
      const from = C.arm === "S★" ? bandsTo(C.fit) : 0;
      // Strip-major: a strip's bands land together and it decodes as the next one arrives; D+L★ asks the fit's bands first.
      const order = C.arm === "D+L★" && C.fit > 0
        ? [[0, bandsTo(C.fit)], [bandsTo(C.fit), B]].flatMap(([b0, b1]) => [0, 1, 2].flatMap((t) => range(b0, b1).map((b) => entry(b, f, t))))
        : [0, 1, 2].flatMap((t) => range(from, B).map((b) => entry(b, f, t)));
      S.want(f, levels);
      askEntries(order);
    }
    losslessAt = await Promise.race([lossless, new Promise((r) => setTimeout(() => r(null), 120000))]);
  }
  if (losslessAt !== null) {
    keep(`p${f}.L0`, pixels.get(`${f}.0`));
    for (const n of [`p${f}.L${C.fit}`, ...[0, 1, 2].flatMap((t) => range(0, B).map((b) => `b${f}.${t}.${b}`))]) if (n !== `p${f}.L0`) writes.push(stored({ op: "drop", name: n }));
  }
  const endAt = at();
  log("lossless done");

  // ---- after the clock: the store written (off the clock in every arm), every picture hashed ----
  log("after the clock");
  for (const [k, px] of pixels) {
    const [i, level] = k.split(".");
    if (level === "oq") keep(`q${i}`, px);
    else if (Number(i) !== f) keep(`p${i}.L${level}`, px);
  }
  if (C.arm === "S★" && C.mutate !== "bands-dropped") for (const [k, bands] of S.coded) if (Number(k.split(".")[0]) !== f) bands.forEach((b, j) => b && keep(`b${k}.${j}`, b));
  await Promise.all(writes);
  log("stored", writes.length);
  oqClient?.close();
  bandsClient?.close();
  exactClient?.close();
  const sha = {};
  log("hashing");
  for (const [k, px] of pixels) sha[k] = await sha256(px);
  await report({ kind: "result", issuedAt, firstAt, allAt, askAt, levelAt, losslessAt, endAt, fillBytes, bytes: counts.bytes, asks: counts.asks,
    decodes: counts.decodes, storeRetries, oq: oqInfo, sha, failures: failures.slice(0, 20), nFailures: failures.length });
}

function range(a, b) {
  return Array.from({ length: b - a }, (_, k) => a + k);
}
