// One Node process's share of a SPEED round; speed.mjs spawns it and throttles its threads.
//   node lab/av1/decode/per-frame/node-run.mjs '{"base":…,"frames":…,"variants":[…],"round":N}'
import { MessageChannel, Worker } from "node:worker_threads";
import { round } from "./drive.js";

const shim = new URL("./node-worker.mjs", import.meta.url);
const env = { worker: () => new Worker(shim), channel: () => new MessageChannel() };
console.log(JSON.stringify(await round(env, JSON.parse(process.argv[2]))));
process.exit(0);
