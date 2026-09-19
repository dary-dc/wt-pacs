// One decoder in one worker. It loads the fixtures itself, so dispatching a frame costs a
// message carrying two integers rather than a copy of the codestream — otherwise the policy
// that posts earlier is charged for copies rather than for its dispatch.
// docs/decode/README.md §Dispatch.
import { parentPort, workerData } from 'node:worker_threads';
import { instance, loadFixture } from './decoder.mjs';

const decoder = await instance();
const sets = Object.fromEntries(workerData.sets.map((n) => [n, loadFixture(`lab/fixtures/decode_${n}`)]));
const { id } = workerData;

parentPort.postMessage({ kind: 'ready', id });

parentPort.on('message', (msg) => {
  if (msg.kind === 'stop') {
    process.exit(0);
  }
  // hrtime is CLOCK_MONOTONIC and process-wide, so these stamps share the main thread's axis.
  const startedNs = process.hrtime.bigint();
  const pixels = decoder.decodeInPlace(sets[msg.set].frames[msg.at]).slice();
  const doneNs = process.hrtime.bigint();
  parentPort.postMessage(
    { kind: 'done', id, seq: msg.seq, startedNs, doneNs, bytes: pixels.buffer },
    [pixels.buffer],
  );
});
