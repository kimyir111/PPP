"""PPP score-quality benchmark (G0).

Version constants are written into every result and baseline. Bump the one
whose meaning changed; compare refuses to mix versions (docs/GOALS/G00 §8.7).
"""

READER_VERSION = "reader/3"   # pedal marks, ottava modes, ties only where the tied note ends;
                              # /3: clefs, bar numbers as the app keys them, printed rest shapes
METRICS_VERSION = "metrics/4" # missing = 0, metre from the MusicXML, critical gates, pedal, accidentals;
                              # /3: replay pedal scored against the performance, not the AMT; false pedal
                              # /4 (G00 §19): tempo/metre/key over the whole score, note shapes, complete bars,
                              #     bar numbers, note values in usable, PredTime on the SUT's beat model
SQI_VERSION = "sqi/2"         # diagnostic score: re-weighted, reference-normalised
GENERATOR_VERSION = "perform/2" # + pedal and human-alt profiles

VERSIONS = {
    "reader": READER_VERSION,
    "metrics": METRICS_VERSION,
    "sqi": SQI_VERSION,
    "generator": GENERATOR_VERSION,
}
