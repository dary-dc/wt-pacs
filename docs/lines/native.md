# Native

Last verified 2026-11-14 against `claude/unified-client` `e5b20cba` and `claude/direction`'s line doc of 2026-11-12.
The product: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product. The native design, its decisions and results:
[`../native/README.md`](../native/README.md) (§6 the measurements and their results, §7 the decisions), [`../native/quic.md`](../native/quic.md);
the browser client's design it mirrors: [`../client/design.md`](../client/design.md); the results folded 2026-11-14:
[`../client/evidence/native-client-milestones.md`](../client/evidence/native-client-milestones.md),
[`native-window-against-browser.md`](../client/evidence/native-window-against-browser.md),
[`native-client-parity.md`](../client/evidence/native-client-parity.md). Its decisions: the README's §7.

## Goal

A native client without the browser's limits, for HTJ2K and AV1, computers first and phones last, that earns its place
only where it beats the browser on a measurement.

## In flight

* **`client/native/`** rides `claude/unified-client` to `main` through #367 then #250 (the owner's word). It is not
  served by the image nor used by the page. Fresh cloud sessions skip the gate's lavapipe and Xvfb steps by name.
* **Lab settings inside the product window**: `window.rs` carries `--cine-hz`, `--busy-ui-ms`, `--steps`,
  `--steps-via`, `--stamp-painted` (off by default), and `count.rs` stamps every hop always; the cleaning rule says no
  lab code in product modules. Owed: an inventory of each setting and its move (a lab example or a `lab` feature) as
  a draft PR; the owner's yes before any removal.
* **Keep the crate on `main`, or off until the shape is decided**: the owner's; removing it touches the workspace, the
  lockfile, the image, the server's `wt-pacs/1` ALPN and the gate.
* **Seen, not traced**: in a `view` cine run with `--check` each frame was decoded twice; a failed cache write still
  marks the frame written. Theory first, then a failing test.

## PRs

| PR | what | state |
| --- | --- | --- |
| #367, #250 | the demo tip, then `claude/core`, into `main` | open; the owner's word |
| #277, #278 | parity with the browser's display controls and cine; the window timed against the browser (interim) | on `claude/core-fold-2026-10-30`, unreviewed as product |
| #211 | step 1's lab check behind the relay (`claude/native-core-2`) | open; run 2026-10-28, a tie ([`../client/evidence/native-client-wire-parity.md`](../client/evidence/native-client-wire-parity.md)); whether a tie closes step 1 is the owner's |

## Owed runs

* **The view-worker design natively**, pre-registered in [`../native/README.md`](../native/README.md) §The comparison
  and never run: owed the runner (a Williams square with an A/A arm, the relay cells, 1-core pinning, the `/proc`
  saturation guard, `VmHWM`) and the synthetic 3328 × 4096 series; a build, then the run by a session that wrote
  neither.
* **The fill on one Android phone** against Chrome on the same phone, after the ARM decoder port
  ([`../decode/README.md`](../decode/README.md) §Not yet tried); its inputs the phone session's runner and the phone
  run's link profile. The iOS stage runs only if it shows a gain the browser lacks.
* **The painter's proof and the fill on a GPU desktop** (the owner's machine): the first numbers that are not software
  rendering.
* **Transport** ([`../native/quic.md`](../native/quic.md) §6): which native clients reach the server; the macOS receive
  path (no Apple hardware here).

## Waits for the owner

Any merge, close or removal (the lab settings, the crate, #277, #278, #211); [`../native/README.md`](../native/README.md)
§7's open decisions (the cache's policy, the intended use with a regulatory specialist, distribution); a toolkit or a
transport choice; the crate's workspace membership.

## Pointers

`docs/native/` (`README.md` §§2–8, `quic.md`, `quic-compared.md`), `docs/WIRE.md` §The raw QUIC mapping,
`docs/glossary.md` (native cache, paint thread, credit, hop, `wt-pacs/1`), `lab/window-harness`, `scripts/gate.sh`'s
native steps, `README.md` §Prerequisites; `claude/demo-clean:docs/reviews/experiments-off.md` item 10,
`claude/merge-plan:docs/reviews/merge-plan.md` §4, `claude/lines-ready:docs/reviews/lines-ready.md` §7.
