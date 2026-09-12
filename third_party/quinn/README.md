# quinn 0.11.11, one change

The crates.io `quinn` 0.11.11 sources, examples, tests and benches removed, with one change
in `src/connection.rs`: the segments per `sendmsg` are derived from the MTU (44 at 1452 bytes,
under the kernel's 65 527-byte GSO payload) instead of the constant 10, and the driver sends up
to 64 datagrams per poll instead of 20. Why, and what it measured:
`docs/transport/why-these-changes.md` §9.

The workspace `[patch.crates-io]` points every `quinn` dependency, wtransport's included, here.
Refreshing: copy the new upstream sources over `src/`, re-apply the `max_transmit_segments`
hunk, and re-measure.
