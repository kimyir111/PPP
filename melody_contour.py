#!/usr/bin/env python3
"""The predominant melody of a mix, as a pitch contour and as notes - the idea of Melodia (Salamon & Gomez 2012: spectral
peaks, a harmonic-summation salience, the melody as the most salient continuous line), written with numpy and scipy only so
that it runs wherever transcribe.py runs (Essentia's Melodia has no Windows build).

    contour(y, sr) -> (times, midi)   midi a float per frame, nan where no melody is heard
    notes(times, midi) -> [{'on', 'off', 'midi'}]

transcribe.py uses it in song mode to fill the stretches where the multi-instrument model heard no tune: a quiet lead under a
loud band can be missed by a note transcriber (YourMT3 and Basic Pitch both lost one in the test song) and still be the most
salient line of the spectrum.
"""

import numpy as np

HOP = 256                 # samples at SR: 11.6 ms
SR = 22050
N_FFT = 2048
BIN_CENTS = 20            # salience resolution
LO_MIDI, HI_MIDI = 55, 96 # the melody's range: G3 to C7
HARMONICS = 10
ALPHA = 0.8               # weight of each next harmonic
PEAK_DB = 40              # spectral peaks within this of the frame's loudest
PEAK_FMAX = 5000          # ... and below this (Hz): above it are cymbals and noise, not a melody's partials
COMP = 1.0                # magnitude compression of the peaks
HP = 150                  # high-pass (Hz) before the analysis (a rough equal-loudness weighting); 0: none
JUMP_CENTS = 300          # transition cost: a jump this big costs as much as one frame of unvoiced
VOICE_REL = 0.4           # a frame is voiced when its best salience reaches this share of the loud frames' (95th percentile)


def _peaks(mag, freqs):
    """Per frame: the local maxima of the magnitude spectrum (parabolic interpolation of frequency and level in dB)."""
    db = 20 * np.log10(mag + 1e-10)
    out = []
    for t in range(mag.shape[1]):
        d = db[:, t]
        k = np.where((d[1:-1] > d[:-2]) & (d[1:-1] >= d[2:]))[0] + 1
        k = k[d[k] > d.max() - PEAK_DB]
        if not len(k):
            out.append((np.zeros(0), np.zeros(0)))
            continue
        a, b, c = d[k - 1], d[k], d[k + 1]
        den = a - 2 * b + c
        p = np.where(np.abs(den) > 1e-9, 0.5 * (a - c) / np.where(np.abs(den) > 1e-9, den, 1), 0)
        f = (k + p) * (freqs[1] - freqs[0])
        lev = 10 ** ((b - 0.25 * (a - c) * p) / 20)
        out.append((f, lev))
    return out


def salience(y, sr=SR):
    """The harmonic-summation salience: frames x bins (BIN_CENTS each, from LO_MIDI)."""
    import scipy.signal
    if sr != SR:
        import librosa
        y = librosa.resample(y, orig_sr=sr, target_sr=SR)
    # a rough equal-loudness weighting: the low end (bass, kick) is not the melody
    if HP:
        b, a = scipy.signal.butter(2, HP / (SR / 2), 'highpass')
        y = scipy.signal.lfilter(b, a, y).astype(np.float32)
    f, t, Z = scipy.signal.stft(y, fs=SR, window='hann', nperseg=N_FFT, noverlap=N_FFT - HOP, boundary=None, padded=False)
    mag = np.abs(Z)
    nb = int((HI_MIDI - LO_MIDI) * 100 / BIN_CENTS) + 1
    S = np.zeros((mag.shape[1], nb), np.float32)
    spread = np.arange(-5, 6)                      # +-100 cents around each candidate
    wspread = np.cos(spread * BIN_CENTS / 100 * np.pi / 2) ** 2
    hw = ALPHA ** np.arange(HARMONICS)
    for ti, (pf, pl) in enumerate(_peaks(mag, f)):
        if not len(pf):
            continue
        keep = (pf > 50) & (pf < PEAK_FMAX)
        pf, pl = pf[keep], pl[keep] ** COMP
        for h in range(1, HARMONICS + 1):
            f0 = pf / h
            ok = f0 > 0
            m = 69 + 12 * np.log2(np.maximum(f0, 1e-3) / 440.0)
            bins = np.round((m - LO_MIDI) * 100 / BIN_CENTS).astype(int)
            ok &= (bins >= -5) & (bins < nb + 5)
            for s, w in zip(spread, wspread):
                bb = bins[ok] + s
                inside = (bb >= 0) & (bb < nb)
                np.add.at(S[ti], bb[inside], (pl[ok][inside] * hw[h - 1] * w).astype(np.float32))
    times = t
    return times, S


