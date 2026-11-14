# Optimal quality

Last verified 2026-11-14 against `claude/unified-client` `e5b20cba` and `claude/direction`'s line doc of 2026-11-12.
The product: [`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The product. The client's side of the design:
[`../client/design.md`](../client/design.md); the contract: [`../av1/payload-format.md`](../av1/payload-format.md)
§Optimal quality, §Depth cut, §Source fingerprint; the page: `client/README.md` §Optimal quality, exact on request.

## Goal

Every reader sees a series' optimal-quality AV1 view, and a Lossless request brings that frame whole from its exact
HTJ2K series; no residual, no server or wire change.

## In flight

* **On `claude/unified-client`**, with the client line: the pairing, the label, WebCodecs first, the depth cut, the
  pair served by the web image's `--profile pair`; 40 of 40 on the demo commit under both views
  ([`../reviews/freeze-e2e.md`](../reviews/freeze-e2e.md)). The product ingest does not code optimal quality yet.
* **The integrity and coding-error check** (#368, behind one switch, off by default): its review's findings unfixed —
  a refused frame leaves the previous green mark; three `decoder.js` mutants survive the gate; no `demo-check.mjs`
  check per label state; the coding-error test compares the wrong σ; the first picture's +7.8 % at 1× not weighed
  (`claude/oq-integrity-build:docs/reviews/oq-integrity.md`). Until it ships, the green mark claims a check nobody ran.
* **The product ingest writes the pair**, a design only (`claude/ingest-oq:docs/reviews/ingest-oq.md`): the Rust
  ingest's second phase with `aomenc` as a subprocess, held by a parity test; found: signed sources over 10 bits
  have no form on the product path, and `pairOf` refuses ids with `~`.
* **The two failures the phone found** ([`client.md`](client.md) §In flight); the first breaks this line's promise on a
  lossy link.
* **Is Q 8 visually lossless at the readers' windows**: owned by [`codecs.md`](codecs.md); readers decide, no agent.
* **Narrow windows show the coding error most**: an automatic exact request at a narrow window is an option to
  compare, its threshold set by readers.
* **Tiles**: AV1 tiles wait (2×2 not ready by their rule); HTJ2K at the screen's resolution is [`codecs.md`](codecs.md)'s.
* Two `demo-check.mjs` mutants that ask a group ahead survive, cause not traced.

## PRs

| PR | what | state |
| --- | --- | --- |
| #368 | the integrity and coding-error check | draft; the owner's |
| #358 | the proposals' rounds (`claude/proposals`) | draft |
| #359 | the phone protocol's second amendment, not on the tip | draft; reaches `main` only if carried |
| #340, #350, #356, #360–#365 | stale drafts; the tip carries #356 and #360–#365 | open; closes are the owner's |

## Owed runs

The next phone round ([`client.md`](client.md) §Owed runs), its link calibrated and its theory first; #368 on a phone;
the coding error converted to display levels at the current window, against the quality study's rows.

## Waits for the owner

Taking #368 and its open choices (the unchecked label, block or paint, the mask); which ingest writes the pair, the
signed gap, where Q and G come from, whether the PCS may code optimal quality; the phone run's reading (which stands,
and whether `bbr`'s two failures withdraw it); any merge, close or removal.

## Pointers

`client/viewer/{pair.js,screen.js,demo-check.mjs}`, `ingest/coded-frames/ingest.py`, `scripts/demo-series.sh`,
`server/dev-server.py`, `deploy/README.md` §Run it, README §Demo; [`../devices.md`](../devices.md) §7 and §8;
[`../glossary.md`](../glossary.md); `docs/reviews/` (freeze-e2e, e2e-3, demo-e2e-2, demo-tests-mobile, demo-redteam,
demo-blind); `claude/phone-rows:docs/phone-rows/`; `claude/proposals:docs/lines/proposals.md`;
`claude/merge-plan:docs/reviews/merge-plan.md`.
