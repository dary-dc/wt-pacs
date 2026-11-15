// node lab/report-arms/levers.test.mjs — the engine-free levers: the process tree finds every descendant of the
// browser the rig spawned and kills the one whose command line matches (Firefox's tab, WebKit's WebProcess); the
// relay's blackout reaches its control port as the datagram link_impair.py reads.
import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import { descendants, killMatching, blackout } from "./levers.mjs";

let failed = 0;
const check = (ok, what) => ok || (failed++, console.error(`FAIL ${what}`));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (f, ms = 3000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await new Promise((r) => setTimeout(r, 20)); return f(); };

// fake-tab two levels down, as a browser's tab under its zygote; fake-gpu one level down.
const root = spawn("bash", ["-c", "bash -c 'bash -c \"exec -a fake-tab sleep 30\"; true' & bash -c 'exec -a fake-gpu sleep 30' & wait"]);
await new Promise((r) => setTimeout(r, 300));
const tree = descendants(root.pid);
const tab = tree.find((p) => p.cmd.startsWith("fake-tab"));
const gpu = tree.find((p) => p.cmd.startsWith("fake-gpu"));
check(tab && gpu, `both grandchildren found in the tree: ${JSON.stringify(tree)}`);
check(descendants(root.pid).every((p) => p.pid !== process.pid), "the tree holds no process outside it");
const killed = killMatching(root.pid, /^fake-tab/);
check(killed.length === 1 && killed[0] === tab?.pid, "only the matching process is killed");
check(await until(() => !alive(tab.pid)), "the tab is gone");
check(alive(gpu.pid) && alive(root.pid), "its siblings and the browser live");
check(killMatching(root.pid, /^nothing/).length === 0, "no match kills nothing");
root.kill("SIGKILL"); process.kill(gpu.pid, "SIGKILL");

const udp = createSocket("udp4");
await new Promise((r) => udp.bind(0, "127.0.0.1", r));
const got = new Promise((r) => udp.once("message", (m) => r(String(m))));
await blackout(udp.address().port, 30000);
check((await got) === "blackout 30000", "the blackout datagram as link_impair.py reads it");
udp.close();

if (failed) process.exit(1);
console.log("report-arms: the process-tree kill and the relay's blackout hold");
