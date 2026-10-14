"""Whether a set's source agrees with the provenance class data.json gives it: docs/FIXTURES.md §Provenance.

A source is "lossy" when its header says it was lossy-coded, or its transfer syntax may be, or it
is a video clip; "unknown" when it is an image export whose history nothing records.
"""

CLASSES = ("sound", "lossless-but-unrepresentative", "lossy-sourced", "unknown")

LOSSLESS_SYNTAXES = {
    "1.2.840.10008.1.2",  # implicit VR little endian
    "1.2.840.10008.1.2.1",  # explicit VR little endian
    "1.2.840.10008.1.2.1.99",  # deflated
    "1.2.840.10008.1.2.2",  # explicit VR big endian
    "1.2.840.10008.1.2.4.57",  # JPEG lossless
    "1.2.840.10008.1.2.4.70",  # JPEG lossless, first-order prediction
    "1.2.840.10008.1.2.4.80",  # JPEG-LS lossless
    "1.2.840.10008.1.2.4.90",  # JPEG 2000 lossless only
    "1.2.840.10008.1.2.4.201",  # HTJ2K lossless only
    "1.2.840.10008.1.2.4.202",  # HTJ2K RPCL lossless only
    "1.2.840.10008.1.2.5",  # RLE
}


class Refused(Exception):
    pass


def dicom_attributes(ds) -> dict:
    def text(keyword):
        v = ds.get(keyword)
        return None if v is None else str(v)

    image_type = ds.get("ImageType")
    return {
        "transferSyntax": str(ds.file_meta.TransferSyntaxUID),
        "lossyImageCompression": text("LossyImageCompression"),
        "lossyImageCompressionRatio": text("LossyImageCompressionRatio"),
        "lossyImageCompressionMethod": text("LossyImageCompressionMethod"),
        "imageType": None if image_type is None else "\\".join(str(v) for v in image_type),
        "presentationIntentType": text("PresentationIntentType"),
    }


def archive_attributes(decode: str) -> dict:
    return {"export": {"luma": "video", "rgb": "video", "png": "image"}[decode]}


def evidence(attributes: dict) -> str:
    if "export" in attributes:
        return "lossy" if attributes["export"] == "video" else "unknown"
    if attributes["lossyImageCompression"] == "01":
        return "lossy"
    return "lossless" if attributes["transferSyntax"] in LOSSLESS_SYNTAXES else "lossy"


def check(name: str, klass: str, attributes: dict) -> None:
    """Refuses a source whose evidence the set's class does not admit."""
    if klass not in CLASSES:
        raise Refused(f"{name}: provenance {klass!r}, not one of {CLASSES}")
    seen = evidence(attributes)
    if seen == "lossy" and klass != "lossy-sourced":
        raise Refused(f"{name}: a lossy source {attributes}, but provenance {klass!r}")
    if seen == "unknown" and klass not in ("lossy-sourced", "unknown"):
        raise Refused(f"{name}: a source of unknown history {attributes}, but provenance {klass!r}")
