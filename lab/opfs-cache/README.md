# opfs-cache

Firefox driven over Marionette on an Xvfb display (`DISPLAY`, `FIREFOX_PATH`), and a static host of the repository:
`browser.mjs`, which `client/paint/settle-check.mjs` uses. Not over WebDriver BiDi, whose session hangs a worker
that starts a worker ([`frame-path.md`](../../docs/adr/frame-path.md), *Firefox's fills that never start*).
`browser.test.mjs` checks the driver, live with `FIREFOX_PATH`.

The client cache's cells M1–M5, which [`docs/adr/frame-path.md`](../../docs/adr/frame-path.md) §Proposed
pre-registers and where their numbers and verdicts are, ran on the harness at
[`claude/core-fold-2026-11-02@0920153d`](https://github.com/dary-dc/wt-pacs/tree/0920153d2a44916c6832a9d8dd0befabc0923681/lab/opfs-cache),
not in this tree; M5's rows are at
[`claude/core-m5@91069eb3`](https://github.com/dary-dc/wt-pacs/tree/91069eb31e8816bcd4460322e38e8f719a5c0c07/lab/opfs-cache/rows).
