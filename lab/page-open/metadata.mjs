/** A study's per-frame metadata, synthetic: its size and its mix of numbers and UIDs, not a real series'. */
export function metadata(frames = 300) {
  let seed = 1;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const uid = () => "1.2.826.0.1.3680043.8.498." + Array.from({ length: 5 }, () => String((rand() * 1e9) | 0)).join(".");
  const series = uid();
  return JSON.stringify({
    seriesInstanceUid: series, modality: "US", rows: 512, columns: 512, bitsAllocated: 8, samplesPerPixel: 3,
    photometricInterpretation: "RGB", frameCount: frames,
    frames: Array.from({ length: frames }, (_, i) => ({
      index: i, sopInstanceUid: uid(), instanceNumber: i + 1,
      imagePositionPatient: [-120.5, -98.25 + rand(), 40 + i * 0.625].map((v) => +v.toFixed(4)),
      imageOrientationPatient: [1, 0, 0, 0, 1, 0], pixelSpacing: [0.4688, 0.4688], sliceThickness: 0.625,
      windowCenter: 40 + ((rand() * 20) | 0), windowWidth: 400, rescaleIntercept: -1024, rescaleSlope: 1,
      acquisitionTime: `1030${String(i % 60).padStart(2, "0")}.${String((rand() * 1e6) | 0).padStart(6, "0")}`,
      frameBytes: 60000 + ((rand() * 40000) | 0),
    })),
  });
}
