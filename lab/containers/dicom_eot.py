import glob, struct, sys
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.encaps import encapsulate_extended
from pydicom.uid import JPEG2000Lossless, generate_uid, ExplicitVRLittleEndian
frames = [open(p, "rb").read() for p in sorted(glob.glob(sys.argv[1] + "/*.j2k"))]
meta = FileMetaDataset()
meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.7.3"  # Multi-frame Grayscale Word Secondary Capture
meta.MediaStorageSOPInstanceUID = generate_uid(); meta.TransferSyntaxUID = JPEG2000Lossless
ds = Dataset(); ds.file_meta = meta
ds.SOPClassUID, ds.SOPInstanceUID = meta.MediaStorageSOPClassUID, meta.MediaStorageSOPInstanceUID
ds.Rows = ds.Columns = 256; ds.NumberOfFrames = len(frames); ds.SamplesPerPixel = 1
ds.PhotometricInterpretation = "MONOCHROME2"; ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 12, 11, 0
ds.PixelData, ds.ExtendedOffsetTable, ds.ExtendedOffsetTableLengths = encapsulate_extended(frames)
ds["PixelData"].VR = "OB"; ds["PixelData"].is_undefined_length = True
ds.save_as(sys.argv[2], enforce_file_format=True)
# Read it back the way a server would: EOT gives offset (from the first item after the BOT) and length.
from pydicom import dcmread
r = dcmread(sys.argv[2], stop_before_pixels=False)
offs = struct.unpack(f"<{len(frames)}Q", r.ExtendedOffsetTable); lens = struct.unpack(f"<{len(frames)}Q", r.ExtendedOffsetTableLengths)
raw = open(sys.argv[2], "rb").read()
first_item = raw.find(b"\xfe\xff\x00\xe0\x00\x00\x00\x00") + 8  # empty Basic Offset Table item, then frame items
ok = all(raw[first_item + o + 8:first_item + o + 8 + n] == f + b"\0" * (n - len(f)) and n - len(f) in (0, 1) for o, n, f in zip(offs, lens, frames))
payload = sum(map(len, frames))
print(f"frames={len(frames)} file={len(raw)} payload={payload} pixel-data-starts@{first_item - 8} "
      f"overhead/frame={(len(raw) - payload) / len(frames):.1f} B  eot-exact={ok}")
