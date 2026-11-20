# One place for the demo series and the fixtures

Findings only (queue row DATASET-HUB, 2026-11-11); nothing built, nothing uploaded. Every session that needs the demo
series today fetches the sources from IDC and codes them again. This weighs one shared place for the coded sets that
cloud and local sessions both read. The owner's local data is never a candidate: a set enters the place only if its
recipe (§1) resolves to pinned public sources.

Fixtures and limits behind the figures here: the three timed DBT volumes `dbts_a1`, `dbts_b1`, `dbts_c1` (EA1141,
one dataset), their 23 demo series, and 4-core cloud hosts without a GPU.

## 0. What is coded again today, and what it costs

| what | where it comes from now | size | time to make |
| --- | --- | --- | --- |
| sources, 88 sets | `lab/av1/fetch_data.sh` from IDC's public bucket (85) and two Zenodo records (3), every file pinned by SHA-256 in `lab/av1/data.json` | ~12.1 GB fetched ([`FIXTURES.md`](../FIXTURES.md) §AV1 data) | a download; not timed here |
| codec tools | `ingest/tools.sh`: libaom 3.15.1 (tarball SHA-256), dav1d 1.5.4 and OpenJPH 0.31.0 (tag and commit) | `ingest/.build/` | a build; not timed here |
| demo series, 23 | `scripts/demo-series.sh` over the three DBT sources | 368 MB; the six bundles README §Demo shows, 208 MB (`claude/phone-no-install:README.md`) | 637 s and 689 s on 4 cores (queue rows MEASURE-1, E2E-3) |
| synthetic sets | `lab/scripts/gen_*.sh` | small | seconds to minutes |

The sources already have one place: IDC's bucket, pinned per file. Synthetic sets are cheap and need no host. What
is coded again in every session is the **demo series** (about 11 minutes and a tool build each time), and the lab's
coded arms (MEASURE-1 reruns ~15 min of encodes). The hub is for coded sets; the sources stay fetched from IDC.

## 1. The key: a recipe, and the bytes it gave

A coded set is decided by:

* **the source**: the set's `frames_sha256` in `lab/av1/data.json` (the download pin), and the series'
  `sourceFingerprint` (XXH3-64 of its frame digests, [`glossary.md`](../glossary.md));
* **the tools**: `ingest/tools.sh`'s pins (libaom version and tarball SHA-256, dav1d and OpenJPH tag and commit);
* **the code that writes the bytes**: the git tree hashes of `ingest/coded-frames/`, `lab/av1/tools/ingest_coded.py`,
  `common/series-bundle/` and `tools/pack-series/` (tree hashes, not a commit: a commit moves for unrelated changes);
