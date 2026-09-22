# Private golden transcription set

Keep copyrighted PDFs, MusicXML exports, recordings and model predictions
outside the repository. The benchmark only needs a manifest that points to
those files, so it can be run locally without publishing the source material.

Example `manifest.json`:

```json
{
  "cases": [
    {
      "name": "looping-the-rooms-reference",
      "reference": "looping-the-rooms.musicxml",
      "prediction": "looping-the-rooms.predicted.musicxml",
      "expectedMeasures": 89,
      "expectedTempo": 162,
      "tempoTolerance": 2,
      "minF1": 0.85
    }
  ]
}
```

Run it from the repository root:

```sh
python tests/golden_benchmark.py C:/private/ppp-golden/manifest.json
```

MusicXML/MXL cases are compared in quarter-beat units. MIDI/JSON cases are
compared in seconds using the existing note and pedal metrics. If a case mixes
quarter-beat reference notation with a seconds-based helper result, declare an
`alignment` strategy as shown below. The report includes pitch/onset F1, offset F1,
mean onset error, measure count and reference tempo; thresholds are optional
and belong in the private manifest.

For a real recording-vs-score case, a helper JSON result can be compared
directly with the official MusicXML. Set `alignment` to `tempo` (constant
tempo) or `prediction-beats` (use the helper's returned `beats` array, which
preserves rubato):

```json
{
  "name": "looping-the-rooms-recording",
  "reference": "looping-the-rooms.musicxml",
  "prediction": "looping-the-rooms.helper.json",
  "alignment": "prediction-beats",
  "beatOffset": 0,
  "minF1": 0.85,
  "maxOnsetErrorMs": 55
}
```

The PDF remains the visual source of truth; export it to MusicXML (or use the
PPP review's official-score import) before adding it to the manifest. Keep the
PDF, audio and helper output outside the repository.

The G0 benchmark runs the same manifest with `python tests/bench/run.py legacy --manifest
C:/private/ppp-golden/manifest.json`. The note metrics are those of `golden_benchmark.py`
unchanged; its output names MusicXML-vs-MusicXML tolerances in quarter beats rather than "ms",
and results stay next to the manifest, outside the repository. For recordings and official
scores with the full notation metrics and a baseline, use a private suite
(`run.py run --suite-file ...`, `tests/bench/README.md`).
