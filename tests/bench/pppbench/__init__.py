"""PPP score-quality benchmark (G0).

Version constants are written into every result and baseline. Bump the one
whose meaning changed; compare refuses to mix versions (docs/GOALS/G00 §8.7).
"""

READER_VERSION = "reader/4"   # pedal marks, ottava modes, ties only where the tied note ends;
                              # /3: clefs, bar numbers as the app keys them, printed rest shapes
                              # /4 (G00 §21): repeat signs, endings and bar-line styles of part 0
METRICS_VERSION = "metrics/6" # missing = 0, metre from the MusicXML, critical gates, pedal, accidentals;
                              # /3: replay pedal scored against the performance, not the AMT; false pedal
                              # /4 (G00 §19): tempo/metre/key over the whole score, note shapes, complete bars,
                              #     bar numbers, note values in usable, PredTime on the SUT's beat model
                              # /5 (G00 §21): the app's play order (repeats) in critical.structure; a short
                              #     bar is excused only at a pickup, its complement or a repeat-backed split,
                              #     never by the prediction's own implicit="yes"
                              # /6 (G00 §22 PF-M1, PF-M2): a prediction's own lone forward repeat excuses a
                              #     split only where a backward repeat could actually consume it; a prediction's
                              #     first or last bar being short excuses nothing unless the truth is short the
                              #     same way there too; struct.measures.count_exact joins critical.structure
SQI_VERSION = "sqi/2"         # diagnostic score: re-weighted, reference-normalised
GENERATOR_VERSION = "perform/2" # + pedal and human-alt profiles

VERSIONS = {
    "reader": READER_VERSION,
    "metrics": METRICS_VERSION,
    "sqi": SQI_VERSION,
    "generator": GENERATOR_VERSION,
}