* **the parameters**: codec, Q, G, depth cut, preset (`scripts/demo-series.sh`'s `series()` line).

Proposed: the **recipe** is that list as canonical JSON, its SHA-256 the set's key; a pin file in the repository maps
each key to the bytes it gave (per file: name, bytes, SHA-256) and to its location. The pin, not the host, is the
integrity check, the pattern `fetch_data.py` already uses: a file that does not match is refused. So the host can be
untrusted and mutable; only availability depends on it.

**Reproducibility is assumed, not shown across hosts.** What exists: `lossy_test.py` checks the same bytes at
`--jobs 2` and `3`; libaom's head wrote the same bytes as 3.15.1 on 11 series (`docs/av1/queue.md` row 57); E2E-3's
run matched DEMO-E2E-2's **byte counts** (not digests), both on 4-core cloud hosts. Not shown: the same digests on
another CPU (the owner's laptop, another SIMD level or architecture). It decides whether a session can check a hosted
set by coding one series again (cheap A/A) or must trust the pin alone. Deciding measurement: `scripts/demo-series.sh`
on two different hosts, SHA-256 of every bundle compared, 23 of 23 or the first that differs named.

A code change that alters the bytes changes the key (SOURCE-FINGERPRINT rewrote every demo series' metadata, so FIX-2
coded them all again). Old keys stay valid for the commits that made them.

## 2. Where to host it

| option | limits and cost (quoted) | integrity | who can write it | fetch |
| --- | --- | --- | --- | --- |
| **A. release assets** on this public repository | "Each file included in a release must be under 2 GiB. There is no limit on the total size of a release, nor bandwidth usage." [R1] | the pin; assets can be replaced or deleted | a token with "Contents" repository permissions (write) [R2] | `curl -L` |
| **B. Git LFS** in this repository | GitHub Free: 10 GiB bandwidth, 10 GiB storage; over the bandwidth without a payment method "Git LFS support is disabled on your account until the next month" [R3] | LFS pointers carry a SHA-256 | `git push` with LFS | `git lfs`, or a clone with smudge |
| **C. container registry** (public OCI artifact) | "GitHub Packages usage is free for public packages" [R4]; "a 10 GB size limit for each layer" [R5] | by digest, built in | a token that writes packages | `podman pull` (on the laptop), or `curl` against the registry API |
| **D. Zenodo** record | "up to a 100 files and a total volume of 50GB"; after 30 days a change needs "a new version of the record" [R6] | immutable versions; a DOI per version | a Zenodo account | `curl -L` |
| **E. a dataset repository on a model hub** | free accounts: public storage "Best-effort", "mitigations in place to prevent abuse of free public storage" [R7] | content-addressed storage | a hub account | `curl -L` |
| **F. a paid bucket** | storage and egress billed by the provider (not priced here) | the pin | a cloud account | `curl` |
| **G. none** (today) | ~11 min of 4 cores and a tool build per session | the code itself | — | — |

Ruled out: **plain git**. "GitHub blocks files larger than 100 MiB" [R8], and the exact bundles of `dbts_b1` and
`dbts_a1` are 107.4 MB and 67.8 MB; every key would also stay in every clone's history.

What decides between them:

1. **Who writes.** The sets are made in cloud sessions, which today can push git and nothing else to GitHub (their
   GitHub tools list and read releases, none upload). A, C and D need a write token the owner issues; with it stored
   as a network secret on the sessions' environment (scoped to the upload host), a session can upload what it coded.
   Without it, the owner uploads from a machine that has the files. B is writable by `git push` but meters reads.
2. **Reads per month.** One full fetch is 368 MB; B's 10 GiB of monthly bandwidth is about 27 of them, then LFS stops
   for the account. A and C meter nothing for a public repository or package.
3. **Fetch without installs.** The laptop has curl and podman, no LFS or OCI client (PHONE-NO-INSTALL's inventory):
   A, D, E by curl; C by `podman pull` of an image that holds the files, or by curl.
4. **Reachable from the sessions.** From this cloud session, `github.com`, its release-download host, the container
   registry, Zenodo, the model hub and IDC's bucket all answered through the proxy (2026-11-11). An environment with a
   restricted network must allow the chosen host.
5. **Citable and frozen.** Only D gives a DOI and frozen versions, which a published result would cite; the demo
   series churn with the code (§1), which D's 100-file, version-per-change model suits least.

**Leading option: A**, release assets on this repository, one release per key (tag `sets-<key prefix>`), each
bundle and its metadata an asset, and a pin file in the repository naming them. It is free at any read volume, needs
only curl, sits beside the code, and holds 2 GiB a file against a 107 MB largest bundle. Its weakness, mutable assets,
is answered by the pin. **D** is the choice for a frozen set a result must cite. **C** is the alternative if
digest-addressed storage is wanted without a pin file. Each tag added is a tag never deleted (the standing rule), so
releases accumulate; at 368 MB a key that is storage on GitHub's side, not the repository's clone size.

## 3. Licences

84 of the 88 sets are CC BY 4.0, four CC BY 3.0 (`lab/av1/data.json`); the demo's three are EA1141, CC BY 4.0, DOI
10.7937/2bas-hr33. CC BY 4.0 licenses to "produce, reproduce, and Share Adapted Material" [R9]; a coded series is
adapted material, and sharing it requires to "indicate if You modified the Licensed Material and retain an indication
of any previous modifications; and indicate the Licensed Material is licensed under this Public License, and include
the text of, or the URI or hyperlink to, this Public License", satisfiable "by providing a URI or hyperlink to a
resource that includes the required information" [R9]. TCIA's policy: every dataset's "Data Citation which includes a
persistent Digital Object Identifier (DOI) that must be cited or attributed any time the data are used" [R10]. So each
release carries a notice: the collection, its DOI citation, the licence link, and the modification (the recipe: coded
as AV1 at Q, G, depth, or HTJ2K reversible). The CC BY 3.0 sets' terms are not quoted here; check them before any of
those four is hosted. The breast ultrasound sets are lossy-sourced Zenodo records, CC BY 4.0 (`data.json`).

## 4. How a session finds and fetches a set

Proposed, not built: `scripts/demo-series.sh` computes the recipe key of each series it would code; if the pin file
names it, it fetches the files and checks each SHA-256 (refusing a mismatch, as `fetch_data.py` does), else it codes
as today and prints the pin lines a writer would add. Nothing changes for a session that has no network to the host.
`lab/av1/fetch_data.sh` stays as it is: the sources are already one place.

## Open

* The cross-host reproducibility measurement (§1).
* Whether the owner issues a write token for A (or C, or D), and to whom: that decides whether sessions populate the
  hub or the owner does.
* The pin file's name and home: one name, one row in [`glossary.md`](../glossary.md) (proposed: **set pin**,
  beside the source pin `data.json`).

## Sources (read 2026-11-11)

* [R1] GitHub Docs, *About releases*, §Storage and bandwidth quotas — docs.github.com/en/repositories/releasing-projects-on-github/about-releases
* [R2] GitHub Docs, REST API, *Release assets* — docs.github.com/en/rest/releases/assets
* [R3] GitHub Docs, *Git Large File Storage billing* — docs.github.com/en/billing/concepts/product-billing/git-lfs
* [R4] GitHub Docs, *GitHub Packages billing* — docs.github.com/en/billing/concepts/product-billing/github-packages
* [R5] GitHub Docs, *Working with the Container registry*, §Troubleshooting — docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
* [R6] Zenodo Docs, *Manage files* — help.zenodo.org/docs/deposit/manage-files/
* [R7] Hugging Face Hub docs, *Storage limits* — huggingface.co/docs/hub/storage-limits
* [R8] GitHub Docs, *About large files on GitHub* — docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
* [R9] Creative Commons, *Attribution 4.0 International, legal code*, §2(a)(1)(B), §3(a)(1)–(2) — creativecommons.org/licenses/by/4.0/legalcode.en
* [R10] The Cancer Imaging Archive, *Data usage policies and restrictions* — cancerimagingarchive.net/data-usage-policies-and-restrictions/
