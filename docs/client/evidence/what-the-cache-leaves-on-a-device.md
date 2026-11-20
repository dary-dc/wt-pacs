# What the cache leaves on a device

**Question:** Once decoded frames are kept on a device, what does that oblige, who must protect them, and with what
options and defaults?

*Folded 2026-11-14 from `claude/cache-policy:docs/adr/frame-path.md` §What keeping frames on the device obliges, its
§Questions for the owner 7 and §Sources, 2026-10-28 (18d9b413, reviewed in 680c9b49), word for word. "Lever N" there is
[the cache's choice N](cache-in-opfs.md#the-choices-and-what-decides-each) here; §Where it saturates is in
[`cache-in-opfs.md`](cache-in-opfs.md); #204's M1 and M2 are [the cache's](cache-in-opfs.md) measurements; a bare §N is
a section of `docs/adr/frame-path.md` ([its map](../../adr/frame-path.md)). Mostly theory (sources read); two things
measured on one 4-vCPU container, Chromium 153 headless Linux only, by scripts not committed. The survey of where the
cache keeps frames is [`cache-options.md`](cache-options.md). The design these findings shape is
[`../design.md`](../design.md).*

## What keeping frames on the device obliges · 2026-10-28

**Status:** research for the owner, theory only; nothing here is built. The owner, 2026-10-27: "I don't get the
problem here, but I do want the options researched." Sources: §Sources, 2026-10-28. A risk note, not legal advice.

**The problem in plain words.** Without the cache, a closed tab leaves no image behind. With it, every frame a reader
opened stays in a file on the device until the browser or the store deletes it (choice 5), across restarts, readable
by anyone who can reach that file. The duty to protect it falls on whoever runs the product — under HIPAA the covered
entity or its business associate, under GDPR the controller — not on the code. The code's job is to give them a
setting that meets their duty, and to say what each setting does.

* **What is stored** (`client/viewer/store.js`): per series, a directory named after the session URL, holding the
  decoded samples of every frame checked `true` and a manifest (the digest list, the frame's shape, the last open).
  No name, ID, birth date, accession number or UID: the ingest copies none ([`../FIXTURES.md`](../../FIXTURES.md)
  §The metadata). So the frames are bare pixels keyed by a URL, not de-identified data. The deployment can map the
  URL back to a patient; a pixel can carry a name burned in; and a volume rendering of a high-resolution head
  CT or MR "might produce recognizable visual features" (ACR–AAPM–SIIM, below, §V.D). Pseudonymised data stays
  personal data under GDPR (Recital 26), and an image revealing "health status" is "data concerning health" (Art. 4(15)).
  Treat the cache as protected health information. Choice 6's next key, the series' UID, would add an identifier.
* **Where it lives, and whether it is encrypted.** The specs leave both to the browser: a file's "actual physical
  location … is implementation-defined" (fs), and neither spec contains the word "encrypt". **Measured** (Chromium
  153, headless, Linux, run once): a file written to OPFS lies in the profile under
  `Default/File System/000/t/00/00000001`, **byte-identical** to what the page wrote, mode `0600`, and the origin is
  named in `Default/WebStorage/QuotaManager`. Gecko and WebKit were not run (no build here). So the only encryption
  is the device's own: an Android device launched on API 29 or later "MUST enable the data storage encryption by
  default" (CDD 15 §9.9.2); iOS gives every app's files Data Protection; macOS 26.4 turns FileVault on by default,
  and the user can turn it off (Apple, 2026-08-03). Windows and Linux were not read: assume off unless IT turned it on.
* **Who could read it.** Device encryption protects a device that is off or locked, not one in use:

  | who | can read the cache |
  | --- | --- |
  | a thief with a lost phone or PC, device encryption on | no while it is off; after the first unlock since boot the default classes keep their keys in memory, so the lock screen is the barrier (not traced per browser) |
  | the same, encryption off (an unmanaged Windows or Linux PC) | yes: a plain file |
  | anyone using the unlocked device in the same OS account and browser profile — a shared ward PC under one login | yes: the page's own origin opens it |
  | another OS user on the same PC | no by file mode; an administrator, yes |
  | another program running as the same user on a desktop | yes; phone apps are kept apart by the OS (not traced) |
  | another website | no: storage is keyed by origin (Storage §Storage keys) |

**What each source says.**

| source | what it says | binding? |
| --- | --- | --- |
| AAPM Report 260 (2018) §6 | "The MV, as any other healthcare IT system, must be HIPAA-compliant… the client software should leave no persistent data on the mobile device after either a normal or abnormal program termination." | guidance, "should"; handhelds only. An abnormal termination is a crash or a killed tab, so clearing on close alone does not meet it |
| 45 CFR 164.312, in force | "(iii) Automatic logoff (Addressable)… (iv) Encryption and decryption (Addressable). Implement a mechanism to encrypt and decrypt electronic protected health information." Addressable (164.306(d)(3)): assess it; implement it if "reasonable and appropriate", else "document why" and implement "an equivalent alternative measure if reasonable and appropriate" | law, on the covered entity or business associate |
| breach notice, 164.402 and 74 FR 42740 (2009) | only "unsecured" PHI triggers a breach notice. Encrypted data is secured if consistent with NIST SP 800-111 and the key "has not been breached"; "these decryption tools should be stored on a device or at a location separate from the data" | what makes a lost device a non-event |
| HIPAA proposed rule, 90 FR 898 (2025-01-06), **read 2026-10-28** | proposed 164.312(b)(2): "Encrypt all electronic protected health information at rest and in transit", except where documented exceptions apply (a device that cannot, an emergency, a patient's request, an FDA-authorized device); it would "remove the distinction between required and addressable"; automatic logoff becomes a plain "Deploy technical controls…"; a workstation "includes… mobile device such as a smart phone or tablet". It does not say at which layer encryption must happen | **a proposal.** The Federal Register lists no final rule under RIN 0945-AA22 as of 2026-10-28 |
| GDPR Art. 32(1) | "appropriate technical and organisational measures to ensure a level of security appropriate to the risk, including inter alia as appropriate: (a) the pseudonymisation and encryption of personal data". Art. 34(3)(a): the people affected need not be told of a breach if the data was made "unintelligible to any person who is not authorised to access it, such as encryption" | law, on the controller; risk-based, no layer named |
| ACR–AAPM–SIIM Practice Parameter for Electronic Medical Information Privacy and Security (rev. 2019, amended 2023) | IV.F.3: "all health data at rest on a mobile device should be encrypted, and data at rest on nonmobile devices should strongly be considered a candidate for encryption"; IV.E.6: mobile devices managed so that IT can "allow for remote wipe"; IV.E.7: "Storage media containing patient data that is not actively being processed need to be encrypted"; IV.B.3: users "should generally be required to reauthenticate after 30 minutes of inactivity" | guidance ("not inflexible rules") |

Read together: none forbids a cache. Only AAPM 260 asks that nothing persist, and only on a handheld. The rest ask
for encryption at rest, weighed against the risk today and, if the proposed rule is finalized as written, outright
save its listed exceptions. None says whether the device's own encryption suffices. Breach law adds the practical
test: a lost device holding the data and its key is presumed a breach to notify, unless a risk assessment shows a
low probability of compromise (164.402).

**The options.** The fill to compare against is #204's M1, at 20 Mbit with 20 ms each way. The fill
F against a reopen from the cache R: 256 × 512² 7.49 s against 174 ms, or 70.5 s against 187 ms at 2 % loss;
32 × 3328×4096 31.1 s against 712 ms.

| option | code (guessed) | reopen | satisfies | leaves open |
| --- | --- | --- | --- | --- |
| **A · keep as built**: plain files, relying on device encryption, the OS login and the browser profile | none | R | HIPAA today, if the deployer's assessment documents device encryption as the measure; ACR IV.F.3 where the device encrypts | AAPM 260; anyone at the unlocked device or in a shared profile; a desktop without disk encryption |
| **B1 · encrypt, key per session**: AES-GCM, a non-extractable key held in memory only | ~40 client lines | F: the key dies with the tab, so nothing reopens | AAPM 260's crash case: a killed tab leaves only ciphertext | no reuse across sessions; worth having only with E |
| **B2 · encrypt, key kept on the device** (IndexedDB) | ~40 | R + decrypt | nothing: the key sits in the same profile as the data, failing 74 FR 42740's "separate" | rejected |
| **B3 · encrypt, key from the server** after the reader signs in, held in memory, revocable | ~40 client lines plus a key service on the server; **needs reader identity, which the product does not have** (#193's viewer requirements, §Open) | R + decrypt, predicted below | a lost device holds ciphertext without its key: secured under 74 FR 42740 if the cipher counts under SP 800-111 (a compliance call); ACR IV.F.3; the proposed rule; a revoked key wipes every device's cache at once | AAPM 260 strictly: data still persists |
| **C · retention (TTL), and clear at logout or idle** | ~15 lines: the store already reads every series' last open (`evictOne`) | R inside the limit, F past it | shortens exposure; an idle clear at 30 minutes matches ACR IV.B.3 if it also ends the session | **runs only while the page runs**: a lost device or a closed browser is never swept. Logout needs identity |
| **D · opt-in per deployment or per device** ("keep images on this device") | a configuration flag and one control | as chosen | puts the call where the duty is: the deployer, or the reader who knows the device | a reader's choice on a personal phone |
| **E · session-only**: cleared when the page closes, and everything not held swept at the next open | ~10 lines | F on every reopen; within a session the store still lifts the RAM ceiling for a multi-GB series (choice 2, once #204's M2 leak is fixed) | AAPM 260 for a normal close; with B1 also for a crash | no reuse across sessions; a phone refetches every study |
| **F · a policy set by the deployment**: the server says `none`, `session` or `persistent`, with a retention and whether a server key is needed; the client obeys | one field, plus whichever of A–E it may select | per policy | lets each deployment meet its own assessment | the default, below |

**What encryption costs** (B1, B3). **Measured** on this container (Chromium 153, page thread, AES-GCM-256, 9
repeats, median [range]) by scripts not committed. A first run: 0.52 MB encrypts in 2.44 ms [2.23–6.25] and decrypts
in 2.46 [1.93–2.74]; 27.3 MB in 166 ms [149–372] and 158 [59–198]. *Corrected in review, 2026-10-28:* four later
runs read 0.42–0.63 and 0.50–0.58 ms for 0.52 MB, 66–84 and 64–179 ms for 27.3 MB, the 4-vCPU host at a load of ~10,
saturated. So decrypting a 3328×4096 frame costs 64–179 ms here; nothing finer is claimed. Three consequences, **predicted** by adding to M1, not
measured together:

* **Reopen.** M1's read + re-check is 0.68–0.73 ms a 512² frame and 22.3 ms a 3328×4096 one; decryption adds
  0.5–2.5 and 64–179 ms. Reopen then takes 0.3–0.8 s against a 7.49 s fill (256 × 512²) and 2.8–6.4 s against
  31.1 s (32 × 3328×4096). It still beats the link, by less.
* **Choice 1 may turn over.** Decrypting a 3328×4096 frame (64–179 ms) costs about as much as decoding it or more
  (69–72 ms, HTJ2K). If more, coded bytes — fewer to decrypt, then decoded — would reopen faster than decoded
  samples under encryption. That breaks the no-re-decoding rule; an interleaved run on an idle host decides it, and
  it is the owner's to weigh if B is chosen. *Corrected in review:* this said it turns over, from the first run alone.
* **The write and the layout.** WebCrypto refuses a `SharedArrayBuffer` view (**measured**, reproduced in review:
  "must not be shared"). So each frame is copied out to encrypt it and copied back into shared memory after
  decryption. GCM adds a 12-byte IV and a 16-byte tag per frame, so frame `i` moves to `i × (frameBytes + 28)`. The
  IV must not repeat under one key: a frame rewritten after a failed check needs a fresh one, so the IV is stored,
  not derived from `i`. Encryption ran at 164–414 MB/s on the page thread, against §Where it saturates' 125 MB/s
  ceiling; the store worker's rate is not measured.

**Recommended defaults** (F as the frame, the deployment's setting overriding):

| deployment | default | why |
| --- | --- | --- |
| hospital workstation: managed, disk encrypted by IT, one OS account per person | **A + C**: persistent, a retention the deployment sets, LRU otherwise (choice 5); clear at logout once identity exists | the device's encryption and the person's own login are the measure HIPAA's assessment can document; the reopen gain (~43× at 20 Mbit, M1) is largest on the workstation that reads every day |
| shared workstation under one login, a reading room PC, or any PC whose disk is not known to be encrypted | **E** | the profile is shared, so device encryption protects nothing from the next user |
| personal phone or tablet, unmanaged | **E + B1** | AAPM 260 asks for nothing left after a crash, and the ACR and the proposed rule want a phone's data at rest encrypted. The cost is a refetch per study: 7.49 s for 256 × 512² at 20 Mbit. Primary mammography stays off phones anyway (#193's viewer requirements, item 16) |
| managed phone or tablet (MDM, remote wipe) | **B3 + C** once reader identity exists; **E + B1** until then | the key off the device makes a lost one a non-event, and revoking it is the remote wipe ACR IV.E.6 asks for |

**What decides it:** whether the device is managed and its disk encrypted; whether the browser profile is one
person's; whether the product gains reader identity, without which no key can live off the device (B3) and no
logout can clear (C); the deployer's own risk assessment, which is theirs to sign; and the link, which sets what a
refetch costs. If the proposed rule is finalized as written, A stands only where the deployer documents device
encryption as meeting "encrypt all … at rest"; B3 meets it without that argument.

**Not traced:** Gecko's and WebKit's OPFS files on disk; whether the viewer's metadata fetch lands in the HTTP cache;
how an engine stores a non-extractable key; whether a phone's other apps can reach a browser's profile; WebCrypto's
speed on a phone.


## The question for the owner

7\. **What the cache may leave on a device:** a policy the deployment sets, defaulting by device kind as recommended
above? It turns on reader identity, which the product lacks. (`claude/cache-policy` §Questions for the owner, 7.)

## Sources, 2026-10-28


Fetched 2026-10-28 for §What keeping frames on the device obliges and added to
`claude/cache-policy:docs/adr/frame-path-sources.txt`; whatwg/fs and whatwg/storage at `main` that day, not §9's pins.

| claim | source |
| --- | --- |
| no persistent data on a handheld | AAPM Report 260 (2018) §6 |
| addressable logoff and encryption; what addressable means | eCFR 45 CFR 164.312(a)(2)(iii)–(iv), 164.306(d)(3) |
| unsecured PHI; encryption per SP 800-111, the key kept apart | eCFR 45 CFR 164.402; 74 FR 42740 (2009-08-24), §II |
| the proposed rule: encrypt at rest, no addressable, logoff, workstation | 90 FR 898 (2025-01-06), proposed 164.312(b), 164.304, and the preamble on 164.306; Federal Register API, RIN 0945-AA22 |
| security appropriate to the risk; no notice if unintelligible; pseudonymised is personal; health data | GDPR Art. 32(1), 34(3)(a), 4(15), Recital 26 |
| mobile data at rest encrypted; remote wipe; media encrypted; re-authentication; faces | ACR–AAPM–SIIM Practice Parameter for Electronic Medical Information Privacy and Security, rev. 2019, amended 2023: IV.B.3, IV.E.6–7, IV.F.3, V.D |
| the physical location implementation-defined; no word "encrypt" | fs `index.bs` 300–306; storage `storage.bs` 208–217; both, searched |
| Android encrypts by default | Android 15 CDD §9.9.2 |
| iOS Data Protection; macOS 26.4 FileVault by default | Apple Platform Security, *Data Protection overview*, 2026-08-03 |

**Measured here:** OPFS on disk and WebCrypto's speed and refusal of shared memory, Chromium 153 on this container,
by scripts not committed; the file on disk and the refusal reproduced in review, the speed not (above).
