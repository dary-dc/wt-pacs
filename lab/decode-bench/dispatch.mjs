// First-free dispatch against round-robin, at equal pool width. The belief is that it matters
// when decode times are uneven and is a wash when they are even; neither half had been tested.
// docs/decode/README.md §Dispatch holds the numbers.
//
// usage: node dispatch.mjs [--width N] [--rounds N] [--frames N]
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { loadFixture, median, range, sha256 } from './decoder.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(argv[i + 1]);
};
const WIDTH = opt('width', 4);
const ROUNDS = opt('rounds', 7);
const FRAMES = opt('frames', 60);
const POLICIES = ['round-robin', 'first-free', 'first-free+1'];

const ns = (a, b) => Number(b - a) / 1e6;

/**
 * `width` workers, one decoder each. Both policies start from the same instant with every frame
 * already available — a fill has them — so `wait` counts queueing in both and the two are
 * comparable. Round-robin assigns frame k to worker k mod width whether or not it is busy;
 * first-free holds the frames back and gives the next one to whichever worker just freed.
 */
async function run(policy, work) {
  const workers = [];
  const ready = [];
  for (let id = 0; id < WIDTH; id++) {
    const w = new Worker(path.join(here, 'dispatch_worker.mjs'), { workerData: { id, sets: SET_NAMES } });
    workers.push(w);
    ready.push(new Promise((res) => w.once('message', res)));
  }
  await Promise.all(ready);

  const split = [];
  const outstanding = new Array(WIDTH).fill(0);
  let next = 0;
  let settled = 0;

  return await new Promise((resolve) => {
    const post = (id, seq) =>
      workers[id].postMessage({ kind: 'decode', seq, set: work[seq].set, at: work[seq].at });

    for (const w of workers) {
      w.on('message', (m) => {
        if (m.kind !== 'done') return;
        const tookNs = process.hrtime.bigint();
        split.push({
          seq: m.seq,
          wait: ns(availableNs, m.startedNs),
          decode: ns(m.startedNs, m.doneNs),
          take: ns(m.doneNs, tookNs),
          total: ns(availableNs, tookNs),
          digest: sha256(new Uint8Array(m.bytes)),
        });
        settled += 1;
        outstanding[m.id] -= 1;
        // first-free costs one main-thread hop per frame; +1 keeps a worker one frame ahead so
        // it never idles waiting for the hop, which is the steelman of the same policy.
        const depth = policy === 'first-free+1' ? 2 : 1;
        while (policy !== 'round-robin' && next < work.length && outstanding[m.id] < depth) {
          outstanding[m.id] += 1;
          post(m.id, next++);
        }
        if (settled === work.length) {
          for (const w2 of workers) w2.postMessage({ kind: 'stop' });
          resolve(split);
        }
      });
    }

    var availableNs = process.hrtime.bigint();
    if (policy === 'round-robin') {
      for (let seq = 0; seq < work.length; seq++) post(seq % WIDTH, seq);
      next = work.length;
    } else {
      const depth = policy === 'first-free+1' ? 2 : 1;
      for (let d = 0; d < depth; d++) {
        for (let i = 0; i < WIDTH && next < work.length; i++) {
          outstanding[i] += 1;
          post(i, next++);
        }
      }
    }
  });
}

function summarise(split, work) {
  const wrong = split.filter((s) => s.digest !== work[s.seq].truth).length;
  const sum = (k) => split.reduce((a, s) => a + s[k], 0);
  return {
    wrong,
    perFrame: sum('total') / split.length,
    wait: sum('wait') / split.length,
    decode: sum('decode') / split.length,
    take: sum('take') / split.length,
    wall: Math.max(...split.map((s) => s.total)),
  };
}

const SET_NAMES = ['g160', 'g512', 'g2048'];
const sets = SET_NAMES.map((n) => loadFixture(`lab/fixtures/decode_${n}`));

/**
 * Uniform: one size. Mixed: sizes in a seeded shuffle, which is the device case the belief is
 * about. Not a repeating cycle — a cycle whose period divides the pool width hands round-robin
 * one size per worker, which reverses the answer and is an artefact of the fixture, not a result.
 */
function build(kind) {
  let seed = 0x5eed;
  const nextSet = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % sets.length;
  };
  const work = [];
  for (let i = 0; i < FRAMES; i++) {
    const which = kind === 'uniform' ? 1 : nextSet();
    const at = i % sets[which].frames.length;
    work.push({ set: SET_NAMES[which], at, truth: sets[which].truth[at] });
  }
  return work;
}

console.log(`pool width ${WIDTH}, ${FRAMES} frames, ${ROUNDS - 1} timed rounds, policies interleaved and rotated`);
console.log('  frames     policy        ms/frame*           wait*    decode*    take*   sums   batch ms*   slower in');
for (const kind of ['uniform', 'mixed']) {
  const work = build(kind);
  const got = Object.fromEntries(POLICIES.map((p) => [p, []]));
  for (let round = 0; round < ROUNDS; round++) {
    const shift = round % POLICIES.length;
    const order = [...POLICIES.slice(shift), ...POLICIES.slice(0, shift)];
    for (const policy of order) {
      const s = summarise(await run(policy, work), work);
      if (s.wrong) {
        console.error(`${kind}/${policy}: ${s.wrong} frames differ from the encoder's input`);
        process.exit(1);
      }
      if (round) got[policy].push(s);
    }
  }
  const n = ROUNDS - 1;
  for (const policy of POLICIES) {
    const rs = got[policy];
    const per = rs.map((r) => r.perFrame);
    const [lo, hi] = range(per);
    // The split is reported from the median round, not as three medians: medians do not add,
    // and a split that does not sum is not a split.
    const mid = rs.slice().sort((a, b) => a.perFrame - b.perFrame)[rs.length >> 1];
    const parts = mid.wait + mid.decode + mid.take;
    const worse =
      policy === 'round-robin'
        ? null
        : got[policy].filter((r, i) => r.perFrame > got['round-robin'][i].perFrame).length;
    console.log(
      `  ${kind.padEnd(9)} ${policy.padEnd(14)} ${mid.perFrame.toFixed(2)} [${lo.toFixed(2)}-${hi.toFixed(2)}]` +
        `   ${mid.wait.toFixed(2).padStart(7)}  ${mid.decode.toFixed(2).padStart(8)}  ${mid.take.toFixed(2).padStart(7)}` +
        `   ${(parts / mid.perFrame).toFixed(3)}   ${median(rs.map((r) => r.wall)).toFixed(0).padStart(8)}   ${worse === null ? '—' : `${worse}/${n}`}`
    );
  }
}
console.log('  * container-measured, not a timing rig: the shape is the claim, not the milliseconds.');
console.log('  sums = (wait + decode + take) / total; anything but 1.000 means the split is not one.');
