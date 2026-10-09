#!/usr/bin/env python3
"""Run YourMT3 (multi-instrument music transcription, Chang et al. 2024) on one audio file and write a MIDI file with one
General MIDI program per instrument. transcribe.py calls this in song mode, in YourMT3's own Python environment, so that
YourMT3's packages never touch the piano models' environment.

  python yourmt3_run.py --space D:/PPP/tools/yourmt3 --wav song.wav --mid out.mid [--device cuda]
  python yourmt3_run.py --space D:/PPP/tools/yourmt3 --selftest      (loads the model and says whether it works)

--space is a clone of the Hugging Face space mimbres/YourMT3 (its code, model_helper.py, and its checkpoints under
amt/logs). This file follows how that space's own app.py loads the model and transcribes; if a newer space changes those
calls, the error below names what failed. Written without access to the space from where it was written: verify it with
--selftest on the PC first.
"""

import argparse
import os
import shutil
import sys

# the space's default model (its app.py, 'YPTF.MoE+Multi (noPS)'); override with --model-args if the space names another
DEFAULT_ARGS = [
    'mc13_256_g4_all_v7_mt3f_sqr_rms_moe_wf4_n8k2_silu_rope_rp_b36_nops@last.ckpt', '-p', '2024', '-tk', 'mc13_full_plus_256',
    '-dec', 'multi-t5', '-nl', '26', '-enc', 'perceiver-tf', '-sqr', '1', '-ff', 'moe', '-wf', '4', '-nmoe', '8', '-kmoe', '2',
    '-act', 'silu', '-epe', 'rope', '-rp', '1', '-ac', 'spec', '-hop', '300', '-atc', '1', '-pr', '16'
]


def fail(msg):
    sys.stderr.write('YOURMT3_FAILED: ' + msg + '\n')
    raise SystemExit(2)


def load(space, device, model_args):
    space = os.path.abspath(space)
    if not os.path.isfile(os.path.join(space, 'model_helper.py')):
        fail('model_helper.py is not in ' + space + ' (clone https://huggingface.co/spaces/mimbres/YourMT3 there, with git lfs)')
    os.chdir(space)   # the checkpoints are found relative to the space (amt/logs/...)
    for p in (space, os.path.join(space, 'amt', 'src')):
        if p not in sys.path:
            sys.path.insert(0, p)
    try:
        from model_helper import load_model_checkpoint, transcribe
    except Exception as e:
        fail('could not import the space code (model_helper): %s: %s' % (type(e).__name__, e))
    try:
        model = load_model_checkpoint(args=model_args, device='cpu')
    except Exception as e:
        fail('could not load the checkpoint (%s): %s: %s - are the checkpoints downloaded (git lfs pull)?' % (model_args[0], type(e).__name__, e))
    if device != 'cpu':
        try:
            model.to(device)
        except Exception as e:
            fail('could not move the model to %s: %s' % (device, e))
    return model, transcribe


def audio_info(path):
    import soundfile as sf
    info = sf.info(path)
    return {'filepath': path, 'track_name': os.path.splitext(os.path.basename(path))[0], 'sample_rate': int(info.samplerate),
            'bits_per_sample': 16, 'num_channels': int(info.channels), 'num_frames': int(info.frames),
            'duration': int(info.frames / info.samplerate), 'encoding': 'pcm_s16'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--space', required=True)
    ap.add_argument('--wav', default='')
    ap.add_argument('--mid', default='')
    ap.add_argument('--device', default='auto')
    ap.add_argument('--model-args', default='', help='the space\'s model arguments, space separated (default: its noPS model)')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    device = a.device
    if device == 'auto':
        try:
            import torch
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        except Exception:
            device = 'cpu'
    model_args = a.model_args.split() if a.model_args else DEFAULT_ARGS
    wav = os.path.abspath(a.wav) if a.wav else ''
    mid = os.path.abspath(a.mid) if a.mid else ''
    model, transcribe = load(a.space, device, model_args)
    if a.selftest:
        if device != 'cpu':
            # loading a model succeeds even on a GPU this torch has no kernels for (an RTX 50xx under a cu121 torch only warns);
            # one real operation on it is what fails
            try:
                import torch
                float((torch.ones(8, device=device) * 2).sum())
            except Exception as e:
                fail('the model loaded but the GPU cannot run it with this torch (%s: %s); install a torch built for this GPU '
                     '(an RTX 50xx needs the CUDA 12.8 build: pip install --force-reinstall --no-deps torch torchaudio '
                     '--index-url https://download.pytorch.org/whl/cu128)' % (type(e).__name__, str(e)[:200]))
        print('YourMT3: OK - the model loaded and ran on ' + device)
        return
    if not wav or not os.path.isfile(wav) or not mid:
        fail('--wav (an existing file) and --mid are needed')
    try:
        out = transcribe(model, audio_info(wav))
    except Exception as e:
        fail('transcription failed: %s: %s' % (type(e).__name__, e))
    if not out or not os.path.isfile(str(out)):
        fail('the space returned no MIDI file (got %r)' % (out,))
    shutil.copyfile(str(out), mid)
    print('YourMT3: wrote ' + mid)


if __name__ == '__main__':
    main()
