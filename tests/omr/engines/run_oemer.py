"""oemer (github.com/BreezeWhite/oemer, PyPI oemer==0.1.8, MIT) on page images: a runner of the G12-6 bake-off (omrbench/engines.py).

    <oemer env python> -I -X utf8 tests/omr/engines/run_oemer.py --jobs jobs.json [--force] [--info]

Each page goes through oemer's own ``ete.extract`` (the code path of its command line ``oemer <image>``) with its defaults (onnxruntime,
deskewing on), after ``ete.clear_data()`` as its command line does (oemer keeps a page's layers in a module-level registry). Its two ONNX
checkpoints (the URLs of ``oemer.ete.CHECKPOINTS_URL``; the TensorFlow ``.h5`` weights are not needed for onnxruntime) are fetched once into
its package folder. Nothing of oemer is changed. Setup measured for the record: Python 3.13, ``pip install oemer==0.1.8
onnxruntime-gpu==1.26.0`` and then ``pip install opencv-python-headless==4.14.0.94``: oemer 0.1.8 asks for OpenCV ``>=4.5.3.56``, which now
installs OpenCV 5, whose ``HoughLinesP`` answers in another shape and oemer then fails on every page (``IndexError`` in ``bbox.find_lines``);
OpenCV 4 is what it was written for. PPP_OMR_CUDA_DLLS as for homr.
"""

import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import runner_common as rc  # noqa: E402

ENGINE_ID = "oemer-0.1.8"
CKPT = {"unet_big": "1st_model.onnx", "seg_net": "2nd_model.onnx"}


def main() -> None:
    a = rc.parser(__doc__).parse_args()
    dlls = rc.cuda_dll_dir()
    import onnxruntime as ort
    if dlls and hasattr(ort, "preload_dlls"):
        ort.preload_dlls(cuda=True, cudnn=True, msvc=True, directory=dlls)
    ort.set_default_logger_severity(3)
    from oemer import MODULE_PATH, ete
    paths = []
    for d, name in CKPT.items():
        p = os.path.join(MODULE_PATH, "checkpoints", d, "model.onnx")
        if not os.path.exists(p):
            urllib.request.urlretrieve(ete.CHECKPOINTS_URL[name], p + ".part")
            os.replace(p + ".part", p)
        paths.append(p)
    if a.info:
        rc.print_info({"engine": ENGINE_ID, "version": "0.1.8", "providers": ort.get_available_providers(),
                       "gpu": "CUDAExecutionProvider" in ort.get_available_providers(),
                       "packages": rc.package_versions(["oemer", "onnxruntime-gpu", "onnxruntime", "numpy", "opencv-python-headless",
                                                        "scikit-learn", "scipy"]),
                       "weights": {f"{d}/model.onnx": rc.files_sha([p])["model.onnx"] for d, p in zip(CKPT, paths)},
                       "cuda_dlls": bool(dlls)})
        return

    def page(image: str, out: str):
        xml = os.path.join(out, "page.musicxml")
        ete.clear_data()
        ete.extract(ete.get_parser().parse_args([image, "-o", xml]))
        return {"files": [xml]}

    rc.run(a.jobs, ENGINE_ID, a.force, page)


if __name__ == "__main__":
    main()
