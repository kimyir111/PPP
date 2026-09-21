"""PPP score-quality benchmark (G0).

Version constants are written into every result and baseline. Bump the one
whose meaning changed; compare refuses to mix versions (docs/GOALS/G00 §8.7).
"""

READER_VERSION = "reader/1"
METRICS_VERSION = "metrics/1"
SQI_VERSION = "sqi/1"
GENERATOR_VERSION = "perform/1"

VERSIONS = {
    "reader": READER_VERSION,
    "metrics": METRICS_VERSION,
    "sqi": SQI_VERSION,
    "generator": GENERATOR_VERSION,
}
