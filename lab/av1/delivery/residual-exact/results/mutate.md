| fixture | form | Q | G | frames | samples | VL bytes | keyframes | grain | dav1d `--threads=4` | aomdec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 12bit | 8 | 16 | 56 | 114,154,320 | 5,027,649 | 4 | 0 | 0 / 114,154,320 | 1 / 114,154,320, max \|Δ\| 1 |
| `dbts_a1` | top10 | 8 | 16 | 56 | 114,154,320 | 4,640,590 | 4 | 0 | 0 / 114,154,320 | 1 / 114,154,320, max \|Δ\| 1 |

| fixture | form | Q | G | dav1d-WASM | WebCodecs `prefer-software` | WebCodecs `no-preference` | decoder (media log) | `copyTo` format |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 12bit | 8 | 16 | 1 / 114,154,320, max \|Δ\| 1 **sha** | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_a1` | top10 | 8 | 16 | 1 / 114,154,320, max \|Δ\| 1 **sha** | 1 / 114,154,320, max \|Δ\| 1 **sha** | 1 / 114,154,320, max \|Δ\| 1 **sha** | Dav1dVideoDecoder, platform false | I420P10 |

all compared decodes: 6 of 913,234,560 samples differ, 448 frames; browser frames whose SHA-256 equals native dav1d's: 220 of 224; refused arms: 2; browser 153.0.8010.12
