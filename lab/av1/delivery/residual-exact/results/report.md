| fixture | form | Q | G | frames | samples | VL bytes | keyframes | grain | dav1d 1.5.4 `--threads=4` | system libdav1d | aomdec |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 12bit | 4 | 1 | 56 | 114,154,320 | 18,205,137 | 56 | 0 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 |
| `dbts_a1` | 12bit | 4 | 16 | 56 | 114,154,320 | 18,308,364 | 4 | 0 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 |
| `dbts_a1` | 12bit | 8 | 1 | 56 | 114,154,320 | 5,019,224 | 56 | 0 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 |
| `dbts_a1` | 12bit | 8 | 16 | 56 | 114,154,320 | 5,027,649 | 4 | 0 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 |
| `dbts_a1` | top10 | 4 | 1 | 56 | 114,154,320 | 15,588,376 | 56 | 0 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 |
| `dbts_a1` | top10 | 4 | 16 | 56 | 114,154,320 | 15,685,772 | 4 | 0 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 |
| `dbts_a1` | top10 | 8 | 1 | 56 | 114,154,320 | 4,655,594 | 56 | 0 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 |
| `dbts_a1` | top10 | 8 | 16 | 56 | 114,154,320 | 4,640,590 | 4 | 0 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 |
| `dbts_b1` | 10bit | 4 | 1 | 50 | 425,984,000 | 47,554,367 | 50 | 0 | 0 / 425,984,000 | 0 / 425,984,000 | 0 / 425,984,000 |
| `dbts_b1` | 10bit | 4 | 16 | 50 | 425,984,000 | 46,853,126 | 4 | 0 | 0 / 425,984,000 | 0 / 425,984,000 | 0 / 425,984,000 |
| `dbts_b1` | 10bit | 8 | 1 | 50 | 425,984,000 | 23,477,229 | 50 | 0 | 0 / 425,984,000 | 0 / 425,984,000 | 0 / 425,984,000 |
| `dbts_b1` | 10bit | 8 | 16 | 50 | 425,984,000 | 23,191,007 | 4 | 0 | 0 / 425,984,000 | 0 / 425,984,000 | 0 / 425,984,000 |
| `dbts_c1` | 12bit | 4 | 1 | 69 | 169,235,472 | 20,120,330 | 69 | 0 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 |
| `dbts_c1` | 12bit | 4 | 16 | 69 | 169,235,472 | 20,094,599 | 5 | 0 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 |
| `dbts_c1` | 12bit | 8 | 1 | 69 | 169,235,472 | 6,772,806 | 69 | 0 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 |
| `dbts_c1` | 12bit | 8 | 16 | 69 | 169,235,472 | 6,688,677 | 5 | 0 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 |
| `dbts_c1` | top10 | 4 | 1 | 69 | 169,235,472 | 17,498,082 | 69 | 0 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 |
| `dbts_c1` | top10 | 4 | 16 | 69 | 169,235,472 | 17,483,081 | 5 | 0 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 |
| `dbts_c1` | top10 | 8 | 1 | 69 | 169,235,472 | 6,346,125 | 69 | 0 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 |
| `dbts_c1` | top10 | 8 | 16 | 69 | 169,235,472 | 6,229,812 | 5 | 0 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 |

| fixture | form | Q | G | dav1d-WASM | WebCodecs `prefer-software` | WebCodecs `no-preference` | WebCodecs `prefer-hardware` | decoder (media log) | `copyTo` format |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 12bit | 4 | 1 | 0 / 114,154,320 | refused: DataError (key chunk) | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_a1` | 12bit | 4 | 16 | 0 / 114,154,320 | refused: DataError (key chunk) | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_a1` | 12bit | 8 | 1 | 0 / 114,154,320 | refused: DataError (key chunk) | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_a1` | 12bit | 8 | 16 | 0 / 114,154,320 | refused: DataError (key chunk) | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_a1` | top10 | 4 | 1 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_a1` | top10 | 4 | 16 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_a1` | top10 | 8 | 1 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_a1` | top10 | 8 | 16 | 0 / 114,154,320 | 0 / 114,154,320 | 0 / 114,154,320 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_b1` | 10bit | 4 | 1 | 0 / 425,984,000 | 0 / 425,984,000 | 0 / 425,984,000 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_b1` | 10bit | 4 | 16 | 0 / 425,984,000 | 0 / 425,984,000 | 0 / 425,984,000 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_b1` | 10bit | 8 | 1 | 0 / 425,984,000 | 0 / 425,984,000 | 0 / 425,984,000 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_b1` | 10bit | 8 | 16 | 0 / 425,984,000 | 0 / 425,984,000 | 0 / 425,984,000 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_c1` | 12bit | 4 | 1 | 0 / 169,235,472 | refused: DataError (key chunk) | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_c1` | 12bit | 4 | 16 | 0 / 169,235,472 | refused: DataError (key chunk) | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_c1` | 12bit | 8 | 1 | 0 / 169,235,472 | refused: DataError (key chunk) | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_c1` | 12bit | 8 | 16 | 0 / 169,235,472 | refused: DataError (key chunk) | refused: DataError (key chunk) | refused: DataError (key chunk) | none (refused before decode) | — |
| `dbts_c1` | top10 | 4 | 1 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_c1` | top10 | 4 | 16 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_c1` | top10 | 8 | 1 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |
| `dbts_c1` | top10 | 8 | 16 | 0 / 169,235,472 | 0 / 169,235,472 | 0 / 169,235,472 | refused: OperationError | Dav1dVideoDecoder, platform false | I420P10 |

cells whose browser reference has this run's reference digests, every frame: 20 of 20

native dav1d: ['{"pinned": "1.5.4-0-g54706fc", "system": "1.4.1"}']

all compared decodes: 0 of 21,559,207,680 samples differ, 6,200 frames; browser frames whose SHA-256 equals native dav1d's: 2600 of 2600; refused arms: 36; browser 153.0.8010.12
