# TODO

- [ ] **Clean the docs down to the essential, and remove what is cut from history.** The repository is
  essentialist: a doc that is not needed to run, change or trust the code is not committed or maintained.
  1. Inventory `docs/`: keep what owns a subject (the proposals, `decode/README.md`, `transport/`, `rig-limits.md`,
     the ADRs); mark dated narrative for removal (handoffs, per-day improvement logs, lane briefs, finished
     parallel-work plans, the cloud queue's finished rows).
  2. Fold every claim that is still true and still needed into the doc that owns its subject; a retracted
     claim stays corrected in place there (`CLAUDE.md` §Docs).
  3. Delete the rest, and fix every link that pointed at it.
  4. Rewrite history so the removed files are gone from every commit (`git filter-repo --path … --invert-paths`),
     then force-push. This rewrites a public repository: do it only when no cloud agent is working, with every
     other clone and branch (the cloud queue's, the workstation's lanes) rebased or re-cloned afterwards, and
     the private-term scanner run over the result.
