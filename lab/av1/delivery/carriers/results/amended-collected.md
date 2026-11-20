rounds 94; VOID blocks 0

| volume · block | A/A: median log (interval), n | A/A | arms flagged by order (p) |
| --- | --- | --- | --- |
| dbts_a1 · k 1 | -0.0047 (-0.0106, 0.0009), 94 | passes | — |
| dbts_a1 · k 4 | -0.0022 (-0.0081, 0.0034), 94 | passes | — |
| dbts_a1 · k 8 | -0.0054 (-0.0106, 0.0006), 94 | passes | — |
| dbts_a1 · k 16 | -0.0019 (-0.0139, 0.0047), 94 | passes | — |
| dbts_b1 · k 1 | -0.0058 (-0.0108, -0.0016), 94 | fails: not read | — |
| dbts_b1 · k 4 | +0.0010 (-0.0051, 0.0058), 94 | passes | — |
| dbts_b1 · k 8 | +0.0006 (-0.0029, 0.007), 94 | passes | — |
| dbts_b1 · k 16 | +0.0020 (-0.0021, 0.0076), 94 | passes | — |
| dbts_c1 · k 1 | +0.0015 (-0.0075, 0.0061), 94 | passes | — |
| dbts_c1 · k 4 | +0.0026 (-0.0009, 0.0076), 94 | passes | — |
| dbts_c1 · k 8 | -0.0024 (-0.0058, 0.0037), 94 | passes | — |
| dbts_c1 · k 16 | +0.0052 (-0.0036, 0.013), 94 | passes | — |

A/A decided (interval excludes 0) in 1 of 12 readable blocks

## dbts_a1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 117 | 94 |
| lay-k4 | 561444 | 101 | 94 |
| lay-k8 | 505513 | 100 | 94 |
| lay-k16 | 480587 | 98.8 | 94 |
| sep-g1 | 593980 | 106 | 94 |
| sep-g4 | 374618 | 96.9 | 94 |
| sep-g8 | 350976 | 99.7 | 94 |
| sep-g16 | 340578 | 102 | 94 |
| sep-g32 | 334779 | 105 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: on the frontier; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2.03 | 94 |
| lay-k4 | 561444 | 1.76 | 94 |
| lay-k8 | 505513 | 1.77 | 94 |
| lay-k16 | 480587 | 1.74 | 94 |
| sep-g1 | 593980 | 1.83 | 94 |
| sep-g4 | 374618 | 1.75 | 94 |
| sep-g8 | 350976 | 1.79 | 94 |
| sep-g16 | 340578 | 1.81 | 94 |
| sep-g32 | 334779 | 1.86 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: dominated; sep-g4: dominated; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 999598 | 2.2 | 94 |
| lay-k4 | 561444 | 4.84 | 94 |
| lay-k8 | 505513 | 8.31 | 94 |
| lay-k16 | 480587 | 14.8 | 94 |
| sep-g1 | 593980 | 2.07 | 94 |
| sep-g4 | 374618 | 4.55 | 94 |
| sep-g8 | 350976 | 8.18 | 94 |
| sep-g16 | 340578 | 15 | 94 |
| sep-g32 | 334779 | 28.4 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 11.9 | 94 |
| lay-k4 | 2301819 | 21.6 | 94 |
| lay-k8 | 3844438 | 34.9 | 94 |
| lay-k16 | 6632562 | 59 | 94 |
| sep-g1 | 1209191 | 3.48 | 94 |
| sep-g4 | 1211395 | 5.89 | 94 |
| sep-g8 | 1212492 | 9.54 | 94 |
| sep-g16 | 1213667 | 16.4 | 94 |
| sep-g32 | 1212396 | 29.8 | 94 |
| whole | 1213665 | 1.01 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 11.9 | 94 |
| lay-k4 | 2301819 | 21.6 | 94 |
| lay-k8 | 3844438 | 34.9 | 94 |
| lay-k16 | 6632562 | 59 | 94 |
| sep-g1 | 1209191 | 1.42 | 94 |
| sep-g4 | 1211395 | 1.41 | 94 |
| sep-g8 | 1212492 | 1.42 | 94 |
| sep-g16 | 1213667 | 1.37 | 94 |
| sep-g32 | 1212396 | 1.37 | 94 |
| whole | 1213665 | 1.01 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier; whole: on the frontier

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1148067 | 11.1 | 94 |
| lay-k4 | 2301819 | 10.5 | 94 |
| lay-k8 | 3844438 | 10.4 | 94 |
| lay-k16 | 6632562 | 10.4 | 94 |
| sep-g1 | 1209191 | 3.39 | 94 |
| sep-g4 | 1211395 | 3.19 | 94 |
| sep-g8 | 1212492 | 3.19 | 94 |
| sep-g16 | 1213667 | 3.19 | 94 |
| sep-g32 | 1212396 | 3.23 | 94 |
| whole | 1213665 | 1.01 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 11.8 | 94 |
| lay-k4 | 21030 | 6.3 | 94 |
| lay-k8 | 14985 | 5.26 | 94 |
| lay-k16 | 12525 | 4.9 | 94 |
| sep-g1 | 33700 | 124 | 94 |
| sep-g4 | 11713 | 50.1 | 94 |
| sep-g8 | 8069 | 39.4 | 94 |
| sep-g16 | 6964 | 34.4 | 94 |
| sep-g32 | 6560 | 30.8 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 55361 | 0.205 | 94 |
| lay-k4 | 21030 | 0.0843 | 94 |
| lay-k8 | 14985 | 0.0788 | 94 |
| lay-k16 | 12525 | 0.0783 | 94 |
| sep-g1 | 33700 | 2.17 | 94 |
| sep-g4 | 11713 | 0.493 | 94 |
| sep-g8 | 8069 | 0.45 | 94 |
| sep-g16 | 6964 | 0.457 | 94 |
| sep-g32 | 6560 | 0.469 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

