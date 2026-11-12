"""SMT++ (the full-page Sheet Music Transformer: github.com/antoniorv6/SMT, MIT; weights PRAIG/smt-fp-grandstaff, MIT) on page images:
a runner of the G12-6 bake-off (omrbench/engines.py).

    <smt env python> -I -X utf8 tests/omr/engines/run_smt.py --jobs jobs.json [--force] [--info]
    PPP_OMR_SMT_SRC = a clone of github.com/antoniorv6/SMT (its smt_model package is imported from there; the commit is recorded)

A page is read as the repository's README reads one (``cv2.imread`` -> grayscale -> [0, 1] -> ``model.predict``), with ONE addition the
model needs: the page is scaled, keeping its aspect, to fit the input size its configuration declares (``maxw`` x ``maxh`` = 2100 x 2970,
A4 at about 254 dpi: the full-page GrandStaff pages it was trained on); a larger image does not fit its positional encoding. The answer
(bekern tokens) is joined into Humdrum **kern as the repository's trainer does (``<b>`` newline, ``<t>`` tab, ``<s>`` space) and written as
``page.krn``; ``tests/omr/omrbench/kern.py`` turns it into ``page.musicxml`` (music21's Humdrum reader refuses most of the model's files:
see that module). Decoding is greedy, as ``predict`` does, up to ``maxlen`` (4353) tokens. The weights are the model card's revision
pinned below. Setup measured for the record: Python 3.13, torch 2.11.0+cu128, transformers 4.49.0 (the version the weights were saved
with), loguru, opencv-python-headless, pillow.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(1, os.path.dirname(HERE))                  # tests/omr: omrbench.kern (standard library only)
import runner_common as rc  # noqa: E402

ENGINE_ID = "smt-fp-grandstaff"
MODEL = "PRAIG/smt-fp-grandstaff"
REVISION = "6f8d5c093d218a71117ef51492efc2952adcc217"         # the model card's commit, 2025-06-19


def kern_text(tokens):
    return "".join(tokens).replace("<b>", "\n").replace("<s>", " ").replace("<t>", "\t")


def git_head(src: str):
    try:
        head = open(os.path.join(src, ".git", "HEAD"), encoding="utf-8").read().strip()
        if head.startswith("ref: "):
            ref = os.path.join(src, ".git", *head[5:].split("/"))
            if os.path.isfile(ref):
                return open(ref, encoding="utf-8").read().strip()
            packed = os.path.join(src, ".git", "packed-refs")
            for ln in open(packed, encoding="utf-8"):
                if ln.strip().endswith(head[5:]):
                    return ln.split()[0]
        return head
    except OSError:
        return None


def main() -> None:
    a = rc.parser(__doc__).parse_args()
    src = os.environ.get("PPP_OMR_SMT_SRC")
    if not src or not os.path.isdir(os.path.join(src, "smt_model")):
        raise SystemExit("PPP_OMR_SMT_SRC must name a clone of github.com/antoniorv6/SMT")
    sys.path.insert(0, src)
    import cv2
    import numpy as np
    import torch
    from PIL import Image
    from huggingface_hub import hf_hub_download
    from smt_model import SMTModelForCausalLM
    from omrbench import kern
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = SMTModelForCausalLM.from_pretrained(MODEL, revision=REVISION).to(dev)
    model.eval()
    maxw, maxh = int(model.config.maxw), int(model.config.maxh)
    if a.info:
        weights = hf_hub_download(MODEL, "model.safetensors", revision=REVISION)
        rc.print_info({"engine": ENGINE_ID, "version": f"{MODEL}@{REVISION[:7]}", "device": dev,
                       "gpu_name": torch.cuda.get_device_name(0) if dev == "cuda" else None, "smt_commit": git_head(src),
                       "max_input": [maxw, maxh], "maxlen": int(model.config.maxlen),
                       "packages": rc.package_versions(["torch", "transformers", "numpy", "opencv-python-headless", "pillow"]),
                       "weights": rc.files_sha([weights])})
        return

    def page(image: str, out: str):
        if dev == "cuda":
            torch.cuda.reset_peak_memory_stats()
        img = cv2.imread(image)
        h, w = img.shape[:2]
        s = min(maxw / w, maxh / h)
        img = cv2.resize(img, (max(1, int(round(w * s))), max(1, int(round(h * s)))),
                         interpolation=cv2.INTER_AREA if s < 1 else cv2.INTER_LINEAR)
        grey = np.asarray(Image.fromarray(img).convert("L"), dtype=np.float32) / 255.0
        x = torch.from_numpy(grey).unsqueeze(0).unsqueeze(0).to(dev)
        with torch.no_grad():
            pred, _ = model.predict(x, convert_to_str=True)
        text = kern_text(pred)
        with open(os.path.join(out, "page.krn"), "w", encoding="utf-8", newline="\n") as hh:
            hh.write(text)
        xml, counts = kern.convert(text)
        path = os.path.join(out, "page.musicxml")
        with open(path, "w", encoding="utf-8", newline="\n") as hh:
            hh.write(xml)
        res = {"files": [path], "tokens": len(pred), "scale": round(s, 4), "kern_mended": counts,
               "hit_maxlen": len(pred) >= int(model.config.maxlen) - 2}
        if dev == "cuda":
            res["gpu_peak_mb"] = round(torch.cuda.max_memory_allocated() / 2 ** 20, 1)
            torch.cuda.empty_cache()
        return res

    rc.run(a.jobs, ENGINE_ID, a.force, page)


if __name__ == "__main__":
    main()
