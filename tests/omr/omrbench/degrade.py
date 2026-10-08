"""Degradations of a clean 300 DPI page (docs/GOALS/G12_OMR.md section 10; the measured ones of section 1).

  clean    the engraver's page at A4 300 DPI (2480 x 3508), lossless PNG
  photo    a SYNTHETIC phone photo of flat paper: perspective (each corner moved by up to 2.5 % of the page), a 1.5 degree turn,
           uneven light (1.0 -> 0.75 across, 0.95 -> 1.0 down), blur sigma 1.1, noise sigma 6, 3000 px tall, JPEG q70.
           No page curl, no shadow, no glare: a real photo is worse (section 18, K2)
  scan150  the same page as a 150 DPI grey scan, JPEG q60

Every random number comes from ``numpy.random.default_rng(seed)`` with a seed that is a function of (engraver, page), so a page is the
same picture in every run, in any order. The parameters and the seed rule are plain data (``describe()``, unit-tested in the gate);
the pixels need NumPy and OpenCV (imported only when a page is degraded: local tool).
"""

from __future__ import annotations

from typing import Dict, Tuple

PHOTO = {
    "perspective": 0.025,
    "rotation_deg": 1.5,
    "light_x": (1.0, 0.75),
    "light_y": (0.95, 1.0),
    "blur_sigma": 1.1,
    "noise_sigma": 6.0,
    "border_grey": 235,
    "height_px": 3000,
    "jpeg_quality": 70,
}
SCAN150 = {"factor": 2, "jpeg_quality": 60}
VARIANTS = ("clean", "photo", "scan")
EXT = {"clean": ".png", "photo": ".jpg", "scan": ".jpg"}
SEED_BASE = {"A": 1000, "B": 1500}          # the engraver is part of the seed: A = Verovio, B = PPP print


def seed_for(engraver: str, page: int) -> int:
    """The seed of the photo of page ``page`` (1-based). For engraver A it is the design document's: 1001, 1003, 1005 ..."""
    if engraver not in SEED_BASE:
        raise ValueError("engraver: A | B")
    if page < 1:
        raise ValueError("page is 1-based")
    return SEED_BASE[engraver] + 2 * page - 1


def describe() -> Dict[str, object]:
    return {"photo": {k: list(v) if isinstance(v, tuple) else v for k, v in PHOTO.items()},
            "scan": dict(SCAN150), "seeds": dict(SEED_BASE), "seed_rule": "base + 2*page - 1"}


def versions() -> Dict[str, str]:
    out = {}
    try:
        import numpy
        out["numpy"] = numpy.__version__
    except ImportError:
        out["numpy"] = "missing"
    try:
        import cv2
        out["opencv"] = cv2.__version__
    except ImportError:
        out["opencv"] = "missing"
    return out


def available() -> bool:
    v = versions()
    return "missing" not in v.values()


# ----------------------------------------------------------------------------- pixels
def photo_array(img, seed: int):
    """A BGR uint8 page -> its synthetic photo (BGR uint8)."""
    import cv2
    import numpy as np
    p = PHOTO
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    d = p["perspective"]
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    jit = rng.uniform(-d, d, (4, 2)) * [w, h]
    dst = (src + jit).astype(np.float32)
    border = (p["border_grey"],) * 3
    out = cv2.warpPerspective(img, cv2.getPerspectiveTransform(src, dst), (w, h), borderValue=border)
    out = cv2.warpAffine(out, cv2.getRotationMatrix2D((w / 2, h / 2), p["rotation_deg"], 1.0), (w, h), borderValue=border)
    gx = np.linspace(p["light_x"][0], p["light_x"][1], w)[None, :]
    gy = np.linspace(p["light_y"][0], p["light_y"][1], h)[:, None]
    out = out.astype(np.float32) * (gx * gy)[..., None]
    out = cv2.GaussianBlur(out, (0, 0), p["blur_sigma"])
    out = out + rng.normal(0, p["noise_sigma"], out.shape)
    out = np.clip(out, 0, 255).astype(np.uint8)
    scale = p["height_px"] / h
    return cv2.resize(out, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def scan_array(img):
    """A BGR uint8 page -> its 150 DPI grey scan (uint8, one channel)."""
    import cv2
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    f = SCAN150["factor"]
    return cv2.resize(g, (g.shape[1] // f, g.shape[0] // f), interpolation=cv2.INTER_AREA)


def jpeg_bytes(img, quality: int) -> bytes:
    import cv2
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("JPEG encoding failed")
    return buf.tobytes()


def degrade_file(clean_png: str, variant: str, engraver: str, page: int) -> Tuple[bytes, str]:
    """(bytes, extension) of the photo or the scan of a clean page file."""
    import cv2
    if variant not in ("photo", "scan"):
        raise ValueError("variant: photo | scan")
    img = cv2.imread(clean_png)
    if img is None:
        raise RuntimeError(f"cannot read {clean_png}")
    if variant == "photo":
        return jpeg_bytes(photo_array(img, seed_for(engraver, page)), PHOTO["jpeg_quality"]), ".jpg"
    return jpeg_bytes(scan_array(img), SCAN150["jpeg_quality"]), ".jpg"