**dbts_a1: the layered stream stays a candidate** — on the frontier: lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none

## dbts_b1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 98.5 | 94 |
| lay-k4 | 3733448 | 82.4 | 94 |
| lay-k8 | 3540776 | 79.7 | 94 |
| lay-k16 | 3444154 | 79.9 | 94 |
| sep-g1 | 3933823 | 71.7 | 94 |
| sep-g4 | 2988282 | 89.1 | 94 |
| sep-g8 | 2873243 | 93.5 | 94 |
| sep-g16 | 2815195 | 93.8 | 94 |
| sep-g32 | 2783727 | 95.2 | 94 |

lay-k1: not read; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: not read; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: dominated; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 1.92 | 94 |
| lay-k4 | 3733448 | 1.54 | 94 |
| lay-k8 | 3540776 | 1.52 | 94 |
| lay-k16 | 3444154 | 1.51 | 94 |
| sep-g1 | 3933823 | 1.38 | 94 |
| sep-g4 | 2988282 | 1.8 | 94 |
| sep-g8 | 2873243 | 1.86 | 94 |
| sep-g16 | 2815195 | 1.85 | 94 |
| sep-g32 | 2783727 | 1.85 | 94 |

lay-k1: not read; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: not read; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 5260859 | 2.09 | 94 |
| lay-k4 | 3733448 | 4.27 | 94 |
| lay-k8 | 3540776 | 7.42 | 94 |
| lay-k16 | 3444154 | 13.2 | 94 |
| sep-g1 | 3933823 | 1.52 | 94 |
| sep-g4 | 2988282 | 4.25 | 94 |
| sep-g8 | 2873243 | 8.13 | 94 |
| sep-g16 | 2815195 | 15.5 | 94 |
| sep-g32 | 2783727 | 27.3 | 94 |

