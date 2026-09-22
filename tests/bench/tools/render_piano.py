#!/usr/bin/env python3
"""Render a performance (notes in seconds) to a 44.1 kHz 16-bit mono WAV with the Salamander samples.

    <transcribe venv python> tests/bench/tools/render_piano.py perf.json out.wav

``perf.json`` is ``{"notes": [{"on", "off", "midi", "vel"}]}``. Each note uses
the nearest of the 30 samples in audio/piano (one every minor third, so at
most one semitone away), resampled to pitch, cut at its release with a 150 ms
fade. Needs numpy (the transcribe venv has it) and ffmpeg to decode the MP3s.
Salamander Grand Piano V3, CC BY 3.0 (audio/piano/README.md); rendered WAVs
are not committed.
"""

import json
import os
import subprocess
import sys
import wave

import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
SAMPLES = os.path.join(ROOT, "audio", "piano")
NAMES = {"C": 0, "Ds": 3, "Fs": 6, "A": 9}
RELEASE = 0.15
RENDERER = "render_piano.py/1 (Salamander Grand Piano V3, CC BY 3.0)"


def sample_table():
    table = {}
    for f in os.listdir(SAMPLES):
        if not f.endswith(".mp3"):
            continue
        stem = f[:-4]
        name, octave = stem[:-1], int(stem[-1])
        if name in NAMES:
            table[(octave + 1) * 12 + NAMES[name]] = os.path.join(SAMPLES, f)
    return table


_cache = {}


def decode(path):
    if path not in _cache:
        raw = subprocess.run(["ffmpeg", "-v", "quiet", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                             capture_output=True, check=True).stdout
        _cache[path] = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return _cache[path]


def render(notes, table):
    end = max(n["off"] for n in notes) + RELEASE + 0.5
    out = np.zeros(int(end * SR) + 1)
    keys = sorted(table)
    for n in notes:
        base = min(keys, key=lambda k: (abs(k - n["midi"]), k))
        src = decode(table[base])
        ratio = 2.0 ** ((n["midi"] - base) / 12.0)
        length = n["off"] - n["on"] + RELEASE
        count = int(length * SR)
        pos = np.arange(count) * ratio
        pos = pos[pos < len(src) - 1]
        wave_ = np.interp(pos, np.arange(len(src)), src)
        fade_from = int((n["off"] - n["on"]) * SR)
        if fade_from < len(wave_):
            tail = len(wave_) - fade_from
            wave_[fade_from:] *= np.linspace(1.0, 0.0, tail)
        gain = (max(1, min(127, n.get("vel", 64))) / 127.0) ** 1.6
        start = int(n["on"] * SR)
        out[start:start + len(wave_)] += gain * wave_[: len(out) - start]
    peak = float(np.max(np.abs(out))) or 1.0
    return (out / peak * 0.9 * 32767).astype(np.int16)


def main(argv):
    perf_path, wav_path = argv[1], argv[2]
    with open(perf_path, encoding="utf-8") as h:
        notes = json.load(h)["notes"]
    pcm = render(notes, sample_table())
    with wave.open(wav_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{wav_path}: {len(pcm) / SR:.1f} s, {len(notes)} notes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
