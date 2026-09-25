# TODO

- [ ] **Clean the docs down to the essential, in one cleaning commit.** The repository is essentialist: a doc that is not
  needed to run, change or trust the code is not kept or maintained. History stays as it is.
  1. Inventory `docs/` against the keep list the owner approves: what owns a subject (how to run it, the wire, the
     clients, the fixtures, the ADRs, the architecture, what the transport and the decoder measured and chose, what the
     measurements cannot claim, the live cloud queue).
  2. Fold every claim that is still true and still needed into the doc that owns its subject; a retracted claim stays
     corrected in place there (`CLAUDE.md` §Docs). Keep a fold map (which file went where) in the commit message body.
  3. Delete the rest in the same commit, and fix every link that pointed at it. The private-term scanner over the result.
  Do it when no cloud agent is working the queue.