lay-k1: not read; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: not read; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.58 | 94 |
| lay-k4 | 4864780 | 13.7 | 94 |
| lay-k8 | 8712266 | 23.9 | 94 |
| lay-k16 | 16407909 | 42.9 | 94 |
| sep-g1 | 2086410 | 2.97 | 94 |
| sep-g4 | 2086775 | 5.71 | 94 |
| sep-g8 | 2088401 | 9.57 | 94 |
| sep-g16 | 2085900 | 17.1 | 94 |
| sep-g32 | 2084952 | 28.7 | 94 |
| whole | 2149534 | 1.03 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: not read; sep-g4: not read; sep-g8: dominated; sep-g16: not read; sep-g32: not read; whole: not read

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.58 | 94 |
| lay-k4 | 4864780 | 13.7 | 94 |
| lay-k8 | 8712266 | 23.9 | 94 |
| lay-k16 | 16407909 | 42.9 | 94 |
| sep-g1 | 2086410 | 1.44 | 94 |
| sep-g4 | 2086775 | 1.47 | 94 |
| sep-g8 | 2088401 | 1.45 | 94 |
| sep-g16 | 2085900 | 1.48 | 94 |
| sep-g32 | 2084952 | 1.54 | 94 |
| whole | 2149534 | 1.03 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: not read; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: not read; whole: not read

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1979502 | 6.4 | 94 |
| lay-k4 | 4864780 | 5.55 | 94 |
| lay-k8 | 8712266 | 5.52 | 94 |
| lay-k16 | 16407909 | 5.43 | 94 |
| sep-g1 | 2086410 | 3 | 94 |
| sep-g4 | 2086775 | 3.56 | 94 |
| sep-g8 | 2088401 | 3.49 | 94 |
| sep-g16 | 2085900 | 3.41 | 94 |
| sep-g32 | 2084952 | 3.42 | 94 |
| whole | 2149534 | 1.02 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: not read; sep-g4: dominated; sep-g8: dominated; sep-g16: not read; sep-g32: not read; whole: not read

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 6.19 | 94 |
| lay-k4 | 56269 | 3.93 | 94 |
| lay-k8 | 41497 | 3.66 | 94 |
| lay-k16 | 34285 | 3.78 | 94 |
| sep-g1 | 124659 | 141 | 94 |
| sep-g4 | 46071 | 59 | 94 |
| sep-g8 | 37661 | 50.8 | 94 |
| sep-g16 | 34423 | 45.6 | 94 |
| sep-g32 | 32072 | 42.5 | 94 |

lay-k1: not read; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: not read; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 153756 | 0.118 | 94 |
| lay-k4 | 56269 | 0.0634 | 94 |
| lay-k8 | 41497 | 0.0671 | 94 |
| lay-k16 | 34285 | 0.0699 | 94 |
| sep-g1 | 124659 | 2.76 | 94 |
| sep-g4 | 46071 | 0.62 | 94 |
| sep-g8 | 37661 | 0.73 | 94 |
| sep-g16 | 34423 | 0.752 | 94 |
| sep-g32 | 32072 | 0.768 | 94 |

lay-k1: not read; lay-k4: on the frontier; lay-k8: on the frontier; lay-k16: on the frontier; sep-g1: not read; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

**dbts_b1: the layered stream stays a candidate** — on the frontier: lay-k16 (high view, cine playback); lay-k16 (high view, scroll to the next slice); lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: lay-k1 (high view, cine playback); lay-k1 (high view, scroll to the next slice); lay-k1 (high view, jump to a random slice)

## dbts_c1

### high view, cine playback

| configuration | bytes | cine-high total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 152 | 94 |
| lay-k4 | 805763 | 115 | 94 |
| lay-k8 | 718273 | 109 | 94 |
| lay-k16 | 678736 | 108 | 94 |
| sep-g1 | 855349 | 142 | 94 |
| sep-g4 | 560159 | 117 | 94 |
| sep-g8 | 524674 | 115 | 94 |
| sep-g16 | 508311 | 114 | 94 |
| sep-g32 | 502089 | 114 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, scroll to the next slice

| configuration | bytes | cine-high frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.14 | 94 |
| lay-k4 | 805763 | 1.49 | 94 |
| lay-k8 | 718273 | 1.49 | 94 |
| lay-k16 | 678736 | 1.5 | 92 |
| sep-g1 | 855349 | 2.01 | 94 |
| sep-g4 | 560159 | 1.66 | 94 |
| sep-g8 | 524674 | 1.64 | 93 |
| sep-g16 | 508311 | 1.62 | 94 |
| sep-g32 | 502089 | 1.63 | 93 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### high view, jump to a random slice

| configuration | bytes | jump ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 1408340 | 2.35 | 94 |
| lay-k4 | 805763 | 4.61 | 94 |
| lay-k8 | 718273 | 7.8 | 94 |
| lay-k16 | 678736 | 13.3 | 94 |
| sep-g1 | 855349 | 2.25 | 94 |
| sep-g4 | 560159 | 4.55 | 94 |
| sep-g8 | 524674 | 8.01 | 94 |
| sep-g16 | 508311 | 14 | 94 |
| sep-g32 | 502089 | 26.8 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: on the frontier; sep-g16: on the frontier; sep-g32: on the frontier

