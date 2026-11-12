"""homr (github.com/liebharc/homr, PyPI homr==0.7.0, AGPL-3.0) on page images: a runner of the G12-6 bake-off (omrbench/engines.py).

    <homr env python> -I -X utf8 tests/omr/engines/run_homr.py --jobs jobs.json [--force] [--info]

Each page goes through homr's own ``process_image`` (the code path of its command line ``homr <image>``) with the settings its command
line uses by default: GPU when onnxruntime has CUDA (``--gpu auto``), no debug, no cache, no staff-position files; its MusicXML is the
page's answer (``page.musicxml``). The models are fetched by homr's own ``download_weights`` into its package folder (once). Nothing of
homr is changed. Setup measured for the record (Windows 11, RTX 5070 Ti): Python 3.13, ``pip install homr==0.7.0``, then
``pip uninstall onnxruntime`` and ``pip install onnxruntime-gpu==1.26.0`` (the last CUDA 12.8 build; 1.27+ are CUDA 13) with
PPP_OMR_CUDA_DLLS pointing at a folder of CUDA 12 / cuDNN 9 DLLs (here the torch/lib of a torch 2.11.0+cu128 install).
Run with ``-X utf8``: homr's ``musicxml`` dependency reads its schema in the locale's encoding and fails in cp949 otherwise.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import runner_common as rc  # noqa: E402

ENGINE_ID = "homr-0.7.0"


def main() -> None:
    a = rc.parser(__doc__).parse_args()
    dlls = rc.cuda_dll_dir()
    import onnxruntime as ort
    if dlls and hasattr(ort, "preload_dlls"):
        ort.preload_dlls(cuda=True, cudnn=True, msvc=True, directory=dlls)
    from homr import main as hm
    from homr.music_xml_generator import XmlGeneratorArguments
    from homr.segmentation.config import segnet_path_onnx, segnet_path_onnx_fp16
    from homr.transformer.configs import default_config
    from homr.onnx_providers import cuda_available
    from homr.title_detection import download_ocr_weights
    gpu = cuda_available()
    hm.download_weights(gpu, gpu, False)
    download_ocr_weights()
    models = ([segnet_path_onnx_fp16, default_config.filepaths.encoder_path_fp16, default_config.filepaths.decoder_path_fp16] if gpu
              else [segnet_path_onnx, default_config.filepaths.encoder_path, default_config.filepaths.decoder_path])
    if a.info:
        rc.print_info({"engine": ENGINE_ID, "version": "0.7.0", "gpu": gpu, "providers": ort.get_available_providers(),
                       "packages": rc.package_versions(["homr", "onnxruntime-gpu", "onnxruntime", "numpy", "opencv-python-headless",
                                                        "rapidocr", "musicxml"]),
                       "weights": rc.files_sha(models), "cuda_dlls": bool(dlls)})
        return
    cfg = hm.ProcessingConfig(False, False, False, False, -1, gpu, gpu, False)
    xargs = XmlGeneratorArguments(False, None, None)

    def page(image: str, out: str):
        hm.process_image(image, cfg, xargs)
        for f in os.listdir(out):
            if f.endswith("_teaser.png"):
                os.remove(os.path.join(out, f))
        return {"files": [os.path.splitext(image)[0] + ".musicxml"], "gpu": gpu}

    rc.run(a.jobs, ENGINE_ID, a.force, page, same=lambda old: old.get("gpu") == gpu)


if __name__ == "__main__":
    main()
