// One build of the decoder against another from a cold module: frames 0-2 and the steady state,
// a fresh Node process or a fresh browser context per sample. docs/decode/README.md §Faster
//
// usage: NODE_PATH=$(npm root -g) node cold_arms.mjs --arms exc4,wex4 [--rounds 12]
//          [--where node,browser] FIXTURE_DIR [FIXTURE_DIR ...]
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { leadsByPredecessor, order } from '../order.mjs';
import { loadFixture, median, range, sha256 } from './decoder.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const armsDir = process.env.ARMS_DIR || path.join(ROOT, 'lab/.openjph-build/wasm');
const argv = process.argv.slice(2);
const pick = (flag, dflt) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : dflt);
const COLD = 3;
const STEADY_FROM = 10;

/** The child: one arm, one set, every frame once, checked against the encoder's input. */
if (argv[0] === '--child') {
  const [, arm, dir] = argv;
  const { frames, truth } = loadFixture(dir);
  const M = await require(path.join(armsDir, `${arm}.js`))();
  const d = new M.HTJ2KDecoder();
  const ms = [];
  let wrong = 0;
  for (let i = 0; i < frames.length; i++) {
    const t0 = performance.now();
    d.getEncodedBuffer(frames[i].length).set(frames[i]);
    d.readHeader();
    d.decode();
    const out = d.getDecodedBuffer();
    ms.push(performance.now() - t0);
    if (sha256(out) !== truth[i]) wrong++;
  }
  console.log(JSON.stringify({ ms, wrong }));
  process.exit(0);
}

const names = pick('--arms', 'exc4,wex4').split(',');
const ROUNDS = Number(pick('--rounds', 12));
const WHERE = pick('--where', 'node,browser').split(',');
const dirs = argv.filter((a, i) => !a.startsWith('--') && !['--arms', '--rounds', '--where'].includes(argv[i - 1]));

function inNode(arm, dir) {
  const out = execFileSync(process.execPath, [new URL(import.meta.url).pathname, '--child', arm, dir], {
    env: { ...process.env, ARMS_DIR: armsDir },
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(out.toString());
}

let browser = null;
let base = null;
async function openBrowser() {
  const { chromium } = require('playwright');
  const port = 22000 + ((Math.random() * 8000) | 0);
  const host = spawn('python3', [path.join(ROOT, 'server/dev-server.py'), '--port', String(port)], { cwd: ROOT, stdio: 'ignore' });
  process.on('exit', () => host.kill());
  await new Promise((r) => setTimeout(r, 1200));
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
}

/** A fresh context: no HTTP cache, no code cache; the module is compiled from a buffer as decoder.js does. */
async function inBrowser(arm, dir, frameCount, truth) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${base}/lab/decode-bench/README.md`);
  const rel = path.relative(ROOT, dir);
  const armRel = path.relative(ROOT, armsDir);
  const r = await page.evaluate(async ({ arm, armRel, rel, frameCount, truth }) => {
    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      frames.push(new Uint8Array(await (await fetch(`/${rel}/${String(i).padStart(3, '0')}.j2c`)).arrayBuffer()));
    }
    const src = await (await fetch(`/${armRel}/${arm}.js`)).text();
    const wasmBinary = await (await fetch(`/${armRel}/${arm}.wasm`)).arrayBuffer();
    const factory = new Function(`${src}\nreturn OpenJPHModule;`)();
    const M = await factory({ wasmBinary });
    const d = new M.HTJ2KDecoder();
    const ms = [];
    const outs = [];
    for (const f of frames) {
      const t0 = performance.now();
      d.getEncodedBuffer(f.length).set(f);
      d.readHeader();
      d.decode();
      const out = d.getDecodedBuffer();
      ms.push(performance.now() - t0);
      outs.push(out.slice());
    }
    let wrong = 0;
    for (let i = 0; i < outs.length; i++) {
      const h = [...new Uint8Array(await crypto.subtle.digest('SHA-256', outs[i]))].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (h !== truth[i]) wrong++;
    }
    return { ms, wrong };
  }, { arm, armRel, rel, frameCount, truth });
  await ctx.close();
  return r;
}

if (WHERE.includes('browser')) await openBrowser();
console.log(`arms ${names.join(' · ')}, ${ROUNDS} rounds, Williams order (lab/order.mjs); first arm the baseline; ms`);
for (const where of WHERE) {
  for (const dir of dirs) {
    const { frames, truth, name } = loadFixture(dir);
    const got = Object.fromEntries(names.map((n) => [n, []]));
    for (let round = 0; round < ROUNDS; round++) {
      let prev = null;
      for (const n of order(names, round)) {
        const r = where === 'node' ? inNode(n, dir) : await inBrowser(n, dir, frames.length, truth);
        if (r.wrong) {
          console.error(`${where} ${name} ${n}: ${r.wrong} frames differ from the encoder's input — not an arm`);
          process.exit(1);
        }
        got[n].push({ round, prev, cold: r.ms.slice(0, COLD), steady: median(r.ms.slice(STEADY_FROM)) });
        prev = n;
      }
    }
    console.log(`\n  ${where} · ${name.replace('decode_', '')}`);
    const cell = (n, pickOf) => {
      const v = got[n].map(pickOf);
      const [lo, hi] = range(v);
      const wins = n === names[0] ? '' : ` ${v.filter((x, i) => x < pickOf(got[names[0]][i])).length}/${ROUNDS}`;
      return `${median(v).toFixed(2)} [${lo.toFixed(2)}-${hi.toFixed(2)}]${wins}`;
    };
    for (const n of names) {
      const cols = [0, 1, 2].map((i) => cell(n, (s) => s.cold[i]));
      console.log(`    ${n.padEnd(8)} f0 ${cols[0].padEnd(24)} f1 ${cols[1].padEnd(24)} f2 ${cols[2].padEnd(24)} steady ${cell(n, (s) => s.steady)}`);
    }
    for (const [what, pickOf] of [['f0', (s) => s.cold[0]], ['steady', (s) => s.steady]]) {
      console.log(`    ${what}, each lead by the predecessor it ran after, rounds in brackets`);
      const rows = names.flatMap((n) => got[n].map((s) => ({ round: s.round, unit: n, prev: s.prev, v: pickOf(s) })));
      for (const line of leadsByPredecessor(rows, names, names.slice(1).map((n) => [n, names[0]]), 2)) console.log(`  ${line}`);
    }
  }
}
await browser?.close();
process.exit(0);
