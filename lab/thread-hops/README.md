# thread-hops

Prices the thread hops a decoded frame crosses on its way to the page. No transport and no
decoder: the decode worker posts buffers of the decoded sizes. Write-up and results:
[`docs/thread-hops.md`](../../docs/thread-hops.md).

```bash
npm install -g playwright                     # browsers are pre-installed; do not re-fetch them
export NODE_PATH="$(npm root -g)"
export CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome   # if playwright's pin differs

node run.mjs "?rounds=9&burstRounds=0"                    # regime 1: one frame, threads idle
node run.mjs "?rounds=0&burstRounds=5&linkPerTick=24"     # regime 2: 237-frame burst under load
OUT=/tmp/x.json node run.mjs "?rounds=0&burstRounds=5"    # also dump the per-cell rows as JSON
```

`run.mjs` starts `server/dev-server.py`, which is what serves the page cross-origin isolated;
the page refuses to run the shared arm without it.

| query | |
| - | - |
| `rounds` / `burstRounds` | rounds of regime 1 / regime 2 |
| `arm` | one of `relay-push relay-pull direct-push direct-pull shared cloned` |
| `linkChunk` / `linkPerTick` / `linkEveryMs` | the read-loop stand-in's load |
| `mutate=shared-transfer` | put the `SharedArrayBuffer` in a transfer list; the page must fail |
| `mutate=b-relay` | route the direct arm through the receive worker; its numbers must become relay's |

The two mutants are the check that the arms differ for the reason claimed — run them after any
change to the workers.