def contour(y, sr=SR):
    """The melody: a Viterbi path over the salience bins and one 'no melody' state. Staying voiced costs the frame's salience
    deficit, moving costs by the size of the jump; a frame whose best salience is low is cheaper unvoiced."""
    times, S = salience(y, sr)
    return times, track(S)


def track(S):
    """The Viterbi path of contour() over a salience (frames x bins): midi per frame, nan unvoiced."""
    T, nb = S.shape
    if T == 0:
        return np.zeros(0)
    best = S.max(axis=1)
    ref = np.quantile(best[best > 0], 0.95) if (best > 0).any() else 1.0
    s = S / (ref + 1e-9)                            # not clipped: above the reference the most salient bin must still win
    thr = VOICE_REL
    emit = 1.0 - s                                  # voiced cost per bin
    unv = 1.0 - thr                                 # unvoiced cost: a voiced bin is better when its salience beats thr
    # transition: linear in the jump, within +-1 octave per frame; voiced <-> unvoiced costs a little
    jump = np.arange(-60, 61)
    tcost = np.abs(jump) * BIN_CENTS / JUMP_CENTS * unv
    switch = 0.5 * unv
    cost = emit[0].copy()
    cu = unv
    back = np.zeros((T, nb), np.int32)
    backu = np.zeros(T, np.int32)                   # previous state of the unvoiced state: -1 unvoiced, else a bin
    fromu = np.zeros((T, nb), bool)
    big = 1e9
    for t in range(1, T):
        # best voiced predecessor for every bin within +-60 bins
        padded = np.concatenate([np.full(60, big), cost, np.full(60, big)])
        cand = np.stack([padded[60 + j: 60 + j + nb] for j in jump]) + tcost[:, None]   # cand[k, b]: from b + jump[k]
        k = cand.argmin(axis=0)
        vbest = cand[k, np.arange(nb)]
        prev_b = np.arange(nb) + jump[k]
        fu = cu + switch < vbest
        newcost = np.where(fu, cu + switch, vbest) + emit[t]
        back[t] = prev_b
        fromu[t] = fu
        bv = int(cost.argmin())
        if cu <= cost[bv] + switch:
            ncu, backu[t] = cu + unv, -1
        else:
            ncu, backu[t] = cost[bv] + switch + unv, bv
        cost, cu = newcost, ncu
    path = np.full(T, -1, np.int32)
    state = -1 if cu <= cost.min() else int(cost.argmin())
    for t in range(T - 1, -1, -1):
        path[t] = state
        if t == 0:
            break
        if state == -1:
            state = int(backu[t])
        else:
            state = -1 if fromu[t, state] else int(back[t, state])
    return np.where(path >= 0, LO_MIDI + path * BIN_CENTS / 100.0, np.nan)


def notes(times, midi, min_s=0.09, gap_s=0.05):
    """The contour as notes: a run of frames near one semitone is a note; a change of semitone that lasts starts the next."""
    out = []
    if len(times) < 2:
        return out
    dt = float(times[1] - times[0])
    semi = np.where(np.isnan(midi), -1, np.round(midi)).astype(int)
    i, T = 0, len(semi)
    while i < T:
        if semi[i] < 0:
            i += 1
            continue
        j = i
        while j + 1 < T and (semi[j + 1] == semi[i] or (semi[j + 1] < 0 and j + 2 < T and semi[j + 2] == semi[i] and dt <= gap_s)):
            j += 1
        if (j - i + 1) * dt >= min_s:
            out.append({'on': round(float(times[i]), 4), 'off': round(float(times[j] + dt), 4), 'midi': int(semi[i])})
        i = j + 1
    return out


if __name__ == '__main__':
    import sys
    import json
    import soundfile as sf
    y, sr = sf.read(sys.argv[1], dtype='float32', always_2d=True)
    t, m = contour(y.mean(axis=1), sr)
    np.savez_compressed(sys.argv[2], t=t, midi=m)
    print(json.dumps({'frames': len(t), 'voiced': float(np.mean(~np.isnan(m))), 'notes': len(notes(t, m))}))
