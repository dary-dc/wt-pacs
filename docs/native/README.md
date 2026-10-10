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
8. [Sources](#8-sources)

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

**Size and upload.** A 4096×3072 frame fits wgpu's default 8192 limit and every first-class backend (D3D12 16 384,
Metal ≥ 8192); the `downlevel_*` limits cap textures at 2048 and must not be requested. `write_texture` needs no
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

**Headless.** wgpu's own CI runs its GPU tests on Mesa lavapipe (Linux) and WARP (Windows); whether lavapipe runs in
this container is unknown — the first row finds out (§6, M1).

## 3. The cache

Where a frame cache belongs, and whether the OS takes it back:

| OS | place | evicted by the OS | note |
| --- | --- | --- | --- |
| Linux | `$XDG_CACHE_HOME` | not in the spec | |
| Windows | `%LOCALAPPDATA%` | not documented | |
| macOS | `~/Library/Caches` | unknown | |
| iOS | Application Support + `isExcludedFromBackup` (set again on every save) | Caches can be purged when space is very low, never while the app runs | encrypted by default (Data Protection class C); class A (`complete`) locks the cache ~10 s after the device locks, which stops a background prefetch |
| Android | `getFilesDir` | `getCacheDir` is deleted oldest-first under a moving quota and "designed to store a small amount" | file-based encryption on Android 10+ |
| browser (today) | OPFS | best-effort unless persisted; ≈ 60 % of disk per origin (Chrome, Safari), 15 % in a web view; Safari deletes script-written storage after 7 days without interaction | not built ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §Open) |

**What a cache must do on any OS**, from the exactness ADR ([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md)
§8, *A client cache*): hold only frames whose check is `true`, never key by digest, and re-check on read. From the
file systems: write to a temporary name and rename (atomic on POSIX; Linux also needs the directory fsynced; Apple
needs `F_FULLFSYNC` for durability; Windows' replace atomicity is unknown); a memory-mapped reader must survive a
truncated file (`SIGBUS`); every read must tolerate a missing file. A packed file per series or a file per frame is
open: not weighed by any source read.

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
* **M2 NATIVEFILL — fill time and the ask, native against the browser, one machine** (container). Arms: today's
  browser client (headless Chromium, WASM decoders, the gl painter on SwiftShader) and a lab native client (the
  `lab/window-harness` transport, native OpenJPH, M1's painter on lavapipe). The lever is the client as a whole;
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
* **M3 CACHE — a file-system cache, verified and crash-safe** (container). A verified-frames-only cache in the core,
  written by temporary name, fsync and rename. Cells: reopen a 61 MB series from the cache against from the relay at
  20 Mbit; a process killed at random points during 100 writes. Predictions: the reopen is ≤ 0.5 s against ≈ 24 s;
  after every kill each frame is either absent or passes its check, 100 of 100; a byte flipped on disk is refused on
  read and fetched again. Rule: all three hold, or the cache's design is revised before any phone run.
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
2. **The shape** (§4): Rust core + native UI per platform; a pure-Rust GUI (Slint the only one on all five, with its
   licence); Qt; Flutter. What decides it: the team's languages and how much accessibility the mobile UI needs.
3. **The cache's policy**: a persistent on-device cache or none (AAPM 260's advice); its budget; on iOS, data
   protection class C (prefetch works locked) or A (cache closed ~10 s after lock).
4. **The intended use, for a regulatory specialist**: diagnostic display (892.2050, MDR Rule 11) or display only —
   the same answer for page and app, but it sets what the app's store listing and device list must carry.
5. **Distribution**: the public stores, or hospital channels (Apple Business Manager custom apps, managed Google Play
   private apps) and a desktop update channel per OS.

## 8. Sources

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
