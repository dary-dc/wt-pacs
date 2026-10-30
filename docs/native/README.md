# Native client — the plan

*Queue row 127, NATIVEPLAN, 2026-10-11. Theory only: read from sources, nothing built, nothing timed. The plan for
the owner; every choice in it is the owner's (§7).*

**The question.** What else does a native viewer need beyond its transport ([`quic.md`](quic.md)) and its decoders
([`../decode/README.md`](../decode/README.md) §Not yet tried), and how is it measured? Desktop is the first target
because it is easier to start there; phones are the goal (the owner, 2026-10-10).

## Contents

1. [The plan in plain words](#1-the-plan-in-plain-words)
2. [Paint](#2-paint)
3. [The cache](#3-the-cache)
4. [App shape](#4-app-shape)
5. [Costs](#5-costs)
6. [The measurement plan](#6-the-measurement-plan)
7. [The owner's decisions](#7-the-owners-decisions)
8. [The headless core on raw QUIC: the design](#8-the-headless-core-on-raw-quic-the-design)
9. [Sources](#9-sources)
10. [The view-worker design, native (2026-10-29)](#the-view-worker-design-native-2026-10-29)

## 1. The plan in plain words

* **One Rust core** — transport (quinn, [`quic.md`](quic.md)), decode (OpenJPH and dav1d, native), the exactness
  check, the cache and the paint — **with a thin native interface per platform**, is the only shape that keeps the
  GPU painter and the transport in one codebase on all five targets (§4). It is what the server is written in and
  what row 126 recommends for ingest ([`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site).
* **Paint carries over unchanged in principle.** The browser's painter uploads 16-bit samples to an integer texture
  and windows them in a shader ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Paint). The same `R16Uint` texture needs
  no optional feature on any wgpu backend, and no API filters integer textures, so the in-shader bilinear and the
  1:1 proof against the CPU reference port as they are (§2).
* **The cache is the native app's clearest gain and its new liability.** A file system has no browser quota and no
  Safari 7-day deletion, but the app then owns quota, eviction, crash safety and encryption at rest, and a persistent
  cache of images on a device brings HIPAA's and GDPR's at-rest duties into the client (§3, §5).
* **Speed is not yet a reason.** WebTransport now ships in every major engine, Safari and iOS 26.4 included
  ([`../CLIENTS.md`](../CLIENTS.md)); the native case on speed rests on the browser's receive cost (≈ 9.8 ms per MB,
  [`../rig-limits.md`](../rig-limits.md) §1) and on native decode, neither measured natively yet. At 20 Mbit the wire,
  not the receiver, is the clock (§1 of that file), so on the target link a native client is predicted to tie on fill
  time. §6 measures that before anything is built for a phone.
* **Regulation does not change with the platform; the gates do.** FDA's policy is "independent of the platform"
  and the MDR classifies software "regardless of the software's location". What an app adds is the app stores'
  medical rules, a list of supported devices to validate, and a patch channel the maker runs (§5).
* **Nobody has done this in the open.** The open-source desktop viewers are Java (Weasis), Objective-C (Horos) and
  Qt/C++ (3D Slicer, AlizaMS); dicom-rs has no viewer; no established open-source native mobile DICOM viewer was
  found.

## 2. Paint

**The format.** wgpu 30.0.1 offers `R16Uint`, `R16Sint`, `R16Float` with no feature, and `R16Unorm`/`R16Snorm` only
behind `TEXTURE_FORMAT_16BIT_NORM`, a native-only feature (on GLES it needs `EXT_texture_norm16`). Integer formats
are not filterable in wgpu, WebGPU, Vulkan's mandatory format table, Metal's feature tables or D3D12, so the browser
painter's choice — integer texture, bilinear in the shader — is the only one that keeps the samples exact and is the
same on every backend. `R16Unorm` would add a feature gate, a float conversion and a new proof.

**Size and upload.** A 4096×3072 grey frame fits wgpu's default 8192 limit and every first-class backend (D3D12 16 384,
Metal ≥ 8192); the `downlevel_*` limits cap textures at 2048 and must not be requested. *Corrected 2026-10-28:* RGB
uploads as three texels a pixel (`R8Uint`, wgpu has no three-channel format), so an RGB row past 2730 px broke the
default limit and wgpu panicked. The painter requests the adapter's own limits and refuses a frame over them by name. `write_texture` needs no
256-byte row padding, but allocates a staging buffer per call, so a stream of frames should use `StagingBelt` or its
own mapped buffers (not measured). The browser's upload was 5.70 of 5.74 ms of a 12.58 Mpx paint (§Paint): the
upload is still the thing to attack natively.

**Backends.** Vulkan on Linux, Windows and Android; Metal on macOS and iOS; D3D12 on Windows; GLES 3.0+ best-effort.
GLES 3.0 has no compute shaders, so the WGSL HTJ2K block decoder ([`../decode/README.md`](../decode/README.md)
§Not yet tried, item 7) needs Vulkan, Metal, D3D12 or GLES 3.1+. The WGSL runs through naga, which publishes "no
concise summary" of where it departs from the WebGPU spec: compiling each shader is the check. Painting from the
device that decoded drops the read-back the browser paid.

**More than 8 bits to the screen.** wgpu 30 offers `Rgb10a2Unorm` surfaces and HDR colour spaces on Metal, D3D12 and
Vulkan where the driver lists them, and Windows 11 22H2 documents 10-bit SDR. No source shows ten grey bits arriving
intact at a medical display on any OS, and the ACR–AAPM–SIIM technical standard (rev. 2022) finds no diagnostic
benefit of 10-bit over 8-bit. Unproven until a panel is measured; not a reason to go native.

**Headless.** wgpu's own CI runs its GPU tests on Mesa lavapipe (Linux) and WARP (Windows). *Was:* "whether lavapipe
runs in this container is unknown". It does, once `mesa-vulkan-drivers` is installed (§6, M1).

## 3. The cache

Where a frame cache belongs, and whether the OS takes it back:

| OS | place | evicted by the OS | note |
| --- | --- | --- | --- |
| Linux | `$XDG_CACHE_HOME` | not in the spec | |
| Windows | `%LOCALAPPDATA%` | not documented | |
| macOS | `~/Library/Caches` | unknown | |
| iOS | Application Support + `isExcludedFromBackup` (set again on every save) | Caches can be purged when space is very low, never while the app runs | encrypted by default (Data Protection class C); class A (`complete`) locks the cache ~10 s after the device locks, which stops a background prefetch |
| Android | `getFilesDir` | `getCacheDir` is deleted oldest-first under a moving quota and "designed to store a small amount" | file-based encryption on Android 10+ |
| browser (today) | OPFS | best-effort unless persisted; ≈ 60 % of disk per origin (Chrome, Safari), 15 % in a web view; Safari deletes script-written storage after 7 days without interaction (30 operating days in the source's default, [`../adr/frame-path.md`](../adr/frame-path.md) §4) | not built ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open) |

**What a cache must do on any OS**, from the exactness ADR ([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md)
§8, *A client cache*): hold only frames whose check is `true`, never key by digest, and re-check on read. From the
file systems: write to a temporary name and rename (atomic on POSIX; Linux also needs the directory fsynced; Apple
needs `F_FULLFSYNC` for durability; Windows' replace atomicity is unknown); a memory-mapped reader must survive a
truncated file (`SIGBUS`); every read must tolerate a missing file. *Decided 2026-10-28 (M3):* **a file per
frame**, because the rename that makes one frame's write atomic is then the whole write path; a packed file per series
needs an index of its own, kept crash-consistent with the frames, and a reader of offsets into a file that can be
short. The native cache reads with `read`, not a memory map, so `SIGBUS` does not arise; a short or damaged file fails
its re-check like any other.

**The other side.** AAPM Report 260 on handheld viewers recommends leaving no persistent data on the device. HIPAA's
technical safeguards (45 CFR 164.312) make audit controls required and encryption at rest and automatic logoff
"addressable"; a proposed revision (published 2025-01-06) was not read. GDPR Art. 32 asks for security appropriate to
the risk. A page's storage is evictable by default; an app's cache stays until the app removes it.

## 4. App shape

| shape | covers Linux, macOS, Windows, Android, iOS | the Rust core | the wgpu surface | licence · maturity | cost to keep |
| --- | --- | --- | --- | --- | --- |
| **Rust core + native UI** (SwiftUI/UIKit, Compose, a desktop UI) | yes | UniFFI to Swift and Kotlin (Firefox mobile, Element X); async maps to `async`/`suspend`; **no cancellation** — the prefetch needs its own cancel channel | the UI hands the core a `CAMetalLayer` or `ANativeWindow` through `raw-window-handle` | UniFFI MPL-2.0, pre-1.0, a minor every 3–8 months | one core, N interfaces; native accessibility |
| **pure-Rust GUI**: egui/eframe · iced · Slint | egui: no iOS; iced: no mobile, "experimental"; Slint: all five (iOS in Rust only) | native | wgpu (egui, iced); Slint behind `unstable-wgpu-*` | egui MIT/Apache, AccessKit on Windows and macOS only; Slint GPLv3, royalty-free with a disclosure, or commercial | one codebase; accessibility thin on mobile |
| **Qt 6.12** | yes | CXX-Qt (C++ ABI) | QRhi (`QQuickRhiItem`), a private API with no compatibility guarantee; wgpu inside Qt not documented | LGPLv3 or commercial; some modules GPLv3-only | the closest precedent (Slicer, AlizaMS); C++ |
| **Flutter 3.47** | yes | flutter_rust_bridge 2.13 | a `Texture` per platform: D3D11 on Windows, **OpenGL** on Linux, a `CVPixelBuffer` copy on Apple, `SurfaceProducer` on Android | BSD-3; quarterly releases | Dart; five texture paths |
| **Tauri 2** | yes | the app is Rust | the UI is the system web view; a wgpu window under a child web view only on macOS, Windows and X11 — **not Wayland, iOS or Android** | MIT/Apache; updater desktop only | a web UI again |
| Compose Multiplatform | yes (desktop on the JVM) | UniFFI's third-party KMP bindings | iOS: UIKit interop; desktop and Android: not read | Apache-2.0; iOS stable since 1.8.0 (2025-05) | Kotlin; a JVM on desktop |
| .NET MAUI · React Native | **no Linux** | C# or C++ | not read | MIT | fails "desktop first" on Linux |

Rust's iOS and Android targets are Tier 2: guaranteed to build, tests not run by the Rust project, so the core's tests
run on a simulator or device in this project's CI.

* **The smallest shape, built 2026-10-28** (`native-window`, `client/native/src/window.rs`, feature `window`): winit 0.30 and M1's painter on the wgpu surface. It opens a series over `wt-pacs/1`, decodes and checks every frame, steps with the wheel and arrows without wrapping, sets the window by drag, and toggles 1:1 and fitted with F. Under Xvfb on lavapipe, `client/paint/window.mjs` drives it with xdotool over a committed 4-frame grey series (`lab/fixtures/window_grey16`) and one RGB frame (`window_rgb8`), since grey cannot show the surface's channel order. All 7 grey 1:1 paints, read back from the surface across the 4 frames, and the RGB one have |Δ| = 0; the fitted one is within 1 code, the bound it is held to, as M1 measured. An off-by-one window fails all 7; a channel swap in the shader or in the read-back fails the RGB paint (|Δ| 76); F ignored fails the fitted one (|Δ| 62).
* **What it took:** 302 lines of Rust plus 40 changed in `paint.rs` so it draws into any texture, and 128 of check. winit brings 37 crates on Linux (92 `Cargo.lock` entries across every target), and `libxkbcommon-x11` at run time. A clean dev build of the crate on 4 cores goes from 56 s to 75–80 s. Only X11 was run; Wayland is built and untried.
* **What it leaves for decision 2:** everything a toolkit or native UI is chosen for — text, menus, layout, accessibility, persistence — and the mobile window, untried. It shows that the core and the painter need nothing from the shape but a surface, so any row of the table can host them.

## 5. Costs

* **Stores.** Apple: 99 USD a year; the 299 USD Enterprise program needs 100 employees and internal use, so it is the
  hospital's, not a vendor's. Google Play: 25 USD once; from 2026-08-31 every update targets API 36. Microsoft: no
  fee. macOS outside the App Store: notarization. Linux: Flathub builds every crate and C/C++ library from source
  offline; AppImage or a package otherwise.
* **The stores' medical rules, which a page never meets.** Apple 1.4.1: medical apps that "could be used for
  diagnosing or treating patients may be reviewed with greater scrutiny", with a link to any clearance; 5.1.1(ix):
  healthcare apps submitted by a legal entity, not an individual; 5.1.3: no health data in iCloud; 2.5.2: no
  downloaded code that changes features (a decoder fetched at run time would be such code). Play: the Health apps
  declaration, a "Medical Device" label with proof of clearance on request, or a "not a medical device" disclaimer.
* **Updates.** Per platform and none shared: Sparkle (EdDSA-signed) on macOS, MSIX App Installer on Windows, AppImage or
  Flatpak on Linux, the stores on phones (Apple's phased release 7 days). A page updates on the next load.
* **Hospital distribution.** Apple custom apps through Apple Business Manager still pass App Review with a demo login;
  managed Google Play private apps reach a hospital's devices in minutes and skip the health declaration.
* **Background work.** iOS: background URLSession runs only the system's HTTP stack, so a QUIC prefetch cannot use
  it (inference); iOS 26's `BGContinuedProcessingTaskRequest` keeps work the user started. Android: a `dataSync`
  foreground service gets 6 hours in 24; user-initiated data-transfer jobs are the recommended path. A page gets none.
* **Medical-device rules.** Neither FDA nor the MDR distinguishes a page from an app: FDA's guidance is
  "independent of the platform" (and counts a mobile-tailored web app as a mobile app); MDCG 2019-11 rev.1 qualifies
  software "regardless of the software's location". Whether this viewer is a device turns on its intended use:
  display "for diagnosis" sits in 21 CFR 892.2050 (class II), while display "directly from a PACS server" and
  display-only functions (§520(o)(1)(D)) are excluded — **a question for a regulatory specialist, not settled here**.
  The app owns more of what is validated: MDR Annex I §17.3 asks software on mobile platforms to account for screen
  size, contrast and ambient light; the one phone precedent read (Mobile MIM, K103785, 2011) limited diagnosis to
  named modalities "when there is no access to a workstation", excluded mammography, and rested on an in-app
  calibration and reader studies; AAPM Report 260 notes that validating one Android device validates none other.
  FDA's cybersecurity guidance (2026-02-03) applies to any software that reaches the internet; an app adds signed
  binaries, an SBOM for what it bundles, and its own patch channel. IEC 62304 and IEC 82304-1 were not read
  (paywalled). A risk note, not legal advice.
* **The team's skills** are the owner's to state ([`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site); the shapes above differ in
  them: Rust plus Swift and Kotlin, C++ (Qt), Dart (Flutter), web (Tauri).

## 6. The measurement plan

**Running the native steps in a stock cloud container** (2026-10-30). Without this, `scripts/gate.sh` skips the native
decode, painter and window steps by name. As root, from the repository:

```bash
apt-get update      # the stock lists have neither libxkbcommon-x11-0 nor meson
apt-get install -y mesa-vulkan-drivers xvfb xdotool libxkbcommon-x11-0 meson
ingest/tools.sh     # 186 s on 4 cores; writes ingest/.build, the gate's default INGEST_BUILD
python3 -m venv .venv && .venv/bin/pip install --require-hashes -r ingest/requirements.txt
PYTHON=.venv/bin/python scripts/gate.sh
```

`ingest/tools.sh` writes to `BUILD`, and the gate reads `INGEST_BUILD`; both default to `ingest/.build`, so set both or
neither (`BUILD=/x ingest/tools.sh`, then `INGEST_BUILD=/x scripts/gate.sh`). The gate finds lavapipe itself
(`/usr/share/vulkan/icd.d/lvp_icd*.json`); a lab run passes it as `VK_ICD_FILENAMES`. With these, `cargo test -p
native-client` (with `--features decode` too), the painter's, decode and view tests and `client/paint/window.mjs` pass
on lavapipe.

Order: **desktop in cloud containers first**, so each row runs unattended; **then a desktop with a GPU** (the owner's);
**then phones**. Every timed row interleaves its arms, prints each arm's full settings (server build, controller and
initial window, relay profile, decoder build) and differs in the lever alone; every frame is checked bit-exact against
the ingest digests. Rows already proposed elsewhere slot in here and are not repeated: [`quic.md`](quic.md) §6 N1
RECVCOST (receive CPU per MB) and N2 NATIVEWT (which native clients reach the server) are the first transport rows;
[`../decode/README.md`](../decode/README.md) §Not yet tried P-ARM goes before any native timing on ARM. New rows,
none queued; each states its predictions and rule before any data and runs in a session given only them:

* **M1 PAINTPROOF — the native painter, exact before it is fast** (container). Port `client/paint/`'s shader to wgpu,
  `R16Uint` with in-shader bilinear, on lavapipe; run the browser painter's 50 exact cells × DPR 1 and 2 against the
  same float64 CPU reference, and its mutants. Predictions: lavapipe initialises in the container (else the row says
  so and moves to a GPU host); |Δ| = 0 in every 1:1 cell; each mutant the browser suite caught is caught here.
  Rule: no native paint is timed before this passes.

  *Run 2026-10-28, this container: passes.* Lavapipe initialises: llvmpipe (LLVM 20.1.2, 256 bits), Mesa 25.2.8,
  Vulkan, after `apt-get install mesa-vulkan-drivers`. The painter is **client/native**'s `paint` (feature `paint`,
  `paint.rs` and `paint.wgsl`). It runs one pass: each of the four nearest samples goes through the window table,
  then the shader does the bilinear and rounds half up. The browser uses two passes because WebGL2 filters its 8-bit
  picture in hardware. Frames above 8 bits upload as `R16Uint`, and a signed sample arrives as its two's complement,
  wrapped by the offset; frames of 8 bits or fewer upload as `R8Uint`, and RGB as three texels a pixel. The table is a
  Rust port of `voi.js`, so it is independent of the reference.

  The cells are the browser suite's own, shared through `client/paint/cells.mjs` (moved out of `check.mjs`, not
  copied). `examples/paint-check.rs` paints them, and `client/paint/native.mjs` compares the result with the same
  `reference.js`. The suite has **54** exact cells, not 50 (15 on each of three grey frames, 9 on RGB).
  * **Every exact cell, 54 × DPR 1 and 2: |Δ| = 0.** The prediction holds.
  * **Fractional cells, reported:** at most 1 code in every one of the 20, at both DPRs, on 0–1.17 % of samples. On
    SwiftShader the browser's are 1–5 codes. Judged against no GPU.
  * **Mutants** (DPR 1, as the browser's), `node client/paint/native.mjs mutants`:

    | mutant | browser, SwiftShader | native, lavapipe |
    | --- | --- | --- |
    | the signed offset dropped | 15 exact cells | 15 exact cells |
    | `NEAREST` for bilinear | 20 fractional cells move | no exact cell; 20 fractional cells, the pan's \|Δ\| 1 → 26 |
    | the window after the filter | 10 fractional cells move | no exact cell; 15 fractional cells, \|Δ\| 1 → 8 |
    | the quad moved by 1/512 px | nothing | 1 exact cell (`u16 half 1:1`), 19 fractional cells move |
    | the rounding turned the other way | `voi.test.mjs` only | 9 exact cells |
    | MONOCHROME1 not inverted | `voi.test.mjs` only | 3 exact cells |
    | LINEAR and LINEAR_EXACT swapped | `voi.test.mjs` only | 42 exact cells |
    | the −0.5 of LINEAR dropped | `voi.test.mjs` only | 35 exact cells |
    | the shader's half-up rounding dropped (new) | — | 24 exact cells |

    Every mutant the browser suite catches is caught here, and so is the one it misses. Its four table mutants reach
    the cells here because the native table is not the reference's. `scripts/gate.sh` runs the 1:1 cells when
    lavapipe and numpy are present, and `paint.rs`'s own tests: LINEAR at width 1 and a signed 16-bit code, which no
    cell reaches, and an RGB row past wgpu's default limit.
  * *Corrected on review, 2026-10-28:* `native.mjs` compared only as many bytes as the reference, so a read-back of
    half the rows passed every cell (mutant run); a short or long paint now fails its cell. The rerun above passes
    with it, and the mutant table is unchanged.
  * **Not ported:** the browser's skipped upload for the same frame and its window pass run only on a window change.
    Every native paint uploads, windows and places, which is M2's to time. The fractional cells on a GPU are the GPU
    desktop's rerun, and so are the exact ones: the shader writes code/255 to `Rgba8Unorm`, and Vulkan says the
    conversion back *should*, not must, round to nearest. Exact on lavapipe, not yet on any GPU.
* **M2 NATIVEFILL — fill time and the ask, native against the browser, one machine** (container). Arms: today's
  browser client (headless Chromium, WASM decoders, the gl painter on SwiftShader) and a lab native client (the
  `lab/window-harness` transport, native OpenJPH, M1's painter on lavapipe). *Corrected 2026-10-27:* the native arm
  is §8's core on raw QUIC and its CLI; `window-harness` speaks WebTransport and stays the lab's WebTransport driver. The lever is the client as a whole;
  server, controller, initial window and relay are one build and printed. Cells: loopback; the relay at 20 and
  50 Mbit, clean and 2 % random loss; a 61 MB and a 4.4 MB series; the ask at depth 1 on 40 ms. ≥ 7 rounds,
  Williams-ordered. Predictions:
  * P1: on loopback the native fill is ≤ 0.6 × the browser's (receive ≈ 9.8 → ≤ 3 ms per MB, quic.md N1's P1, and
    native SIMD decode on x86).
  * P2: at 20 and 50 Mbit the two fills are within ±3 % — the wire binds.
  * P3: the ask at depth 1, 40 ms, is ≤ 0.9 × the browser's on large frames (decode is part of an ask) and within
    ±5 % on 512² frames.

  Rule: if P2 holds and P3 fails, a native client buys nothing on the target link on desktop, and the app's case is
  made on the cache, background work and phones alone; if P3 holds, the gain on large frames is costed for phones by
  M4. Say where the container saturates.

  *Run 2026-10-28, this container (4 vCPU), from this protocol:* [`lab/native-fill/run.py`](../../lab/native-fill/run.py),
  rows in `rows.jsonl` there. M1 passed, so its painter is in.
  * **Arms, every setting printed in each row.** *Browser:* the viewer, `client/viewer/`, in headless Chrome for
    Testing 153 with the TS client, OpenJPH-WASM from the pinned build, and the gl painter on SwiftShader. Its fill is timed
    by the page's own lab hooks (`lab/viewer/levers.js`), from just before the dial to the last frame decoded and
    checked. *Native:* `native-fill` with `decode` and `paint`: OpenJPH 0.31.0 native, and M1's painter on lavapipe
    (llvmpipe, Mesa 25.2.8). It is timed from just before the dial to the last frame checked. Both paint the shown frame
    at the viewer's canvas size, 1280 × 691. *Shared:* one `series-server` build per visit (`cubic-restart`, quinn's
    default initial window, `stream_mode=shared`), restarted fresh and warmed by one unrecorded fill. Both clients grant
    a 6 MiB stream and 15 MiB connection window. Cores: server on 0, relay on 1, clients on 2–3 (every Chromium process
    included).
  * **Series.** Synthetic HTJ2K in the served profile, with digests taken from the generated samples:
    * *61 MB*: 37 × 1024² 16-bit `field`, 60.7 MB.
    * *4.4 MB*: 102 × 512² 8-bit RGB `cine`, 4.42 MB.
  * **Cells.** Relay: `link_impair.py`, 40 ms each way, its 50-packet queue, iid loss at seed 1 (the same pattern
    every visit). The ask runs at 50 Mbit clean, a rate this protocol did not name. In the ask cell each visit asks
    12 frames (61 MB) or 30 (4.4 MB) one at a time, after the opening ask, which is not counted; a visit's figure is
    its median.
  * **The ask, two ways.** *Painted*: the step to the paint done, the figure P3 is read on. *Exact*: the step to the
    frame decoded and checked.
  * **The arms are not symmetric in three ways** (the harness only reads the client; it does not change it):
    * The native core decodes one frame at a time on its receive loop; the browser runs 3 decoder workers.
    * M1's painter reads the whole 1280 × 691 target back; the browser waits on a 1-pixel read.
    * `native-fill` also compares every frame with the bundle.
  * **Rounds and `VOID`.** 7 rounds; 24 units (12 cells × 2 arms), each twice a round (A, A2: the A/A), 48 visits
    Williams-ordered. 336 visits in all. Two `VOID` rules were fixed before the data (the harness commit precedes
    every row):
    * a cell whose A2/A median strays past half its prediction's band: P1 ±20 %, P2 ±1.5 %, P3 ±5 % and ±2.5 %;
    * a visit whose relay p99 is over 1 ms, §8.5's rule. It dropped **126 of 336** visits.
  * **Every frame identical and exact:** 20 692 of 20 692, both arms, against the bundle and the digests. A digest
    flipped in the metadata (the mutant) failed the native visit and left the browser 101 of 102 exact, which the summary counts as failed.

  | cell | measure | native · browser, ms | native ÷ browser [range], n | A/A native · browser | |
  | --- | --- | --- | --- | --- | --- |
  | loopback, 61 MB | fill | 398 · 894 | 0.426 [0.371–0.595], 14 | 1.015 · 1.036 | P1 holds |
  | loopback, 4.4 MB | fill | 309 · 708 | 0.482 [0.388–0.600], 14 | 1.002 · 1.043 | P1 holds |
  | 20 Mbit, 61 MB | fill | 25 468 · 25 542 | 0.996 [0.995–1.000], 5 | 1.001 · 0.999 | P2 holds |
  | 20 Mbit, 4.4 MB | fill | 2 292 · 2 318 | 0.982 [0.971–0.988], 3 | 1.002 · 1.001 | P2 holds |
  | 20 Mbit 2 %, 61 MB | fill | 419 018 · 438 564 | 0.960 [0.918–0.965], 3 | 0.995 · 1.006 | **P2 fails** |
  | 50 Mbit, 61 MB | fill | 11 113 · 11 203 | 0.996 [0.935–1.171], 12 | **1.017** · 1.001 | `VOID` |
  | 50 Mbit, 4.4 MB | fill | 1 377 · 1 431 | 0.960 [0.902–0.978], 10 | 1.002 · **0.983** | `VOID` |
  | 20 Mbit 2 %, 4.4 MB | fill | 32 129 · 34 047 | 0.918 [0.909–1.042], 3 | **1.029** · 0.990 | `VOID` |
  | 50 Mbit 2 %, both | fill | — | one pair each, no A/A | — | `VOID` |
  | ask, 1024² | painted | 440 · 427 | 1.038 [0.972–1.070], 8 | 1.007 · 1.007 | **P3 fails** |
  | ask, 1024² | exact | 402 · 397 | 1.013 [0.963–1.044], 8 | 1.010 · 1.007 | |
  | ask, 512² | painted | 166 · 148 | 1.139 [1.096–1.160], 3 | 0.979 · **1.038** | `VOID` |

  Medians; ratios round-paired. With the late-relay visits kept, a read labelled post hoc: every 2 % cell is
  0.944–0.948 (n = 14 each); at 50 Mbit clean, 1.005 (61 MB) and 0.960 (4.4 MB); and the 512² ask is 1.128 [1.081–1.162]
  painted and 1.012 to the exact frame, with A/A inside ±2.5 %. The first exact frame on screen is not predicted:
  native ÷ browser 0.33 and 0.30 on loopback, 0.76–0.90 on the clean relay.
  * **Where the container saturates.** On loopback the browser holds its two client cores (busy 0.96 median, 0.99 max),
    so P1 is read at a two-core client and claims nothing for more cores. There the native arm uses 0.53–0.76 of two,
    decoding 6.9 ms a 1024² frame, and the server core 0.26–0.35. Behind the relay nothing is busy: clients ≤ 0.62 of
    two, server ≤ 0.37, relay ≤ 0.42 of its core. Its late packets are its scheduling, not its CPU. At 2 % loss the
    61 MB fill is ~1.2 Mbit/s, CUBIC's loss bound at an 80 ms round trip, so the 20 and 50 Mbit lossy cells are one
    link. Steal was not recorded.
  * **The ask, read.** The two arms tie to the exact frame: the 1024² frame's 262 ms on the wire and the round trip
    dominate, and native decode is 8.9 ms of it. Native's painted ask trails by the painter's full read-back: from the
    exact frame to the paint takes 36 and 32 ms (median, 1024² and 512²), against the browser's 28 and 16.
  * **The verdict under the rule.** P1 holds, at two client cores. P2 holds on the two clean cells it could decide, and
    fails under 2 % loss at 20 Mbit: the native fill is 4 % faster. That is the direction quic.md N1 found (Chromium 1.089
    and 1.054 of quinn under 2 % loss), and as there it is not CPU (≤ 0.06 of two cores). P3 fails on large frames
    (1.04, not ≤ 0.9). So on a clean target link the rule's first branch reads as written: on desktop a native client
    buys nothing on fill or ask. Under random loss it buys ~4–5 % of fill, measured in one decidable cell and seen in
    every lossy cell post hoc. Its clear gain is where the client's CPU binds: 0.43–0.48 of the fill and 0.30–0.33 of
    the first frame on loopback. That is the regime a phone is more likely to be in; M4 measures it. The app's case
    stays on the cache, background work and phones.
* **M3 CACHE — a file-system cache, verified and crash-safe** (container). A verified-frames-only cache in the core,
  written by temporary name, fsync and rename. Cells: reopen a 61 MB series from the cache against from the relay at
  20 Mbit; a process killed at random points during 100 writes. Predictions: the reopen is ≤ 0.5 s against ≈ 24 s;
  after every kill each frame is either absent or passes its check, 100 of 100; a byte flipped on disk is refused on
  read and fetched again. Rule: all three hold, or the cache's design is revised before any phone run.

  *Run 2026-10-28* ([`../../lab/scripts/native_cache_cells.sh`](../../lab/scripts/native_cache_cells.sh), container,
  4 cores, ext4). **All three hold: the design stands** (*corrected 2026-10-28*: the reopen's prediction holds warm
  only, from the page cache; cold, as after a reboot, is not measured, so ≤ 0.5 s is not shown for a real reopen).
  Settings: `native-fill` release with `decode` (dav1d 1.5.4, OpenJPH 0.31.0), Chromium's windows, one `series-server` release build in `shared`; a synthetic series of 87 HTJ2K
  frames, 768×920 12-bit `ct` content, 60.9 MB (no committed series is 61 MB), its digests from the source samples by
  Python's `xxhash`; the relay at 20 Mbit, 40 ms RTT, 200 packets, `--self-timing`, one per run.
  * **Reopen**, 7 rounds, the arms in a Williams order: from the cache **373 ms** median (345–443), all 87 frames
    re-checked `true` and byte-identical, no dial; from the relay into an empty cache 25 145 ms (25 142–25 260, 5 runs;
    2 voided by the relay's self-timing). 0.015×. The relay arm is bound by the link (61 MB at 20 Mbit is 24.4 s); the
    cache arm by one core decoding, the other three idle. The reopen reads the page cache, which the files were just
    written to: a cold device read is not measured.
  * **Kills**: 100 writers each killed (SIGKILL) at a uniformly random time within a whole run (374 ms for 100 frames
    of 701 KB): 7 749 frames whole, 2 251 absent, **0 torn**, so 100 of 100 kills clean. A power loss is not tested;
    nothing here tells a kept fsync from a dropped one (two mutants survive, below).
  * **A flipped byte**: one bit at a random offset of a random frame, 7 rounds: **7 of 7** refused on read, the entry
    removed, the frame fetched from the server `true`, written again, and the next reopen all 87 from the cache.

  Mutants (each run, each caught but two): in `cache.rs`'s tests, a frame stored whatever its check; written in place
  with no temporary name and rename (the kill test, 1–6 torn in each of 5 runs of 20 kills); never renamed; a failing
  entry kept; the version dropped from the key; the key's path check removed. In the lab cells, `native-fill` taking a
  cached frame without its check passing (cell 3 fails the frame) and not writing fetched frames (cell 1's cache arm
  fetches all 87). **Survived:** the file's and the directory's fsync removed, which only a power loss shows. A read
  that skips the check cannot be written: `get` returns only what the check hands back.
* **M4 PHONEFIRST — the core on one Android phone** (the owner's device; Android first because quinn's GRO and
  Vulkan exist there). After P-ARM: M2's cells through the phone's own Wi-Fi to the relay, the app against Chrome on
  the same phone. Predictions: the fill within ±3 % at 20 Mbit; the ask on large frames ≤ 0.9 × Chrome's only if
  P-ARM's port is in. Rule: the iOS stage ([`quic.md`](quic.md) N3 APPLERECV) runs only if M4 shows a gain the
  browser does not have.

A GPU desktop reruns M1 and M2 on its GPU (the browser on ANGLE with the renderer printed), which is the first number
here that is not software rendering.

## 7. The owner's decisions

Also under §Blocked in [`../av1/queue.md`](../av1/queue.md).

1. **Whether to build a native client at all before M2.** A page now reaches every engine; the app's case is the
   cache, background work, native decode and a receive path no browser offers — the last two unmeasured.
   *Answered by the owner, 2026-10-26:* build it now, headless first — a Rust core on raw QUIC (quinn) with its own
   ALPN, native OpenJPH and dav1d, the per-frame check and a file-system cache, then M1 and M2 in containers. The
   design is §8.
2. **The shape** (§4): Rust core + native UI per platform; a pure-Rust GUI (Slint the only one on all five, with its
   licence); Qt; Flutter. What decides it: the team's languages and how much accessibility the mobile UI needs.
   *Still open (the owner, 2026-10-26):* the headless core in §8 is built so that any of them can sit on it.
   *Decided by the owner, 2026-10-29: "basic"* — the surface-only shape §4 built (winit and M1's painter, no toolkit);
   a toolkit is not adopted now, and the native arms stay inside this shape.
3. **The cache's policy**: a persistent on-device cache or none (AAPM 260's advice); its budget; on iOS, data
   protection class C (prefetch works locked) or A (cache closed ~10 s after lock).
4. **The intended use, for a regulatory specialist**: diagnostic display (892.2050, MDR Rule 11) or display only —
   the same answer for page and app, but it sets what the app's store listing and device list must carry.
5. **Distribution**: the public stores, or hospital channels (Apple Business Manager custom apps, managed Google Play
   private apps) and a desktop update channel per OS.

## 8. The headless core on raw QUIC: the design

*Queue row NATIVEWIRE, 2026-10-27. Theory only: read from the server's code and from wtransport 0.7.2, quinn 0.11.11,
quinn-proto 0.11.18 and rustls 0.23.46 at the versions `Cargo.lock` pins; nothing built, nothing timed; line counts
are estimates. Structural: proposed for review before step 1 starts.*

**The question.** What is the smallest design that lets the existing server serve a native raw-QUIC client the same
frames, exactness and send behaviour it gives WebTransport?

**The answer in brief.** One quinn endpoint on the one UDP port offers two ALPNs, `h3` and `wt-pacs/1`, and dispatches
each connection by the one TLS chose. `h3` goes to wtransport exactly as today; `wt-pacs/1` gets [`../WIRE.md`](../WIRE.md)'s
control stream and media streams as bare QUIC streams. Everything from the first FoD message on — planner, pipeline,
store, `Link`'s send path, the transport configuration — is the code the browser path runs today; only the two
handles it writes through become an either-or. The client is one workspace member, **client/native**, written on the
same quinn and the server's own `fod`, `frame-envelope` and `series-bundle` crates.

### 8.1 One endpoint, two ALPNs

* **How TLS chooses.** rustls picks the first of the server's `alpn_protocols` that the client offers, "most
  preferred first" (`src/server/`: `server_conn.rs:336–338`, `hs.rs:98–107`), and sends only that one back. In QUIC no
  overlap is fatal: `no_application_protocol`, connection error 0x178 (`hs.rs:122–136`, RFC 9001 §8.1). So a browser,
  which offers only `h3`, gets the same ServerHello it gets today, and an unknown ALPN is refused in the handshake by
  name — that refusal is the version check.
* **When the server knows.** quinn's `Connecting::handshake_data()` resolves once the ClientHello is processed, and
  its `rustls::HandshakeData.protocol` is "guaranteed to be set if a nonempty list of protocols was specified"
  (quinn `connection.rs:148–167`, quinn-proto `crypto/rustls.rs:259–263`). It takes `&mut self` and a second call
  returns at once (`handshake_data_ready.take()`).
* **Why the server must own the quinn endpoint.** wtransport's `Endpoint::accept` returns an `IncomingSession`
  whose `quinn::Incoming` is private (`endpoint.rs:145–156`, `:537`) and whose future always runs the HTTP/3 driver,
  so it cannot route. Its `IncomingSessionFuture::with_quic_connecting(quinn::Connecting)` takes a connection the
  server already holds (`endpoint.rs:607`). With this repository's `settings-in-handshake` patch that future and the
  one `Endpoint::accept` builds both call the same `accept(connecting)`, which itself awaits `handshake_data()` and
  writes SETTINGS at 0.5 RTT ([`../../patches/wtransport-0.7.2-settings-in-handshake.patch`](../../patches/wtransport-0.7.2-settings-in-handshake.patch)):
  the browser's session open is the same code, early SETTINGS included.
* **What the endpoint is built from.** wtransport's `ServerConfigBuilder::build` is four calls on quinn
  (`config.rs:556–566`): `QuicServerConfig::try_from(tls)`, `ServerConfig::with_crypto`, `transport_config` and
  `migration(true)`, over `EndpointConfig::default()`. The server makes the same four, with
  `wtransport::tls::server::build_default_tls_config(identity)` (`tls.rs:635–655`, which sets `[h3]`) and
  `wt-pacs/1` pushed after it, and `TransportTuning::to_transport_config()` as today. It binds the socket with
  `socket2` (already a dependency) — dual-stack `[::]`, then `0.0.0.0` — because wtransport's `bind_socket` is
  `pub(crate)` (`config.rs:1163`), and hands it to `quinn::Endpoint::new`. **One `quinn::ServerConfig` serves both
  ALPNs, so the controller, initial window, send window, idle timeout and the patched quinn and quinn-proto are one
  object**: the send behaviour cannot differ by ALPN except through what the client grants (§8.7).
* **The accept loop.** `endpoint.accept()` → `incoming.accept()?` → `handshake_data().await` → by
  `protocol`: `h3` → `IncomingSessionFuture::with_quic_connecting(connecting).await` and today's `handle_incoming`
  body; `wt-pacs/1` → `connecting.await` and a raw handler (§8.3). Stop is unchanged: `endpoint.close(STOPPING, …)`
  and `wait_idle()` exist on `quinn::Endpoint`. *Corrected 2026-10-28, found in #201:* `endpoint.accept()` returns
  `None` for good once the endpoint is closed, so a `None` ends the loop; wtransport's `accept` hid that by panicking.
* **Two endpoints instead** (raw QUIC on a second port) would leave `build_endpoint` alone, but adds a port to open
  in every firewall, a second socket, a second stop path and a second banner line, and the two could drift in
  configuration. One endpoint is fewer lines and one configuration; the PCS upload's QUIC listener is a separate
  process on its own port (`docs/ingest/link.md` §12.4 on `claude/pcs-carrier-impl`) and does not share it.

### 8.2 WIRE.md on raw QUIC: what the HTTP/3 layer adds, and what drops

*Built 2026-10-27 (step 1):* the table that stood here is [`../WIRE.md`](../WIRE.md) §The raw QUIC mapping.

What drops is the HTTP/3 and WebTransport layers and nothing of the session: the server never used datagrams, and
the stream mode stays process-wide and untold. The token is unregistered, as the PCS
line's is (RFC 9308 §8; PR #182, `docs/ingest/link.md` §14.6 question 2): an owner's call, the same for both. The two
tokens must differ.

### 8.3 What the server shares, and what changes

The browser path's session already reaches the wire through two quinn handles: `write_frame` writes
`uni.quic_stream_mut()` (`server/src/transport/link.rs`), and every stat, window and close reason is read through
`connection.quic_connection()`. wtransport's `RecvStream::read` is quinn's read with its error renamed
(`stream.rs:137`). So the change is to hold those handles directly.

| function | today | change |
| --- | --- | --- |
| `Sessions::serve`, `drive`, `steps`, `forward`, `Planner`, `ProductPipeline`, `FrameStore` | transport-free | none |
| `wire.rs` `read_fod_msg`, `write_fod_msg` | wtransport streams | take `quinn::RecvStream` / `quinn::SendStream`; the WebTransport caller passes `quic_stream_mut()` |
| `link.rs` `Link::Quic` | `wtransport::Connection`, `SendStream` | two enums, `QuicSession { WebTransport(wtransport::Connection), Raw(quinn::Connection) }` with `quic()` and `open_uni()`, and `QuicSend { WebTransport(SendStream), Raw(quinn::SendStream) }` with `quic()` and `finish()`; every other use goes through `quic()` |
| `Media::send`'s finish | wtransport's `finish()`, which waits for the peer's acknowledgement (`driver/streams/mod.rs:46–54`) | `QuicSend::finish`: the same, as quinn's `finish()` then `stopped().await` for `Raw` — so `per-frame`'s 2 s grace waits on the same event |
| `build_endpoint`, `run_server`'s loop | wtransport `Endpoint` | §8.1 |
| `handle_incoming` | one function | the WebTransport body unchanged but for the two enums; a raw handler beside it (`accept_bi`, `Link::quic`, `serve` with no opening ask); both end in one shared tail, `report_path` and the close classification |
| `closed_by_peer`, `report_path` | `&wtransport::Connection` | `&quinn::Connection`; `closed_by_peer` also matches `quinn::ReadError::ConnectionLost` and `quinn::ConnectionError`, since reads now fail with quinn's types |
| lab only | `hold_session(IncomingSession)`, `record::path::run(wtransport::Connection)` | `hold_session` stays on `h3` only; `path::run` takes `quinn::Connection` |

Estimated **+90 −35 lines** in `server/src`, no new dependency, no new flag: the raw ALPN is always offered, since
offering it changes no byte a browser sees (§8.1). `--stall-after-bytes` and `--send-window-follows-cwnd` live in
`Link` and so apply to both. The WebSocket path is untouched.

### 8.4 The client crate

**One workspace member, **client/native**** (crate `native-client`), a library, two lab binaries (`native-fill`; `native-window`, §4) and the painter's check (`examples/paint-check.rs`). It depends on
`fod`, `frame-envelope` and `series-bundle` from `common/`, on `wtransport` only for its `quinn` re-export and
`ServerHashVerification` (so the version and the `[patch]` are the server's, and no WebTransport session is ever
opened), and on `tokio`. Modules, each added by the step that needs it:

* **`transport`** (step 1): `dial(addr, cert_sha256, windows)`, `ask(frame)`, `fill(from, to)`, `end_stream()`; a
  stream of `(index, Bytes)` read from every uni the server opens, envelope by envelope as `frame-envelope`
  defines them, whichever stream mode is in force; refusals from the control stream; a stream that ends inside an
  envelope names the frame ([`../CLIENTS.md`](../CLIENTS.md) §A truncated frame is a failure).
* **`verify`** (step 1): the frame's XXH3-64 over its samples as `decodeFrame` hands them on, against the
  metadata's `digests` ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests); `exact` is `true`, `false` or
  `unchecked`, as in the browser. Hashed by `xxhash-rust` (pure Rust, no C build in step 1), held to the digests
  hash-wasm and Python's `xxhash` already wrote (`client/decode/xxh3.test.mjs`'s lengths; the goldens'
  `NAME.xxh3`, 109 files).
* **`decode`** (step 2): OpenJPH 0.31.0 and dav1d 1.5.4 at the WASM builds' pins (`client/decode/wasm/build/pins.sh`),
  and the AV1 payload reader and split merge ported from `av1-payload.js` and `av1-frame.js`
  ([`../av1/payload-format.md`](../av1/payload-format.md)). Behind a cargo feature, so the default build stays C-free.
  *Corrected 2026-10-28, found in #201:* not compiled from the WASM wrappers, which are emscripten bindings, but linked
  through the ingest's native shim `ingest/coded-frames/decode.cpp`; and every native decode opens a fresh decoder, so
  a mismatch is `false` at once rather than decoded again.
* **`paint`** (M1, *built 2026-10-28*): `Painter::new()` on wgpu's first adapter, and `paint(frame, display, width,
  height, dpr)` to RGBA rows read back from an offscreen texture. *Was:* "No window"; `Painter::on(adapter, format)`,
  `draw` and `read` now paint and read back any texture, a window's surface included (§4). The browser painter's contract, proved in
  §6 M1. It sits behind the `paint` feature, so the default build carries no wgpu.
* **`cache`** (M3, *built 2026-10-28*): [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §8
  *A client cache* and §3 above, as written: coded bytes, one file per frame at `root/series/version/index`, only
  `true` frames; written under a temporary name unique to the write (`index.pid.n.part`, so two writers of one frame
  never share it), fsynced, renamed, the directory fsynced; on read through the caller's
  check, which hands back the samples, and an entry that fails it is removed. `get` returns only what the check
  returned, so a read that skips the check does not type-check. Where the series name and the metadata's version come
  from is open, as the metadata is (`native-fill` takes `--series` and `--version`); nothing evicts. A `.part` left by
  a crash is never read, and nothing removes it.

**The lab binary, `native-fill`**: `--url https://host:port/ --cert-sha256 HEX --bundle PATH`, then `--fill A-B` or
`--ask N,…`, the client's windows, and with `decode` `--cache DIR --series S --version V`, which reads the cache first
and asks the server only for what it lacks. It prints its settings first, then a row per frame (index, bytes,
last-byte time, source, `exact`), times counted from before the cache's reads and the dial, which `dial_ms` prints,
and exits non-zero on any frame that is not byte-identical to the bundle's entry (read through `series-bundle`, not
through the server) or not `exact`. The bundle stands in for the metadata a real viewer would
get, an open question the browser has too.

**What `lab/window-harness` gives.** It speaks WebTransport through wtransport's client, FoD on the control bidi,
envelopes on every uni (`frames.rs`), accepts any certificate and checks nothing (`fill_load` compares bytes with
ingest's items). Reused: its envelope loop's shape, which `transport` copies onto quinn streams (≈ 40 lines), and
the crates it already shares. Not reused: its trace, window and pacing drivers, typed on wtransport streams and made
for measuring the server. It stays the WebTransport arm wherever a row needs one (N1, the step 1 check below).

Estimated: step 1 ≈ 300 lines of client and CLI, ≈ 150 of tests.

### 8.5 What keeps the browser path unchanged, and what proves both clients get the same bytes

* **Unchanged by construction:** the browser offers only `h3`, so TLS answers it as today (§8.1); its session
  opens through the same patched `accept(connecting)`; the transport configuration is the same object; the bytes on
  its streams are written by the same `write_frame` through the same quinn stream.
* **Kept by the existing tests**, run unchanged: `pipelined_single_asks_arrive_whole_and_in_ask_order`,
  `an_opening_ask_is_served_behind_the_accept`, the six *ends … cleanly / in error* QUIC tests (the close
  classification, whose error types change), `a_stopped_server_closes_its_sessions_with_its_code`,
  `server/tests/gso_cap.rs`, and `client/contract/run_wire.sh` with the browser suites in `scripts/gate.sh`.
* **New, in `server.rs`'s tests** (a raw client is a few lines on `wtransport::quinn`; no dependency on the client
  crate):
  * *the two ALPNs get the same bytes*: one server, a WebTransport and a raw session, each asking three frames and
    a fill, in `shared` and in `per-frame`; every envelope, head included, identical between the two and to the
    bundle. Mutants: a stray byte before the raw media stream; the raw path's envelope head dropped; `h3` routed to
    the raw handler (the WebTransport session never opens).
  * *an unknown ALPN is refused in the handshake*: 0x178, by name. Mutant: an empty server ALPN list.
  * the close classification for raw sessions: the existing tests' client half run on both ALPNs.
* **New, in the client crate:** a fill and asks against an in-process `series_server::run_server`, byte-identical
  to the bundle in both stream modes; an out-of-range ask names its `frame_error`; with `lab-levers`,
  `--stall-after-bytes` gives a truncated frame named; XXH3 against hash-wasm's and Python's digests. Each mutated
  once (CLAUDE.md §Measurement).
* **One lab check, interleaved:** `native-fill` and `window-harness` (`fill_load`) on one server build behind the
  relay (`link_impair.py`, 20 and 50 Mbit, 40 ms), both clients' stream window at 6 MiB, ≥ 7 rounds alternating.
  Predictions: every frame byte-identical in both arms; the fill within ±3 % and the server's `session path` (cwnd,
  sent, lost) within the A/A spread; the first frame of a cold `--fill` from the raw client no later than the
  WebTransport client's with `?ask=` (§8.2). Rule: any of these failing stops step 2 until it is explained.

### 8.6 Build order

1. **Step 1, the wire and the check** (one row): §8.1 and §8.3 in the server; **client/native** with `transport`,
   `verify` and `native-fill`; §8.5's tests and lab check; `WIRE.md` and the glossary as §8.2 says. Done when gate is
   green and the lab check's rule holds. The client opens with Chromium's 6 MiB stream and 15 MiB connection windows
   by default ([`../transport/link-conditions.md`](../transport/link-conditions.md) item 4), printed, so a later
   comparison differs in the client's stack and not in its credit. quic.md §6 N1's raw-QUIC arm, not run for want of
   a server, becomes runnable.
2. **Step 2, native decode**: `decode` as in §8.4; every golden and matrix payload and both HTJ2K contract frames
   `true` against their `NAME.xxh3`; the exactness ADR's mutants re-run natively. *Built 2026-10-27:* 109 of 109 `true` in
   `every_committed_frame_decodes_to_its_digest`; the ADR's two digest mutants re-run there turn the same frames
   `false` as in the browser: big-endian 80 of 90 matrix payloads, sign- to 13-bit zero-extension 40 of 90. Over raw
   QUIC from the server, `native-fill` on the 107 payloads and the 2 codestreams packed as two series: every frame
   identical and `true`.
3. **M3 CACHE** (§6), on `cache`. *Built and run 2026-10-28:* see §6.
4. **M1 PAINTPROOF** (§6): the painter as a module of this crate on wgpu. *Passed 2026-10-28* on lavapipe.
5. **M2 NATIVEFILL** (§6), its native arm `native-fill` with `decode` and M1's painter. *Run 2026-10-28:* P1 holds
   at two client cores, P2 holds clean and fails under 2 % loss (native 4 % faster), P3 fails.

### 8.7 Risks

* **wtransport's internals.** The design rests on `with_quic_connecting` and the patch running the same code as
  `Endpoint::accept`; a wtransport upgrade re-reads §8.1 and re-runs §8.5's tests.
* **The client's credit is part of the send.** The server sends into what the client grants: a quinn client at its
  1.25 MB default stream window binds above 97 ms at 103 Mbit/s where Chromium's 6 MiB does not (quic.md §1), and the
  ask waits behind the credit (§9.7 of [`quic-compared.md`](quic-compared.md)). Same frames, same server, different
  timing unless the windows are set equal; the uni-stream credit `per-frame` needs is quinn's default 100, and
  Chromium's is not read here.
* **No browser reaches `wt-pacs/1`**, so it has no browser coverage, and the browser's packets are not compared
  before and after the change: §8.5's argument is read from code, and the existing suites are what hold it.
* **A second protocol on a public port** reaches the same FoD parser and limits (`MAX_FOD_LEN`, the planner's
  refusals); the server checks no CONNECT path or authority today, so nothing is lost. A deployment that wants the
  native door shut has no flag; adding one is a line, if asked.
* **0-RTT is not in step 1.** Raw QUIC makes resumption possible without patching wtransport (quic.md §7.1); it needs
  the server's early-data limit and an answer on replay (every FoD message is a read, so likely safe — not settled).

## 9. Sources

Fetched 2026-10-10, pinned by version or date and the first 12 hex of the fetched file's sha256; raw copies are not
committed.

* **wgpu** tag `v30.0.1`: `wgpu-types/src/texture/format.rs` (`1273358c6bff`), `features.rs` (`9f59a965b63e`),
  `limits.rs` (`f9f4c2a91e55`), `wgpu-core/src/device/queue.rs` (`ec1e845d9f4e`), `wgpu-types/src/surface.rs`
  (`ab65f132d1a4`), `docs/testing.md` (`305978da65a1`), `naga/README.md` (`777336887bd2`). WebGPU, W3C CRD
  2026-09-15 (`7c6768143075`); Vulkan-Docs `v1.4.365` formats chapter (`ead73581b6bb`); Apple Metal Feature Set
  Tables, 2026-05-21 (`9f31df15dd68`); D3D12 hardware feature levels (`dd18fcf488b6`).
* **File systems**: XDG Base Directory 0.8 (`032442a64662`); Apple, Optimizing your app's data for iCloud backup
  (`fe063417c912`); Apple Platform Security, Data Protection classes, 2024-12-19 (`b47d42443f8a`); Apple `fsync(2)`
  (`6f2812ad0289`); Android, app-specific files, 2026-10-01 (`f19e6f40159c`); AOSP file-based encryption
  (`766d30f36021`); POSIX `mmap` 2024 (`6e78132f706b`); Linux `fsync.2` (`661752cb3565`); MDN, storage quotas
  (`063c70850976`); WebKit, "Updates to Storage Policy", 2023-08-10 (`b774aa9bbabb`); web.dev, storage for the web
  (`6f33f54ed12f`).
* **App shape**: UniFFI README (`ee6bca840525`) and futures manual (`8dd09c9b93e5`); rustc platform support
  (`c55e9228b16d`) and Apple iOS page (`75c299cb479b`); wry README (`cfa18c4d0e5a`); Flutter `fl_texture_gl.h`
  (`cdb57336a515`); egui README (`f682db56af90`); iced README (`58c0921d4adf`); Slint licence (`d76791219885`);
  Qt 6.12 licensing (`4e44ffea2f2a`) and QRhi (`96a1475b03da`); Compose Multiplatform 1.8.0 post (`d4d2bbbc7817`);
  .NET MAUI supported platforms (`e486e785cd34`); React Native out-of-tree platforms (`2bef7877bd70`); dicom-rs
  README (`f93fa1dc7313`); crates.io wgpu record (`3a4d2294da24`).
* **Costs**: Apple App Review Guidelines, 2026-06-08 (`bd211d14d2ce`); Apple Enterprise program (`f8ef2c3d687b`) and
  custom apps (`91873b81d628`); Play health content policy (`0f856d4f6e18`), target API (`d64a745164ff`), private
  apps (`55e5519b67e1`); Tauri updater (`b92647df966b`); Flathub requirements (`02a96dd82e12`); Apple background
  downloads (`eb9ce8749c12`) and `BGContinuedProcessingTaskRequest` (`2338263cfa66`); Android foreground-service
  timeout (`8c31e37fbc69`); MDN browser-compat-data `api.WebTransport` (`54448b0730fc`).
* **Rules**: FDA, Policy for Device Software Functions and Mobile Medical Applications, 2022-09-28 (`7fb21371f814`);
  FDA, Medical Device Data Systems … guidance, 2022-09-28 (`4ae24376bf51`); eCFR 21 CFR 892.2050 (`e5c82d744117`);
  FDA, Cybersecurity in Medical Devices, 2026-02-03 (`d046fa836048`); 510(k) K103785 summary (`2270f3b27be1`);
  Regulation (EU) 2017/745 (`81790aaa5016`); MDCG 2019-11 rev.1 (`ed60b2084a91`); Regulation (EU) 2016/679
  (`962539af0373`); ACR–AAPM–SIIM Technical Standard for Electronic Practice, rev. 2022 (`c36cbd5e16df`); AAPM
  Report 260 (`7b0403c504c4`); eCFR 45 CFR 164.312 (`c70378b6f5e4`).

**Not read**, so not cited: IEC 62304 beyond its abstract and IEC 82304-1 (paywalled or refused); the EU borderline
manual on PACS; the HIPAA Security Rule revision's text; GitHub's release pages (403); MicroDicom's site (403).

## The view-worker design, native (2026-10-29)

*Theory only: read from the Target section of [`../adr/frame-path.md`](../adr/frame-path.md) as revised on
`claude/view-worker-target-rev` (draft PR #235), its red team's review and the independent design after it, and from
the native line's open PRs at their heads: #206 `claude/native-paint`, #209 `claude/native-cache`, #216
`claude/native-window`, #218 `claude/native-fill`. M2's and M3's results quoted below are on #218's and #209's
`docs/native/README.md` §6, not on this branch (*corrected in methodology review (2026-10-29)*). Nothing built, nothing
run. The owner, 2026-10-29: try this design in the native client, compared with native's other versions, measured.
The UI shape stays open (§7, decision 2).*

**The question.** What the view-worker design becomes on native threads and memory, and how the versions are compared.

**The answer in brief.** The split carries over whole — the controller decides what, the store decides from where and
alone talks to the downloader, one owner per frame, an ordered want, a bound on frames in flight, paint before the
write — and gets cheaper: in Rust a frame's hand-over is a move, and the bound is a channel's capacity, not an ack
message. What dissolves is the browser's: the page, `SharedArrayBuffer` accounting, OPFS's handle rules, a worker's
clock source. What changes cost is the write (two fsyncs, not a copy into the page cache), the hop (a channel, not
`postMessage`) and the receive: quinn runs in-process, so a thread that blocks its driver stops ACKs, not just credit.
Native today already runs that risk by accident — its decode, its cache's fsyncs and `native-fill`'s painted wait all
run on the runtime's workers — and the single core makes it the design's rule; the receive cell below runs on every
arm (*corrected in methodology review (2026-10-29)*: it read as the single core's risk alone).

### Native today, as the branches build it

* **Threads.** `native-window` runs a tokio multi-thread runtime (`Runtime::new()`, a worker per core) beside winit's
  UI thread. Each server uni stream is read in its own task (`transport.rs` `media`); every frame goes through one
  unbounded channel to one `load` task, which decodes it synchronously on the runtime's worker — no `spawn_blocking` —
  checks it, and hands the samples to the UI thread through `EventLoopProxy`. quinn's endpoint and connection drivers
  are tasks on the same runtime, so with one worker (the 1-core cell) every decode stalls them. The UI thread keeps the
  frames and paints on redraw.
* **Memory.** `frames: Vec<Option<Vec<u8>>>`, every frame of the series, no budget, no eviction. The decoder keeps one
  `i32` scratch the size of a frame (4 bytes a sample), narrowed into each frame's `Vec`.
* **Asking.** The window fills the whole series at open and steps through what it holds; nothing is asked on a step.
  `native-fill --ask --in-turn` asks one at a time and paints on a thread of its own (`screen.rs`), M2's arm; it holds
  no frame, and its painted stamp is taken after a full read-back of the target, which the receive loop blocks on
  (*corrected in methodology review (2026-10-29)*).
* **The cache** (M3) stores coded bytes, a file per frame, write, fsync, rename, fsync of the directory; on
  `native-cache` the `put` runs on the receive loop after the decode. It has no lever to slow a write or force a miss.
  No branch holds the cache and a window together, so merged as written, the write — both fsyncs — would come before
  the hand-off to the paint.
* **The paint** creates the samples texture, the window table (rebuilt on the CPU, up to 65 536 entries) and the
  uniform afresh on every paint — three queue writes, one of them the samples through `write_texture`'s staging copy —
  with no skipped upload for the frame already on screen (§6 M1, *Not ported*). The present mode is the driver's first
  listed, not chosen (*corrected in methodology review (2026-10-29)*).

### The mapping

| the target, in the browser | native | |
| --- | --- | --- |
| the page: intents and events only | the UI thread, whichever shape decision 2 picks: input, status, the surface's life (resize, suspend) | carries over; the page's long tasks become the toolkit's |
| the view worker: controller, frame store, paint module | a **view thread** owning the three as modules, its inbox a channel | carries over |
| its frame clock: worker `requestAnimationFrame`, a 15 ms timer in WebKit; the frame picked from the time elapsed since `play`, paused on `hidden` | the surface's present: `Fifo` blocks the view thread until a vblank frees an image; the pick from elapsed time and the pause on suspend stay | the source dissolves — the windowing system's clock, on the thread that paints; the two rules carry (*corrected in methodology review (2026-10-29)*) |
| WebGL2 on a transferred canvas | wgpu's `Surface` and `Device`, both `Send + Sync`, owned by the view thread; winit creates the window on the UI thread | carries over by the types; presenting off the UI thread on macOS, iOS and Android not run |
| the downloader worker: session, records, survival, the want windowed to `D_min` asks, a `stream_frames` run where the want is ascending | the tokio runtime that already holds quinn and `transport`, pinned to one worker thread, plus the records | carries over; the runtime's one thread is what the thread counts below assume (*corrected in methodology review (2026-10-29)*) |
| decoders nested in the downloader, `N` a device setting (today's `min(3, cores)`) | `N` decode threads pulling from one **bounded** channel; the stream readers stop reading when it is full, so a slow decode reaches the wire through QUIC's windows and never through a queue of coded bytes | carries over; native decodes inline today (one at a time, M2's asymmetry). OpenJPH is single-threaded; for an AV1 series each decoder's dav1d pool (`auto` today) is pinned to one thread (*corrected in methodology review (2026-10-29)*) |
| the want: an ordered list of misses replacing the last; a frame that lands after its want was replaced is kept | a `watch` channel: the receiver sees only the newest list; a late frame is kept and counted | carries over, and the replace is the channel's own rule |
| frame → store, then ack; credits: dispatch while unacked < K | the samples' `Vec` moved into a channel of capacity K from the decoders to the view thread: the send waits while K frames are unaccepted, the receive is the ack. The downloader's record of what is owed still needs a per-frame `done {i, written}` after the decoder's write (the record's deletion; the re-ask when a decoder dies) | the bound carries, as the channel; the ack as a message dissolves into it; `done` stays, one message a frame, and the move makes the buffer single-owned — the owed record is the rule's other half (*corrected in methodology review (2026-10-29)*: it read as a permit inside the `Vec` and "no `done`") |
| the key (series, index, metadata version); the generation steps when either changes | the same key, which M3's cache path already carries | carries over |
| memory window by byte budget; frame-path's M2 found V8 counts a shared buffer as 0 bytes, so a slot ring is the target's open question | a byte budget over owned `Vec`s, which the allocator and RSS count | the budget carries; the ring dissolves: no shared buffer, no take count |
| OPFS: one sync handle per file, exclusive lock, a writer per worker; arms A, C, D | plain files: any thread writes, two writers of one frame both succeed (M3's unique temporary name) | dissolves; who writes stays a choice, but arm A (the view thread writes) is out, since a write here is two fsyncs |
| a frame read back that fails its check is asked again | M3's `get`: a failing entry is removed and the frame fetched | carries over, built |
| paint before the cache write; eviction only once written | the decoder sends the samples, then writes the **coded** bytes it still holds, then sends `done {i, written}` | carries over, at no cost: M3 caches coded bytes, so the write never needs the samples; the store learns "written" from `done` |
| a full store reaches the wire as a pause | a full decode channel stops the stream readers, not the driver: ACKs continue, credit stops | carries over, and is the one place the native receive differs in kind from the browser's |
| the view worker holds the samples in a `SharedArrayBuffer`, so cross-origin isolation stays a page requirement | nothing shared; the UI thread holds no frame | dissolves (*corrected in methodology review (2026-10-29)*: "no isolation headers" is the independent design's, not the target's) |
| `failed {scope, reason}` to the page | the same event on the UI thread's channel | carries over |

**What changes cost.**

* **A hop.** A message is a channel send and, if the receiver sleeps, a futex wake: expected in microseconds against
  `postMessage`'s structured clone and event-loop turn. Not measured; the arms stamp each hop (below).
* **A cache write.** M3's kill run wrote 100 frames of 701 KB (its 87 × 768×920 12-bit series, not the 61 MB series
  below), write and both fsyncs each, in 374 ms on this container's ext4: ≈ 3.7 ms a frame, not a phone's flash or
  Apple's `F_FULLFSYNC`. OPFS's write is a copy with no flush. Paint first matters more natively, and the writer must
  not be the view thread.
* **A GPU upload from a decoder's buffer.** Native could narrow the decoder's output straight into a mapped staging
  buffer and skip `write_texture`'s copy, which the browser cannot. It saves one copy on shown frames only and nothing
  measured asks for it: not built.
* **The receive.** In the browser QUIC runs in the network process, and a busy worker only holds credit. Natively,
  quinn's driver is a task: if its thread blocks, datagrams wait in the socket buffer, 212 992 bytes on Linux before
  6.18 unless the app raises it, which quinn leaves to the app ([`quic.md`](quic.md) §7.1): ≈ 85 ms at 20 Mbit/s and
  ≈ 34 ms at 50 (derived), ≈ 1.4 ms at M2's loopback rate (61 MB in 398 ms). Past that, drops, read by CUBIC as
  congestion. Linux 6.18 raised the cap to 4 MiB, and this container runs 6.18: the receive cell prints `rmem_max`
  and claims the small buffer only where it is set (*corrected in methodology review (2026-10-29)*).
* **The store's read-back.** M3 caches coded bytes, so a frame from disk is a read, a decode and a check: M3's reopen
  was decode-bound on one core (373 ms for 87 frames, from a warm page cache). The browser target stores samples;
  which one native keeps is not this comparison's lever, and every arm uses M3's cache as built.

### The single core, native

The independent design's alternative: one **core thread** holds transport, records, controller, store and paint; `N`
decode threads write the cache. Natively it is a `current_thread` runtime on the view thread, the paint between its
polls, and `N + 2` threads against the target's `N + 3`. Two of its parts are not taken, so N2 is the target with its
downloader merged into the view thread, not the independent design as written (*corrected in methodology review
(2026-10-29)*):

* **The disk as the only store.** The independent design keeps decoded samples on disk; with M3's coded bytes, every
  step would re-decode (M2: 6.9 ms a 1024² frame on this host). So native's single core keeps the byte-budget memory
  store and the bounded channel from the decoders; what it drops is the second thread, not memory. The sample store
  on disk is untested natively and stays open.
* **The receive beside the paint.** A `Fifo` present blocks up to a display period, and M2's paint with its full
  read-back took 32–36 ms after the exact frame: past the socket buffer at loopback rates, inside it at 20 Mbit. So the
  core presents with `Mailbox` or `Immediate`, never blocking, and the receive-loop cell below decides whether it holds.

### Per frame, counted from the code and the designs

| | threads touched | messages | copies of the samples (CPU) | GPU uploads | frames held |
| --- | ---: | ---: | ---: | ---: | --- |
| **native today**, a fill frame | 2–3 (a runtime worker or two, UI) | 2 (stream → `load`, `load` → UI) | 1 (decoder → `Vec`, narrowed) | 0 | all |
| native today, a step to a held frame | 1 (UI) | 0 | 1 (into staging) | 1 | all |
| native today, an ask (`native-fill --in-turn`) | 3 (runtime, loop, paint thread) | 3 (stream → loop, loop → paint, painted) | 2 | 1 | none (*corrected in methodology review (2026-10-29)*: read "all") |
| **native target**, a fill frame | 3 (runtime, decoder, view) | 3 (decode, frame, `done` after the write); the channel's bound is the ack | 1 | 0 | budget + K |
| native target, a step to a held frame | 2 (UI, view) | 2 (`show`, `shown`) | 1 | 1 | budget + K |
| native target, an on-demand miss | 4 (UI, runtime, decoder, view) | 5 | 2 | 1 | budget + K |
| **native single core**, a fill frame | 2 (core, decoder) | 2 (decode, `done` with the samples) | 1 | 0 | budget + K |
| native single core, a step to a held frame | 2 (UI, core) | 2 | 1 | 1 | budget + K |
| native single core, an on-demand miss | 3 (UI, core, decoder) | 4 | 2 | 1 | budget + K |
| *browser target, a fill frame* (frame-path, *What each counts*) | 3 + the network process | 4 (decode, frame, `done`, ack) | 2, or 1 and a post | 0 | budget, as V8 counts it |
| *browser target, an on-demand miss* | 4 + the network process | 6 | 2, or 1 and a post | 1 | |

Copies are HTJ2K's; an AV1 frame makes one more (`decode.rs`'s `out`). Every native paint also writes the window
table and the uniform, two small queue writes beside the samples. The decoders' `i32` scratch, 4 bytes a sample each,
and the coded bytes in the decode channel sit outside "frames held" and inside RSS (metric 6). The cache write adds no
message beyond `done` in any native arm (the decoder writes after its send) and one copy of the coded bytes into the
page cache. Native's decoder pool needs no `done` to free a slot — an idle decoder pulls the next job — but the
record needs it (*corrected in methodology review (2026-10-29)*).

### The comparison, pre-registered

`claude/client-final-protocol` does not exist on origin, so the cells reuse M2's (§6, results on #218) and the busy-UI
cell and the rule's shape reuse frame-path §7's; what is new here is said so. Every arm's settings print in each row;
every frame checks bit-exact against the bundle and its digest, and one frame not `true` fails its visit.

* **Arms.** **N0, native today**: #206, #209, #216 and #218 merged with no change of design (cache put on the loop
  before the hand-off, every frame held, paint on the UI thread); its painted stamp moves to metric 3's endpoint and
  its present mode is pinned to `Fifo` and printed — measurement changes, not design (*corrected in methodology
  review (2026-10-29)*). **N1, native target**, as mapped above. **N2, native single core**. **B, the browser target**
  as built on `claude/view-worker`, headless Chromium, in the cells it can run: not the 1-core cell (Chromium's
  processes do not pin cleanly) and not metric 6 (OPFS has no slow-write lever). B speaks HTTP/3 WebTransport, native
  raw QUIC (§8.1), on WASM decoders and WebGL2 on SwiftShader: B ÷ N1 is a stack ratio, not a design ratio, and
  M2's clean-link tie (0.996, 0.982) is its control. N1 and N2 use the same decoders, `N = min(3, cores)`; N0 decodes
  one at a time as built, and that is part of what it is.
* **Cells.** M2's: loopback; the relay (`link_impair.py`, 50-packet queue, `--self-timing`) at 20 Mbit, 40 ms each
  way, clean and 2 % loss; the 61 MB (37 × 1024² 16-bit) and 4.4 MB (102 × 512² RGB) HTJ2K series; plus a synthetic
  3328 × 4096 16-bit HTJ2K series of 16 frames (436 MB decoded; no committed set has more than 4 such frames) for the
  memory and step cells (*corrected in methodology review (2026-10-29)*). Clients on 2 cores, and on 1 core as the
  saturating cell, which claims only which arm degrades least (below). Windows 6 MiB stream, 15 MiB connection, in
  every arm.
* **Metrics, one per cell** (latency or throughput, not both):
  1. *Fill*: dial to the last frame exact (N0–N2, B). N1 and N2 run it with a `--budget` that holds the decoded
     series: their want is the frames the budget holds around the one shown, and the default 64 MiB holds 32 of the
     1024² series' 37 (*corrected in independent review (2026-10-30)*: no budget was named, and at 64 MiB the fill
     never reaches its last frame).
  2. *First exact frame on screen*: dial to frame 0 at metric 3's endpoint (N0–N2, B).
  3. *Ask, painted*: step to the GPU queue drained (`on_submitted_work_done`, new code in every native arm; the
     browser's 1-pixel read, which `paint-worker.js` runs on every paint today, moved behind the lab flag on
     `claude/view-worker`), one ask at a time, the 1024² series at 20 Mbit (M2 asked at 50). Neither endpoint is the
     frame on screen, and B's is later by its read-back's copy and a post to the page: printed, not corrected. This
     replaces M2's full read-back, which charged native 8–16 ms more than the browser's 1-pixel read (*corrected in
     methodology review (2026-10-29)*: it read "32–36 ms the browser did not pay"; the browser paid 28 and 16).
  4. *Busy UI*: a 200 ms busy loop every 500 ms on the UI thread (the page in B), the same loop in every arm, from
     the dial: ten asks' painted time, and a 30 Hz timer cine of held frames, frames late against the timer. The lab
     injects the steps off the UI thread in every arm, so the block delays only what paints there; one extra cell posts
     the step through the UI thread, as a user's input arrives. What the cell verifies in N1 and N2 is that nothing on
     their paint path waits on the UI thread; on X11 that is near-certain by construction, on macOS it is not.
  5. *Receive beside the paint*: the 61 MB fill's inter-arrival p99 and its time while a timer cine paints held frames
     at the largest size the container sustains under the guard — measured first, 1024² expected; 3328 × 4096 at
     30 Hz is 818 MB/s of staging copies on lavapipe and saturates by construction — its achieved rate printed
     (N0, N1 and N2; B for reference) (*corrected in methodology review (2026-10-29)*).
  6. *Memory*: peak RSS of the 3328 × 4096 fill with the cache's writes slowed by a lever `NATIVEBUILD` adds to
     `cache.rs` in every arm, budget 64 MiB, K = 4 (this section's choices). The bound N1 and N2 are held to is
     budget + K decoded frames + K coded frames + `N` decoded frames sent and not yet written + `N` decoders'
     `i32` scratch (4 bytes a sample) + the 15 MiB connection window; N0 holds the series, 436 MB (*corrected in
     methodology review (2026-10-29)*: "budget + K frames" alone is below what the decoders hold; *corrected in
     independent review (2026-10-30)*: a decoder writes after its send holding no credit, and the store evicts only
     once written, so up to `N` frames sit in the store past the budget — derived from the code, not measured).
     *Open, found in independent review (2026-10-30)*: at 64 MiB N1's and N2's want is two of these frames, so
     they fetch two and stop; "the fill" needs a drive through the series (steps or the cine), fixed before data.
  7. *Counts*: messages and copies per frame from counters in each arm, against the table above; a hop's send →
     receive stamp, median and p99.
* **Interleaving and A/A.** Per cell, the four arms in a Williams square (4 sequences, each 3 times = 12 rounds),
  each arm's A and A2 back to back. `VOID`, fixed before data, as M2 did it: a cell whose A2/A median strays past
  half its rule's band — fill ±1 % on the relay and ±2.5 % on loopback (M2's loopback A/A ran 1.015–1.043), painted
  ask ±2.5 %; the other metrics print their A/A and void on nothing; a visit whose relay p99 is over 1 ms
  (`link_impair.py --self-timing`'s rule, which M2 misfiled as §8.5's) (*corrected in methodology review (2026-10-29)*).
* **Saturation guard,** new here. Per visit, every client thread's, the server core's and the relay core's busy share
  from `/proc`, steal included. A cell where the client's cores run ≥ 0.9 busy at the median, or the relay's ≥ 0.8,
  is labelled saturated: its ratios are printed and nothing is claimed past it. The 1-core cell saturates by
  construction (one decoder, N0's inline decode stalling quinn's drivers); it is exempt from the guard and claims one
  thing, which arm's fill and painted ask degrade least against its own 2-core figures.
* **Predictions.** (a) On the relay, N1 and N2 fill within ×0.98–1.02 of N0 (the wire binds, M2's P2 at ±3 %;
  the narrower band is decidable because M2's relay A/A ran within 0.2 %); on loopback N1 and N2 fill faster, since
  N0 decodes one at a time at 0.53–0.76 of two cores. (b) Busy UI: N0's painted asks and cine slip with the block,
  N1's and N2's do not. (c) N0's RSS grows to the series' decoded size, N1's and N2's stay within the bound above.
  (d) N2's inter-arrival p99 matches N1's at 20 Mbit and is worse at loopback; in the container that is lavapipe's
  raster time on the core thread, not a vblank wait, which only a display shows. (e) Hops in microseconds.
* **Rule, stated before any data.** **N1 replaces N0** if, on every unsaturated cell, the fill is no slower than
  ×1.02 and on the relay within ×0.98–1.02 (*corrected in methodology review (2026-10-29)*: "within" on every cell
  would have rejected N1 for being faster on loopback), the busy-UI median painted ask is ≥ 16.7 ms earlier in
  ≥ 10 of 12 rounds (a sign test at p ≈ 0.02; 9 of 12 is p ≈ 0.07) with fewer cine frames late, and peak RSS stays
  within the bound. **N2 replaces N1** — it is the simpler, and wins a tie — if metric 5's fill time is no slower
  than ×1.02 of N1's at 20 Mbit, its inter-arrival p99 and the server's `session path` losses within N1's A/A spread,
  and its median painted ask within N1's A/A spread (*corrected in methodology review (2026-10-29)*: "within 2 ms"
  is under M2's painted A/A of ≈ 3 ms); if it holds at 20 Mbit and fails at loopback, the owner decides which link
  the native client serves. **B** is a reference, not a candidate: its ratios to N1 are printed for the cells both
  run, so the owner sees what the native stack buys under the same design.
* **Only the owner's machine or a phone can claim:** the GPU's upload and paint (lavapipe is a CPU); present pacing
  and a cine on a display (Xvfb has no vblank, so `Fifo` never blocks there and a container's cine counts late frames
  against its timer, which is what metrics 4 and 5 report); fsync on real flash and `F_FULLFSYNC`; presenting off the
  UI thread on iOS and Android; a phone's socket buffer and how often its reader stalls past it
  ([`quic.md`](quic.md) §7.6); memory pressure and the OS killing the app; thermal throttling. The container claims
  counts, RSS, fill, ask and the receive cell on software rendering, the timer cine's slips, and nothing for a phone.

### Methodology review (2026-10-29)

Adversarial, before any build or data; three helper agents read the native branches, the ADR and M2's and M3's results.
Each finding above is marked where it was corrected. The serious ones:

1. **The receive risk was misassigned.** N0 decodes, fsyncs and (in `native-fill`) waits for the paint on tokio's
   workers, which also run quinn's drivers: on one worker the driver stalls on every frame. Metric 5 now runs on N0
   too, and the 1-core cell claims degradation, not a ratio.
2. **The ack's replacement lost the record.** A permit dropped anonymously tells the downloader nothing; the target
   deletes the owed record at the ack and re-asks a dead decoder's frames. The bound is now a channel of K and
   `done {i, written}` stays, one message a frame, which also carries the eviction rule "only once written" the
   mapping had omitted; the counts moved from 2 + permit to 3.
3. **The rule rejected the design for winning.** "Within ×0.98–1.02 on every unsaturated cell" fails N1 on loopback,
   where N0 decodes one at a time; the fill rule is one-sided off the relay. The VOID half-band of ±1 % would have
   voided every loopback cell by M2's own A/A (1.015–1.043); it is per link now.
4. **The memory cell could not decide.** No 3328 × 4096 set has more than 4 frames (109 MB, under the 176 MB bound),
   and the bound omitted the decoders' `i32` scratch (54.5 MB each at that size), the coded bytes in flight and the
   connection window. The series is synthetic with 16 frames; the bound lists what RSS holds. The slow-write lever
   and `on_submitted_work_done` exist on no branch: the build adds both, in every arm.
5. **Metric 5's cine saturated by construction** — 27 MB frames at 30 Hz on lavapipe with two cores — so its p99
   would have read CPU starvation in every arm. The cine is now the largest the container sustains under the guard.
6. **Numbers and attributions.** The browser paid 28 and 16 ms of read-back in M2, not nothing; M3's kill run was
   on its 768×920 series; the 1 ms relay rule is `link_impair.py`'s, not §8.5's; this container's kernel is 6.18,
   where the 212 992-byte cap no longer applies; "no isolation headers" and the slot ring were the independent
   design's and the target's open row, not target rules; `native-fill` holds no frame.

Not corrected, stated: B's ratio carries its transport, decoder and GPU stack; metric 3's two endpoints are not the
frame on screen; prediction (b) on X11 is close to true by construction and is a check on the implementation there.

### Built (2026-10-29)

*Built on `claude/native-view` from this section as reviewed; nothing timed, the comparison is NATIVERUN's.* The four
native branches are merged in (#206 painter, #209 cache, #216 window, #218 fill harness); `native-fill` keeps both
#209's `--cache` and #218's `--in-turn --paint`. The window takes `--paint-thread`, the thread that holds the frames and paints them:

* **`ui`** (the default, N0): today's, unchanged in design. With `--cache` it writes each frame, both fsyncs, before
  the hand-off, as the merge would; it never reads the cache, which no branch had the window do. Its present is now
  pinned to `Fifo` and printed.
* **`view`** (N1): `client/native/src/view.rs` and the window's `Viewer`. Threads: UI, a downloader on a
  `current_thread` runtime holding quinn and the records, `N` decoders, the view thread — `N + 3`. The want is a
  `watch`; coded frames wait in a channel of `K`, and the session's readers stop at one unread event; a decoder takes
  a credit (room in the view's channel of `K`) before it takes a job, sends the frame, then writes, then sends
  `done {i, refetch}`. The store is a byte budget (`--budget`, 64 MiB) evicting farthest-first, only once written; at equal distance the
  earlier frame, as the want ranks it last (*corrected in independent review (2026-10-30)*: the tie went to the later
  frame, so the frame the want had just fetched was the one evicted on arrival).
* **`core`** (N2): the same two loops as two futures on one `current_thread` runtime on the core thread — `N + 2`.
  Its present is `Mailbox` or `Immediate`; a surface with neither refuses to start.

Settings: `--credits` (K, 4), `--decoders` (N, `min(3, cores)`), `--asks` (on the wire at once, 8: a setting, not
derived from the link as [`client-window-depth.md`](../adr/client-window-depth.md) would), `--budget`, and in every
paint thread the lab's two levers this section asked for: `--cache-write-delay-ms` (`Cache::slow_writes`) and
`--stamp-painted` (`step at_ms`, then `painted at_ms` after `on_submitted_work_done`).

**Proved.** `client/paint/window.mjs` under Xvfb on lavapipe runs each paint thread, and `view` and `core` again with a
two-frame budget over a cold and then a warm cache: every paint read back equals the CPU reference (0 at 1:1, ≤ 1
fitted) and every painted frame's samples hash to their digest — a check the reference alone misses, since a mutant
storing each frame under the next index paints at |Δ| 0. `view::tests`, each mutated and the mutant failing: the
ordered want reaches the wire in order; an ascending want is one fill and an ask ends it; the store's eviction, and
at equal distance what the want ranks last, never the frame shown (added in independent review (2026-10-30)); credits
bound the frames the view has not received; the cache write lands after the view has the frame; twelve frames over
raw QUIC reach the store once each and the downloader ends owing none.

**Counted per frame** (`count.rs`, the grey AV1 series, every frame held; threads by id, messages as channel receives):

| paint thread | threads | messages | CPU copies | a step |
| --- | ---: | ---: | ---: | --- |
| `ui` | 2.00–3.00 | 2 | 2 | 0 messages, 1 upload |
| `view` | 3 | 4 | 2 | 1 intent + 1 `shown`, 1 upload |
| `core` | 2 | 4 | 2 | 1 intent + 1 `shown`, 1 upload |

Two copies because AV1 merges into `out` first; HTJ2K makes one. With the two-frame budget, evicted frames come back
(from the wire or the cache) and the means rise: `view` 3.25–3.50 threads, 5.50 messages, 3.00 copies.

**Where it departed from the mapping.**

* **Messages: 4, not 3 and 2.** The table counts N0's stream → `load` hop but not N1's or N2's stream → downloader.
  And N2's `done` is its own message, not folded into the frame: N2 is N1's two loops on one thread, which keeps one
  downloader and one view; folding needs a third loop.
* **One `done`, two readers.** The downloader's record ends at `done`; the store learns "written" from a flag the
  decoder sets after the write (`Decoded::written`), not from `done`, which reaches one thread.
* **The fill.** Any ask ends a running fill on the server, so the downloader stops owing the fill's frames not yet
  here; any still in flight arrive late, are kept and counted, and may be asked again — a duplicate on the wire and in
  decode, not measured.
* **The cache's read-back** runs on a decoder (coded bytes need decoding); the downloader stats the file per miss.
* **Not built:** the re-ask when a decoder thread dies (its record stays); the cine and its frame clock (the window
  has none; *built 2026-10-30*, §Built for NATIVERUN); a phone, a display's vblank, macOS's off-UI-thread present.
* **The check's Xvfb** runs `-noreset`: without it the display was gone after the `view` window's close.

### Independent review (2026-10-30)

*Of `claude/native-view` (#247) at `141f66e`, against §The mapping as reviewed; on `claude/native-view-review`.*

* **Checked, holds.** The ordered want goes out as one fill only when ascending with nothing owed, else asks in the
  want's order up to `--asks`; a decoder takes its credit before its job, so decoded frames the view has not received
  never pass K; the frame reaches the view before the write, `written` turns true after it, and the store evicts only
  written frames and never the one shown; the four departures above are what the code does. `view::tests` pass
  (`--features decode`, which the gate's decode step sets and plain `cargo test -p native-client` skips); 10 of 11
  mutants failed them — the survivor, evicting the frame shown, now fails the test added for it — and
  `client/paint/window.mjs` passes on every paint thread.
* **Fixed.** The store's tie-break (above), with a test whose mutant fails.
* **Corrected before data.** Metric 6's bound omitted the `N` unwritten frames; metric 1 named no budget.
* **Not built, and NATIVERUN needs it.** The cine and its frame clock (metrics 4 and 5), the busy-UI loop and the
  steps injected off the UI thread (metric 4), a hop's send → receive stamp (metric 7), metric 6's drive through the
  series, and B's 1-pixel read behind a lab flag (`paint-worker.js` on `claude/view-worker` still reads on every
  paint). Both rules turn on metrics 4 and 5, so NATIVERUN is not run: no verdict is possible from the rest.
  (*Built 2026-10-30*, §Built for NATIVERUN, except B's flag, *corrected there*: it was already on `claude/core`.)
* **Seen, not changed.** The view re-asks only on an intent, so a frame evicted from inside the want, or refused, is
  asked again at the next step, not at once; a cache write that fails still marks the frame written, so it is
  evictable and comes back from the wire.

### Built for NATIVERUN (2026-10-30)

*On `claude/core-native`, from the list above, in the shape the owner chose on 2026-10-29 (§7, decision 2): winit and
M1's painter, no toolkit. Each is a lab setting of `native-window`, off by default, on every `--paint-thread`.
NATIVERUN is not run and nothing here is timed.*

* **The cine** (`--cine-hz`): a timer on the thread that paints — the UI thread under `ui`, the view thread under
  `view`, the core thread under `core` — that shows the frame due by the time since the window opened, as
  `client/view/clock.js` does, looping the series (`client/native/src/clock.rs`). A frame due is **late** when it
  was passed over, was not held at its tick, or its paint — with `--stamp-painted`, the GPU's drain too — had not
  ended when the next was due; the report prints `cine_on_time` and `cine_late`. Under `view` and `core` the frame
  shown moves with the cine and the want follows it: that is metric 6's drive through the series.
* **The busy-UI loop** (`--busy-ui-ms`, `--busy-every-ms`, default 500): the UI thread spins for the block on a
  fixed schedule from the window's opening, under every paint thread.
* **Steps off the UI thread** (`--steps`, `--step-every-ms`, `--steps-via paint|ui`): a thread of their own steps
  one frame forward. `paint` sends each straight to the thread that paints, which under `ui` is the UI thread; `ui`
  sends it through the UI thread, metric 4's extra cell. With `--stamp-painted` each prints `step at_ms` at its send.
* **Hop stamps** (metric 7): every message between threads carries the instant of its send (`count::Sent`) and the
  receiver stamps the hop; the report adds one line a hop, its count and its median and p99 in µs. The hops:
  `stream` (a stream's reader to the session's, from the envelope's last byte), `frame` (`ui`'s `load` to the UI
  thread), `job`, `decoded`, `done`, `intent`, `shown`, `failed`, `step`. Always on, as the counters are: a lock and a
  push a message.
* **B's 1-pixel read** was already behind a lab flag on `claude/core`: `settlePaint` in `client/view/view-worker.js`,
  off by default, set by `lab/viewer/levers.js` ([`../adr/frame-path.md`](../adr/frame-path.md) §3). *Corrected
  (2026-10-30)*: the independent review read `paint-worker.js` alone, which the page view keeps reading on. Nothing
  built.

**Proved.** `clock::tests` and `count::tests`: the cine shows the frame due and counts those passed over; a frame is
on time only if its paint ends before the next is due; the busy loop blocks for its length and keeps its schedule;
a hop stamps its send → receive; the quantiles are nearest-rank. Ten mutants, each failing them.
`client/paint/window.mjs` now also runs each paint thread on a twelve-frame grey series with the UI thread blocked
450 ms of every 500. Seven steps 700 ms apart meet the blocks at five phases 100 ms apart: sent off the UI thread
they must all paint within 100 ms under `view` and `core`; through it (`ui`, and `view` with `--steps-via ui`) some
must wait 100 ms or more. Every hop on the paint thread's path must be stamped. A 30 Hz cine must show at least four
frames, with fewer late than on time under `view` and `core` and more under `ui`. Four mutants against it, each
failing it: steps sent off the UI thread routed through it; the view's cine not moving the frame shown; the busy
loop not run; the intent hop stamped under another name. The last two ran before the steps' part of the check took
its final form, which they do not touch.

**Smoked, not measured.** One run of each, Xvfb on lavapipe, four cores, 64 × 48 frames in a 512 × 384 window,
from the check above: a step sent off the UI thread painted 4–7 ms after its send under `view` and `core`, one sent
through it 54–455 ms, as the block's phase fell; the cine had 178 frames on time and 1 late under `view` and `core`,
22 on time and 157 late under `ui`. A container's Xvfb has no vblank, so this says the wiring holds; prediction (b)
on X11 is near-true by construction.

**Seen, not changed.** In one `view` cine run with `--check`, whose read-back outlasts a 33 ms frame, each of the four
frames was decoded twice: the likely path, not traced, is a want sent while a frame is between its decoder and the
view, which lists it again once its `done` has cleared the downloader's record — §Built's "may be asked again",
frequent under a want that changes 30 times a second.

**What NATIVERUN still needs, none of it the window's:** the runner — the arms in a Williams square with A and A2, the
relay cells, the 1-core pinning, the saturation guard from `/proc`, peak RSS (`VmHWM`), B's rig; a visit's end (the
window runs until closed, so the runner sends Escape or ends it after its last step); the times metrics 1 and 5 read
— dial to the last frame exact, and the inter-arrival p99 — which the window does not print (`Event::Frame`'s `at`
holds the arrival); the synthetic 3328 × 4096 16-frame series, and the 1024² and 512² HTJ2K series packed for it.

*Built 2026-10-30, on `claude/native-metrics`:* the visit's end (`--exit`) and its times, and the series (§The
interim run, below). The runner is still to build.

### The interim run, pre-registered (2026-10-30)

*Written before any data, with its runner [`lab/native-window/run.py`](../../lab/native-window/run.py) and the rule's
test on made-up rows, `run_test.py` there, each of its nine mutants failing it. A one-round smoke of the 4.4 MB
loopback cell, run under the series' generation to check the wiring, is not kept.*

**The question.** M2 (§6) timed the native client with `native-fill`, a CLI; the window has never been timed. Does the
window, on each paint thread, keep M2's reading against the browser? It is not NATIVERUN: one design question, no busy
UI, no cine.

**What the window adds for it** (lab settings, defaults unchanged): `--exit` closes the window once every frame has been
exact on the thread that paints and, with `--steps`, a step's interval after the last; `--size` sets its inner size.
At its end it prints a `visit` line: dial → first frame exact on the thread that paints, → first painted (after the
GPU's queue drained, with `--stamp-painted`), → last frame of the series exact, and the p99 of the gaps between frames'
arrivals off the wire (`Event::Frame`'s `at`, sorted). `count::tests` hold the times (five mutants, each failing them), `client/paint/window.mjs` the
end on each paint thread (seven). One survived the first form of the check — the `ui`
window ending at frame 0, unseen while its frames arrived in one burst — and the check now spaces them with the
cache's write delay.

**Protocol: M2's**, with these changes and nothing else.

* **Native arms**, one per paint thread: `native-window --paint-thread ui|view|core --exit --stamp-painted --size
  1280x691 --budget 268435456`, on one Xvfb (`-noreset`, on the client cores) and lavapipe. The budget holds either
  series decoded, so the want of `view` and `core` is the whole series and the fill runs to its end. Decoders
  `min(3, cores)` = 2 under the pinning, printed with every setting in each row.
* **Browser arm**: M2's `browser.mjs`, the viewer at the core's default, `?view=page` (its status line prints `view
  page`), Chrome for Testing 153.0.8010.12 headless, SwiftShader, canvas 1280×691.
* **Cells**: the fill only; loopback and 20 Mbit clean (`link_impair.py`, 40 ms each way, its 50-packet queue,
  `--self-timing`); the 61 MB and the 4.4 MB series (below). 4 cells × 4 arms × A and A2 = 32 visits a round, in
  `lab/scripts/order.py`'s Williams order (`lab/order.mjs` for Python), 7 rounds, 224 visits. A fresh server per visit,
  warmed by one unrecorded `native-fill` fill. Pinning M2's: server on core 0, relay on 1, every client process
  (Chromium's, the window, Xvfb) on 2–3.
* **Metrics, one per cell.** *Latency*: dial to the first exact frame on screen — the window's `first_shown_ms`, the
  browser's `firstShown` with its paint settled (`settlePaint`, `lab/viewer/levers.js`). *Throughput*: the fill after
  the first frame, dial to the last frame exact less dial to the first; the window counts a frame exact on the thread
  that paints, the browser on the page. It is quoted as a time over a fixed series, not as a rate. Printed, not judged:
  the window's inter-arrival p99 and every core's busy share.
* **Predictions**, from M2's `native-fill` (§6): (i) the first exact frame on screen is earlier — native ÷ browser
  ≤ 0.9 *and* ≥ 16.7 ms earlier, round-paired medians — in every cell (M2: 0.30–0.33 on loopback, 0.76–0.90 on the
  relay); (ii) on loopback the fill after the first frame is ≤ 0.6 × the browser's (M2's P1); (iii) at 20 Mbit it is
  within ±3 % (M2's P2).
* **`VOID`**: a visit whose relay p99 is over 1 ms; a cell, for a paint thread, where its or the browser's A2/A median
  strays past half its band — fill ±20 % on loopback and ±1.5 % at 20 Mbit (M2's), first frame ±5 % (new). Under 3
  round pairs a cell is undecided.
* **Saturation guard**: per visit, the client cores' busy share from `/proc/stat` (steal counts as busy), and the relay
  core's in the relay cells. A cell is saturated for a paint thread where its arm or the browser runs the client cores
  ≥ 0.9 busy at the median, or the relay core ≥ 0.8: its ratio is printed and nothing is claimed. M2's browser ran its
  two cores at 0.96 on loopback, so the loopback cells are expected to claim nothing.
* **Rule.** For each paint thread: **"M2's reading holds for the window"** if every decided cell — not `VOID`, not
  saturated — holds its prediction and at least one is decided; **"does not hold"**, naming the cells, if any decided
  cell fails; else **undecided**. A visit with any frame not exact is failed and not counted.
* **Not symmetric, stated:** under `ui` the dial starts as the window opens, so its first frame waits on the UI thread's
  surface and adapter set-up; under `view` and `core` the dial follows them; the browser dials after its page's load.
  Both clients render in software (lavapipe, SwiftShader): nothing here is a GPU, vblank or on-screen-on-time claim.

**The series**, made by `lab/native-fill/run.py --make-series DIR` (`lab/scripts/gen_frame_pnm.py`, OpenJPH 0.31.0's
`ojph_compress` in the served profile, `pack-series`; digests from the generated samples). The generator is seeded by
the frame's index, so the bundles are the same bytes on every run; they are not committed, and their SHA-256 is here
to check a rebuild against.

| series | frames | size, bits | content | coded | `.sbnd` SHA-256 |
| --- | ---: | --- | --- | ---: | --- |
| `large` | 37 | 1024 × 1024, 16 | `field` | 60.69 MB | `48fecc5a920dbf30fab1b779b67a16311a52fb5a1bf2b777f1bddf56d927ffca` |
| `small` | 102 | 512 × 512 RGB, 8 | `cine` | 4.42 MB | `e9116f5ba90940574d022b189904bfe1b9f03e843f318b2122742e179fa4f5c0` |
| `mammo` | 16 | 3328 × 4096, 12 of 16 | `ct` | 211.96 MB | `d0463adef52d7f7957c9c49bfe2f52d05386a2c7a416e092d9e911ff0c1cb464` |

M2's two series came out at the same coded sizes; its bundles were not kept, so byte identity with them is not shown.
`mammo` is the memory and step cells' series (436 MB decoded), 12 bits stored as the real 3328 × 4096 mammograms are
(`docs/FIXTURES.md`); the generator writes `bitsStored` from the largest sample. The three took 4 min 22 s on 4 cores.
