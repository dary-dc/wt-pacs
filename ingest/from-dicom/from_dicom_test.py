#!/usr/bin/env python3
"""The DICOM reader on synthetic objects: what it reads, in which order, and what it refuses by name.

usage: PYTHON=... $PYTHON ingest/from-dicom/from_dicom_test.py   (pydicom and numpy, lab/av1/requirements.txt)
"""
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.encaps import encapsulate
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRBigEndian, ExplicitVRLittleEndian, JPEGBaseline8Bit, JPEG2000Lossless, RLELossless, generate_uid

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dicom_series as dcm  # noqa: E402

failed = 0


def check(ok, what):
    global failed
    failed += not ok
    print(("ok   " if ok else "FAIL ") + what)


def obj(px, bits=16, stored=12, signed=False, photometric="MONOCHROME2", ts=ExplicitVRLittleEndian, series="1.2.3",
        planar=0, **kw):
    """px: n×h×w×c sample values; an object of them as the tags say, PixelData written by hand."""
    n, h, w, c = px.shape
    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ts
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.7"
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.SOPClassUID, ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPClassUID, ds.file_meta.MediaStorageSOPInstanceUID
    ds.PatientName, ds.PatientID, ds.AccessionNumber, ds.StudyInstanceUID = "Doe^Jane", "P-77", "ACC-9", generate_uid()
    ds.SeriesInstanceUID, ds.Modality = series, kw.pop("modality", "CT")
    ds.Rows, ds.Columns, ds.SamplesPerPixel, ds.PhotometricInterpretation = h, w, c, photometric
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = bits, stored, stored - 1, int(signed)
    if c > 1:
        ds.PlanarConfiguration = planar
    if n > 1:
        ds.NumberOfFrames = n
    for k, v in kw.items():
        setattr(ds, k, v)
    word = np.asarray(px, np.int64) & ((1 << stored) - 1)  # two's complement in `stored` bits, high bits zero
    arr = (word.transpose(0, 3, 1, 2) if planar else word).astype(">u2" if ts == ExplicitVRBigEndian else "<u2" if bits == 16 else "u1")
    ds.PixelData = arr.tobytes()
    if ts == RLELossless:
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.compress(RLELossless, np.asarray(px, ("i" if signed else "u") + str(bits // 8)).squeeze(axis=(0, 3)))
    if ts == JPEGBaseline8Bit:
        ds.PixelData = encapsulate([b"\xff\xd8\xff\xd9"])
    ds["PixelData"].VR = "OW" if bits == 16 else "OB"
    return ds


def save(ds, path):
    ds.save_as(path, enforce_file_format=True)
    return path


def refused(fn, needle):
    try:
        fn()
    except dcm.Refused as e:
        return needle in str(e)
    return False


def main():
    rng = np.random.default_rng(1)
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)

        # A folder of single frames, files named against their InstanceNumber order.
        f = t / "folder"
        f.mkdir()
        frames = rng.integers(0, 4096, (3, 6, 5, 1))
        for name, inst in (("a", 3), ("b", 1), ("c", 2)):
            save(obj(frames[inst - 1][None], InstanceNumber=inst), f / f"{name}.dcm")
        s, _ = dcm.series(f)
        check(all(np.array_equal(s.frame(i)[..., 0], frames[i][..., 0]) for i in range(3)),
              "test_folder_sorted_by_instance_number: frames in InstanceNumber order, not file order")
        save(obj(frames[0][None], InstanceNumber=2), f / "d.dcm")
        check(refused(lambda: dcm.series(f), "both InstanceNumber 2"), "test_instance_number_tie_refused: a tie is refused by name")
        (f / "d.dcm").unlink()
        save(obj(rng.integers(0, 4096, (1, 7, 5, 1)), InstanceNumber=4), f / "e.dcm")
        check(refused(lambda: dcm.series(f), "Rows 7"), "test_mismatched_rows_refused: a file of another size is refused by name")
        (f / "e.dcm").unlink()
        save(obj(frames[0][None], InstanceNumber=4, series="9.9"), f / "e.dcm")
        check(refused(lambda: dcm.series(f), "SeriesInstanceUID 9.9"), "test_other_series_refused: a file of another series is refused")
        (f / "e.dcm").unlink()

        # Signed 12 bits in 16: the sign extended from bit 11.
        px = np.array([-2048, -1, 0, 2047, -700, 5]).reshape(1, 2, 3, 1)
        s, _ = dcm.series(save(obj(px, signed=True), t / "signed.dcm"))
        check(s.frame(0).dtype == np.dtype("<i2") and np.array_equal(s.frame(0), px[0]),
              f"test_signed_sign_extended: 12-bit signed samples back as written ({s.frame(0).ravel().tolist()})")
        s, _ = dcm.series(save(obj(px, signed=True, ts=ExplicitVRBigEndian), t / "big.dcm"))
        check(np.array_equal(s.frame(0), px[0]), "test_big_endian: the same samples from big-endian words")

        # RGB, planar and interleaved.
        rgb = rng.integers(0, 256, (2, 4, 3, 3))
        for planar in (0, 1):
            s, _ = dcm.series(save(obj(rgb, 8, 8, photometric="RGB", planar=planar), t / f"rgb{planar}.dcm"))
            check(np.array_equal(np.stack([s.frame(i) for i in range(2)]), rgb),
                  f"test_planar_configuration: PlanarConfiguration {planar} read back interleaved")

        # Transfer syntaxes.
        check(refused(lambda: dcm.series(save(obj(rgb[:, :, :, :1], 8, 8, ts=JPEGBaseline8Bit), t / "lossy.dcm")), "lossy"),
              "test_lossy_refused: JPEG Baseline is refused by name")
        j2k = obj(frames[:1], ts=ExplicitVRLittleEndian)
        j2k.file_meta.TransferSyntaxUID = JPEG2000Lossless
        j2k.PixelData = encapsulate([b"\xff\x4f\xff\xd9"])
        check(refused(lambda: dcm.series(save(j2k, t / "j2k.dcm")), "lossless, but its decoder plugin is not pinned"),
              "test_unpinned_lossless_refused: JPEG 2000 lossless is refused, named as lossless")
        s, _ = dcm.series(save(obj(px, signed=True, ts=RLELossless), t / "rle.dcm"))
        check(np.array_equal(s.frame(0), px[0]), "test_rle: RLE lossless through pydicom's decoder, the same samples")

        # Display attributes: an enhanced object, the shared group's window overridden per frame.
        e = obj(frames, modality="MG", FrameTime=40.0)
        shared = Dataset()
        voi = Dataset()
        voi.WindowCenter, voi.WindowWidth, voi.VOILUTFunction = [2000, 1000], [4000, 800], "SIGMOID"
        pvt = Dataset()
        pvt.RescaleSlope, pvt.RescaleIntercept = 1, 0
        shared.FrameVOILUTSequence, shared.PixelValueTransformationSequence = Sequence([voi]), Sequence([pvt])
        e.SharedFunctionalGroupsSequence = Sequence([shared])
        per = []
        for i in range(3):
            g = Dataset()
            if i == 1:
                own = Dataset()
                own.WindowCenter, own.WindowWidth = 1500, 300
                g.FrameVOILUTSequence = Sequence([own])
            per.append(g)
        e.PerFrameFunctionalGroupsSequence = Sequence(per)
        _, ds = dcm.series(save(e, t / "enhanced.dcm"))
        m = dcm.display(ds)
        w = m.get("perFrame", {}).get("window")
        check(w is not None and w[1] == {"center": [1500.0], "width": [300.0], "function": "LINEAR"} and w[0]["center"] == [2000.0, 1000.0],
              f"test_enhanced_per_frame_window: frame 1 takes its own window over the shared group's ({w and w[1]})")
        check(m.get("rescale") == {"slope": 1.0, "intercept": 0.0} and m.get("frameTimeMs") == 40.0 and m["modality"] == "MG",
              "test_enhanced_shared: the shared rescale, and the frame time, once for the series")

        # Classic per-file attributes, and nothing that names the patient or the study.
        for i, inst in enumerate((1, 2)):
            save(obj(frames[i][None], InstanceNumber=inst, RescaleSlope=1, RescaleIntercept=-1024, WindowCenter=[40, 400],
                     WindowWidth=[400, 2000]), f / f"w{inst}.dcm")
        for p in ("a", "b", "c"):
            (f / f"{p}.dcm").unlink()
        _, ds = dcm.series(f)
        m = dcm.display(ds)
        check(m["rescale"] == {"slope": 1.0, "intercept": -1024.0} and m["window"]["center"] == [40.0, 400.0] and "perFrame" not in m,
              "test_classic_window: every value, the first the default, once when no frame differs")
        text = json.dumps(m)
        check(not any(x in text for x in ("Doe", "P-77", "ACC-9", ds[0].StudyInstanceUID, "1.2.3")),
              "test_no_identifiers: no patient, study or series identifier in the metadata")
    print(f"{'FAILED' if failed else 'ok'}: from-dicom reader, {failed} failing")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