### exact on request, after a jump

| configuration | bytes | exact cold ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 10.7 | 94 |
| lay-k4 | 1965659 | 18.8 | 94 |
| lay-k8 | 3231693 | 30.3 | 94 |
| lay-k16 | 5780837 | 50.6 | 94 |
| sep-g1 | 1018954 | 3.72 | 94 |
| sep-g4 | 1019171 | 6 | 94 |
| sep-g8 | 1019914 | 9.45 | 94 |
| sep-g16 | 1020647 | 15.5 | 94 |
| sep-g32 | 1021025 | 28.3 | 94 |
| whole | 1026553 | 1.02 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, frame i

| configuration | bytes | dwell first ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 10.7 | 94 |
| lay-k4 | 1965659 | 18.8 | 94 |
| lay-k8 | 3231693 | 30.3 | 94 |
| lay-k16 | 5780837 | 50.6 | 94 |
| sep-g1 | 1018954 | 1.46 | 94 |
| sep-g4 | 1019171 | 1.45 | 94 |
| sep-g8 | 1019914 | 1.45 | 94 |
| sep-g16 | 1020647 | 1.46 | 94 |
| sep-g32 | 1021025 | 1.43 | 94 |
| whole | 1026553 | 1.02 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### exact on request, dweller, then i + 1

| configuration | bytes | dwell next ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 968826 | 9.81 | 94 |
| lay-k4 | 1965659 | 9.12 | 94 |
| lay-k8 | 3231693 | 8.91 | 94 |
| lay-k16 | 5780837 | 8.94 | 94 |
| sep-g1 | 1018954 | 3.59 | 94 |
| sep-g4 | 1019171 | 3.17 | 94 |
| sep-g8 | 1019914 | 3.12 | 94 |
| sep-g16 | 1020647 | 3.1 | 94 |
| sep-g32 | 1021025 | 3.08 | 94 |
| whole | 1026553 | 1.02 | 94 |

lay-k1: on the frontier; lay-k4: dominated; lay-k8: dominated; lay-k16: dominated; sep-g1: on the frontier; sep-g4: on the frontier; sep-g8: dominated; sep-g16: dominated; sep-g32: dominated; whole: on the frontier

### cheap view, cine playback

| configuration | bytes | cine-cheap total ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 15.2 | 94 |
| lay-k4 | 32542 | 7.62 | 94 |
| lay-k8 | 23613 | 6.32 | 94 |
| lay-k16 | 19505 | 5.79 | 94 |
| sep-g1 | 45945 | 165 | 94 |
| sep-g4 | 16689 | 66.8 | 94 |
| sep-g8 | 11614 | 49.1 | 94 |
| sep-g16 | 9591 | 41.7 | 94 |
| sep-g32 | 8740 | 40.5 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: dominated; sep-g32: on the frontier

### cheap view, scroll to the next slice

| configuration | bytes | cine-cheap frame ÷ HTJ2K frame, median | n |
| --- | --: | --: | --: |
| lay-k1 | 81063 | 0.212 | 94 |
| lay-k4 | 32542 | 0.0767 | 93 |
| lay-k8 | 23613 | 0.0736 | 94 |
| lay-k16 | 19505 | 0.0732 | 94 |
| sep-g1 | 45945 | 2.33 | 94 |
| sep-g4 | 16689 | 0.48 | 94 |
| sep-g8 | 11614 | 0.444 | 94 |
| sep-g16 | 9591 | 0.447 | 94 |
| sep-g32 | 8740 | 0.482 | 94 |

lay-k1: dominated; lay-k4: dominated; lay-k8: dominated; lay-k16: on the frontier; sep-g1: dominated; sep-g4: dominated; sep-g8: dominated; sep-g16: on the frontier; sep-g32: on the frontier

**dbts_c1: the layered stream stays a candidate** — on the frontier: lay-k16 (high view, cine playback); lay-k16 (high view, scroll to the next slice); lay-k1 (exact on request, after a jump); lay-k1 (exact on request, dweller, frame i); lay-k1 (exact on request, dweller, then i + 1); not read: none
