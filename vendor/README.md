# vendor/

Third-party files PPP serves itself, byte for byte as published (docs/GOALS/G04 §8.5, A29).

`.gitattributes` here turns off line-ending conversion (`* -text`), so a Windows checkout keeps the exact bytes and
the hashes below hold on every machine. `tests/engrave/vendor.test.js` checks them.

## vexflow-4.2.3.js

| | |
| --- | --- |
| What | VexFlow 4.2.3, the CommonJS/UMD build (`build/cjs/vexflow.js`): notation glyphs and note formatting |
| From | `https://cdn.jsdelivr.net/npm/vexflow@4.2.3/build/cjs/vexflow.js` (npm `vexflow@4.2.3`), the same URL the legacy renderer loads at runtime (`VEXFLOW_URL`, App 9209) |
| Header | `VexFlow 4.2.3   2023-08-16T07:06:43.824Z   62087494cafd5bf226201aab96c90a747c05a52c` |
| Size | 992,166 bytes |
| sha256 | `86855aa3f6e2202738d90807a1aa78c039d4264789e016a851c120a1bb8bbb73` |
| SRI | `sha384-HcSKHU8C+2rx18IlCMSlVWuygC4W9XRY8ebpaoE3Tg1iJO0g64QCxO2vO5HXIokW` |
| Licence | MIT, `LICENSE-vexflow.txt` (the package's own `LICENSE`) |

The build carries the glyph outlines of five music fonts as data (each a `fontFamily:"…"` table in the file). Its
default stack is Bravura, Gonville, Custom; Petaluma and Leland are loaded into it too (`F.load("Petaluma", …)`,
`F.load("Leland", …)`), so their data travels with it whether or not PPP selects them:

| Font (data in the build) | Licence | Notice |
| --- | --- | --- |
| Bravura (Steinberg Media Technologies GmbH), `generatedOn` 2022-12-18 | SIL Open Font License 1.1 | `LICENSE-bravura-OFL.txt` - the OFL asks that the notice and licence travel with the font data, so they are here |
| Petaluma (Steinberg Media Technologies GmbH), `generatedOn` 2022-12-18 | SIL Open Font License 1.1 | `LICENSE-petaluma-OFL.txt`, the font's own `redist/OFL.txt` (github.com/steinbergmedia/petaluma), byte for byte |
| Leland (MuseScore BVBA), `generatedOn` 2022-12-19 | SIL Open Font License 1.1 | `LICENSE-leland-OFL.txt`, the font's own `LICENSE.txt` (github.com/MuseScoreFonts/Leland), byte for byte; its copyright line is the current file's year |
| Gonville (Simon Tatham), as `GonvilleSmufl` | its font files are released without restriction (Gonville `LICENCE`: "Use of the output font files is UNRESTRICTED") | none needed |
| Custom (VexFlow's own glyphs) | MIT, as VexFlow | `LICENSE-vexflow.txt` |

It also carries three text-font tables used to measure words (`Arial`, `serif`, `PetalumaScript`): advance widths and
bounding boxes only, no outlines (checked: no outline field in any of their glyph entries). No text is drawn from them.
PetalumaScript is part of the Petaluma family and is covered by the Petaluma notice above.

The notices were fetched from the fonts' own repositories on 2026-09-25 (fixer, G04 §32.12);
`tests/engrave/vendor.test.js` checks that every outline font in the build has its row here.

`engrave/outlines.js` (G4c) carries the Bravura outlines of the glyphs the engraving layout uses (66), taken unchanged
from this build by `tests/engrave/tools/make-outlines.js` (`--check` in CI) so the SVG backend draws without loading
VexFlow; the Bravura notice above (`LICENSE-bravura-OFL.txt`) covers them, and the file's header says so.

Not an upgrade path to VexFlow 5 (G04 §7.3 B, R3): 4.2.3 is pinned. G4a only vendors and verifies the file; nothing loads
it yet. The legacy renderer keeps loading the same version from the CDN until the engraving renderer replaces it (G4b+).

## react-18.3.1/

React and ReactDOM 18.3.1, the UMD production builds, served by PPP so that the page does not stop when unpkg.com is unreachable
(docs/GOALS/G13_PRODUCTIZATION.md G13-D2, G13-1). The page loads them with two plain `<script>` tags before `support.js`, as
`./vendor/react-18.3.1/<file>?h=<12 hex of the sha256>` (server.js answers a matching `?h=` `immutable`, gzip); `support.js`
(generated, not edited) then finds React and does not fetch it. They are the files `support.js` pins and checks (`REACT_URL` /
`REACT_SRI`, `REACT_DOM_URL` / `REACT_DOM_SRI`), so the proof of identity is that pin: `tests/engrave/vendor-react.test.js`
checks the sha384 of each file against the constants in `support.js`, so a pin and a file cannot drift apart.

| File | From | Size | sha256 | SRI (sha384) |
| --- | --- | --- | --- | --- |
| `react-18.3.1/react.production.min.js` | `https://unpkg.com/react@18.3.1/umd/react.production.min.js` (npm `react@18.3.1`) | 10,751 bytes | `d949f1c3687aedadcedac85261865f29b17cd273997e7f6b2bfc53b2f9d4c4dd` | `sha384-DGyLxAyjq0f9SPpVevD6IgztCFlnMF6oW/XQGmfe+IsZ8TqEiDrcHkMLKI6fiB/Z` |
| `react-18.3.1/react-dom.production.min.js` | `https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js` (npm `react-dom@18.3.1`) | 131,835 bytes | `35f4f974f4b2bcd44da73963347f8952e341f83909e4498227d4e26b98f66f0d` | `sha384-gTGxhz21lVGYNMcdJOyq01Edg0jhn/c22nsx0kyqP0TxaV5WVdsSH1fSDUf5YJj1` |

Licence: MIT (Copyright (c) Facebook, Inc. and its affiliates), `react-18.3.1/LICENSE-react.txt` and
`react-18.3.1/LICENSE-react-dom.txt`, each the package's own `LICENSE` byte for byte (unpkg.com/react@18.3.1/LICENSE and
unpkg.com/react-dom@18.3.1/LICENSE; the two files happen to be identical). Neither package has a NOTICE file.

**The way back (`PPP.cdn`, G13-D3).** `?cdn=1` in the address (this visit), or `localStorage['ppp.cdn'] = '1'` (this device; `PPP.cdn = 1`
in the console writes it), makes the page drop the vendored React and load the pinned unpkg copies, exactly as before G13-1. `?cdn=0`
is "vendored" for one visit even when a `1` is stored. Any other value is no choice, and no choice is the default: vendored. This
switch is removed one release after G13-1 has been live (G13-D3). A page whose vendored files fail to load has no React either, and
`support.js` then loads the unpkg ones on its own.

To change the version: move the pins in `support.js` first (it is generated), then replace the folder, the two `?h=` values in the app
head and this table; the test says which of them is out of step.

## fonts/

The Latin fonts of the page, and the music font, served by PPP itself so that no text waits for another site and the page has them offline
(docs/GOALS/G13_PRODUCTIZATION.md G13-4b). Each file is the woff2 that Google Fonts serves for the family (fonts.googleapis.com/css2, fetched with a
Chrome 153 user agent on 2026-10-08), **byte for byte** (no subsetting or other change is made here: the SIL Open Font License allows redistribution,
and a modified font may not keep a Reserved Font Name). The page declares them in a `<style>` in its head with the same weights, styles and
`unicode-range`s as Google's own stylesheet (`font-display: swap`), so a file is fetched only when a character of its range is on the page.
Only the `latin` and `latin-ext` pieces (and `music`) are here: Figtree and Instrument Serif have no others on Google Fonts; JetBrains Mono also has
cyrillic, cyrillic-ext, greek and vietnamese, which are not kept (the mono face only draws bar numbers, hint letters and times: those characters fall
back to the system monospace). **Korean, Japanese and Chinese text is not here**: Noto Sans KR / JP / SC stay on Google Fonts, asked for after the page
has loaded (U7 in the G13 doc is undecided).

| File | Family, style, subset | Google Fonts URL | Size | sha256 |
| --- | --- | --- | --- | --- |
| `fonts/figtree-v9-latin.woff2` | Figtree 400-700 (one variable file, declared once per weight 400/500/600/700), latin | `https://fonts.gstatic.com/s/figtree/v9/_Xms-HUzqDCFdgfMm4S9DQ.woff2` | 20,156 bytes | `4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd` |
| `fonts/figtree-v9-latin-ext.woff2` | Figtree, latin-ext | `https://fonts.gstatic.com/s/figtree/v9/_Xms-HUzqDCFdgfMm4q9DbZs.woff2` | 10,280 bytes | `bf7828e2c258cffcfa50a048ee388a36b95bc16b452e8d36fa797635dbe15965` |
| `fonts/instrument-serif-v5-latin.woff2` | Instrument Serif 400 normal, latin | `https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zUTjg.woff2` | 21,032 bytes | `5eb09b5ac0e28b67c2f041c8ba6d244604ca0c0980d65912ab2d47fed84ddc31` |
| `fonts/instrument-serif-v5-latin-ext.woff2` | Instrument Serif 400 normal, latin-ext | `https://fonts.gstatic.com/s/instrumentserif/v5/jizBRFtNs2ka5fXjeivQ4LroWlx-6zsTjmbI.woff2` | 11,604 bytes | `290e6267dd833bf5f899eba4c29ad0a9b09dbe53f6075b18af38057159e1ff20` |
| `fonts/instrument-serif-v5-italic-latin.woff2` | Instrument Serif 400 italic, latin | `https://fonts.gstatic.com/s/instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zAjjH7M.woff2` | 22,128 bytes | `5a51946dfffa82972bc98745359c46761515641fda557c25116459a9f83da4a7` |
| `fonts/instrument-serif-v5-italic-latin-ext.woff2` | Instrument Serif 400 italic, latin-ext | `https://fonts.gstatic.com/s/instrumentserif/v5/jizHRFtNs2ka5fXjeivQ4LroWlx-6zAjgn7MsNo.woff2` | 12,384 bytes | `d0014821252a8a770bf7551641572f239a8ede83d75652d84fef0c3627751baf` |
| `fonts/jetbrains-mono-v24-latin.woff2` | JetBrains Mono 400-500 (variable, declared for 400 and 500), latin | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPxDcwg.woff2` | 31,432 bytes | `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be` |
| `fonts/jetbrains-mono-v24-latin-ext.woff2` | JetBrains Mono, latin-ext | `https://fonts.gstatic.com/s/jetbrainsmono/v24/tDbv2o-flEEny0FZhsfKu5WU4zr3E_BX0PnT8RD8yKwBNntkaToggR7BYRbKPx7cwhsk.woff2` | 11,624 bytes | `db5ff4db83e580426280e9337a58dc57d3a83784a1b03ad80914651594441d52` |
| `fonts/noto-music-v21-music.woff2` | Noto Music 400, music (U+25CC, U+2669-266F, U+1D000-1D0F5, U+1D100-1D245: the clefs and accidentals the lessons and the Home card draw) | `https://fonts.gstatic.com/s/notomusic/v21/pe0rMIiSN5pO63htf1sxEkW7I9tScg.woff2` | 56,324 bytes | `20881b15b870b8005986da42bf273b33da61df848d5e26e670556adfd0e3bc22` |

Licences (SIL Open Font License 1.1), each the family's own `OFL.txt` from github.com/google/fonts (`ofl/<family>/OFL.txt`) byte for byte:

| Family | Copyright line | File |
| --- | --- | --- |
| Figtree | Copyright 2022 The Figtree Project Authors (https://github.com/erikdkennedy/figtree) | `fonts/LICENSE-figtree-OFL.txt` |
| Instrument Serif | Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif) | `fonts/LICENSE-instrument-serif-OFL.txt` |
| JetBrains Mono | Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono) | `fonts/LICENSE-jetbrains-mono-OFL.txt` |
| Noto Music | Copyright 2022 The Noto Project Authors (https://github.com/notofonts/music) | `fonts/LICENSE-noto-music-OFL.txt` |

The page asks for each file as `./vendor/fonts/<file>?h=<12 hex of the sha256 of its bytes>` (server.js rewrites the `?v=1` of the source,
`static-assets.js`), which the server answers `immutable` (no gzip: a woff2 is compressed already). `tests/load/fonts.test.js` checks the table above against
the files, the licences against the families, and the `@font-face` rules of the page against Google's published faces.

## pdfjs-3.11.174/

pdf.js 3.11.174 (npm `pdfjs-dist`), the "legacy" production build of the library and of its worker, served by PPP so that reading a PDF or a photo of a score does not depend on jsDelivr
(docs/GOALS/G13_PRODUCTIZATION.md G13-8). They are the two files the page loaded from `cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/` before. The page asks for them, once, when a PDF or a
photo is added (`loadPdfJs`), as `./vendor/pdfjs-3.11.174/<file>?h=<12 hex of the sha256>` (server.js answers a matching `?h=` `immutable`, gzip); it sets the worker's address to the second file.

| File | From | Size | sha256 | In the tarball |
| --- | --- | --- | --- | --- |
| `pdfjs-3.11.174/pdf.min.js` | `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.min.js` (npm `pdfjs-dist@3.11.174`) | 377,116 bytes | `978fd1b2d134a98e98966186a97777bebf87d8e770dadab1ece3687e21a5aa6c` | `package/legacy/build/pdf.min.js` |
| `pdfjs-3.11.174/pdf.worker.min.js` | `https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.js` (npm `pdfjs-dist@3.11.174`) | 1,133,660 bytes | `38cde5311957b86bc3669f93e7d2566de333a90055ed6635bef60d9bf00e96f2` | `package/legacy/build/pdf.worker.min.js` |

Tarball: `https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-3.11.174.tgz`, integrity `sha512-TdTZPf1trZ8/UFu5Cx/GXB7GZM30LT+wWUNfsi6Bq8ePLnb+woNKtDymI2mxZYBpMbonNFqKmiz684DIfnd8dA==` (the registry's `dist.integrity`). Each file above is byte for byte the file of that name in the tarball, and the bytes jsDelivr served on 2026-10-15 are the same (`tools/notices/verify-tarballs.js` re-checks both from the registry; `tests/engrave/vendor-optional.test.js` checks the sha256 above, every run).

Embedded in both files (compiled into it by its authors; the file is not changed, and their licence texts are in `LICENSE-embedded.txt`):

| Embedded | Version | Licence | Copyright | From | How it is known to be in the file |
| --- | --- | --- | --- | --- | --- |
| core-js | 3.32.2 | MIT | Copyright (c) 2014-2023 Denis Pushkarev (zloirock.ru) | https://github.com/zloirock/core-js | the files' own text names it: version 3.32.2, the copyright and the licence URL (github.com/zloirock/core-js/blob/v3.32.2/LICENSE); the package's source maps list core-js as the only package compiled in |

Used for: reading a PDF or a photo of a score (the import screen); loaded only when one is added.

Licence: Apache-2.0, `pdfjs-3.11.174/LICENSE.txt` (the package's own `LICENSE`, byte for byte). The package has no NOTICE file.

Copyright: Copyright 2023 Mozilla Foundation (the notice in the header of both files).

The way back is `PPP.cdn` (the last section of this file). The cMaps and standard fonts of `pdfjs-dist` are not here: the page never asked for them.

## tfjs-2.8.6/

TensorFlow.js 2.8.6 (npm `@tensorflow/tfjs`), the UMD browser build (`dist/tf.min.js`), the runtime the Onsets and Frames model of Magenta.js needs. The page asks for it, once, when a recording is read in
the browser (`loadPianoAmt`), as `./vendor/tfjs-2.8.6/tf.min.js?h=<12 hex of the sha256>`, then for `transcription.js` of the next section. It makes the global `tf`.

| File | From | Size | sha256 | In the tarball |
| --- | --- | --- | --- | --- |
| `tfjs-2.8.6/tf.min.js` | `https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@2.8.6/dist/tf.min.js` (npm `@tensorflow/tfjs@2.8.6`) | 1,167,497 bytes | `0082fff8188ab64a65fd02a936d3f97bdf388a11ae2ba0b9a58ae7d48fa85b14` | `package/dist/tf.min.js` |

Tarball: `https://registry.npmjs.org/@tensorflow/tfjs/-/tfjs-2.8.6.tgz`, integrity `sha512-/Hk3YCAreNicuQJsAIG32UGHaQj8UwX8y8ZrKVb/CrXOhrRyZmxGSZt9KMVe8MDoydenuGhZCqJUIaWdIKIA5g==` (the registry's `dist.integrity`). The file is byte for byte the one in the tarball and the one jsDelivr served on 2026-10-15.

Embedded in this file (compiled into it by its authors; the file is not changed, and their licence texts are in `LICENSE-embedded.txt`):

| Embedded | Version | Licence | Copyright | From | How it is known to be in the file |
| --- | --- | --- | --- | --- | --- |
| core-js | 3.6.5 | MIT | Copyright (c) 2014-2020 Denis Pushkarev (zloirock.ru) | https://github.com/zloirock/core-js | the file's own text names version 3.6.5 and "(c) 2020 Denis Pushkarev (zloirock.ru)"; the package's rollup report lists it |
| seedrandom (with its alea, xor128, xorwow, xorshift7, xor4096 and tychei generators) | 2.4.3 | MIT | Copyright 2014 David Bau; alea: Copyright (C) 2010 Johannes Baagøe | https://github.com/davidbau/seedrandom | tfjs-core 2.8.6 pins seedrandom 2.4.3; the generators' names are in the file; the package's rollup report lists it |
| regenerator-runtime | 0.13.x (the file does not say which; tfjs 2.8.6 asks for ^0.13.5) | MIT | Copyright (c) 2014-present, Facebook, Inc. | https://github.com/facebook/regenerator | the package's rollup report lists it |

Used for: the in-browser recording transcription (Onsets and Frames, with Magenta.js); loaded only when a recording is converted in the browser.

Licence: Apache-2.0, `tfjs-2.8.6/LICENSE.txt` (the `LICENSE` of github.com/tensorflow/tfjs at the tag `tfjs-v2.8.6`, byte for byte: the npm tarball carries no licence file). The package has no NOTICE file.

Copyright: Copyright 2021 Google LLC (the notice in the file's header).

## magenta-music-1.23.1/

Magenta.js 1.23.1 (npm `@magenta/music`), `es6/transcription.js`: the Onsets and Frames piano transcription model's code, a UMD bundle that takes the global `tf` (the file of the previous section). The
page asks for it right after `tf.min.js`, as `./vendor/magenta-music-1.23.1/transcription.js?h=<12 hex of the sha256>`; it makes the global `transcription`. The **model weights are not here**: the checkpoint
(about 60 MB) is still fetched from `storage.googleapis.com/magentadata/js/checkpoints/transcription/onsets_frames_uni` when a recording is read in the browser (G13 U8: it needs internet, and the page says so;
the PC worker is the strong path).

| File | From | Size | sha256 | In the tarball |
| --- | --- | --- | --- | --- |
| `magenta-music-1.23.1/transcription.js` | `https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/es6/transcription.js` (npm `@magenta/music@1.23.1`) | 218,041 bytes | `7284bdbf628aa7e58bd8509a6de80886bf0f1564a58775ec413034229c6c0733` | `package/es6/transcription.js` |

Tarball: `https://registry.npmjs.org/@magenta/music/-/music-1.23.1.tgz`, integrity `sha512-MKIf5nU5fJg/j0y+zCeuQuhA5D4TD0hWv+crOpNQLq7TRJ5GQnlz4WuShYzSw/gXj2ncWuYGr6ftP9DvqSsQkA==` (the registry's `dist.integrity`). The file is byte for byte the one in the tarball and the one jsDelivr served on 2026-10-15.

Embedded in this file (compiled into it by its authors; the file is not changed, and their licence texts are in `LICENSE-embedded.txt`):

| Embedded | Version | Licence | Copyright | From | How it is known to be in the file |
| --- | --- | --- | --- | --- | --- |
| protobufjs (its minimal runtime and the @protobufjs/* packages it uses) | 6.x (the file does not say which; Magenta.js asks for ^6.8.6) | BSD-3-Clause | Copyright (c) 2016, Daniel Wirtz | https://github.com/protobufjs/protobuf.js | the runtime's code is in the file ("illegal buffer", the Long lookup); the module graph of the package's unbundled build imports protobufjs/minimal |
| buffer | 4.x or 6.x (webpack's browser Buffer; the file does not say which) | MIT | Copyright (c) Feross Aboukhadijeh, and other contributors | https://github.com/feross/buffer | the file carries its notice ("@license MIT", "@author Feross Aboukhadijeh") |
| ieee754 | 1.x | BSD-3-Clause | Copyright 2008 Fair Oaks Labs, Inc. | https://github.com/feross/ieee754 | the file carries its notice ("ieee754. BSD-3-Clause License. Feross Aboukhadijeh") |
| base64-js | 1.x | MIT | Copyright (c) 2014 Jameson Little | https://github.com/beatgammit/base64-js | its error text ("Invalid string. Length must be a multiple of 4") is in the file; buffer uses it |
| fft.js | 4.0.x (Magenta.js asks for ^4.0.3) | MIT | Copyright Fedor Indutny, 2017 | https://github.com/indutny/fft.js | its error text ("FFT size must be a power of two") is in the file |
| ndarray-resample, ndarray, cwise and the packages they use | 1.0.x, 1.x, 1.0.x | MIT | Copyright (c) 2013 Mikola Lysenko (ndarray: 2013-2016) | https://github.com/scijs/ndarray-resample | "ndarray-resample" error text and cwise's generated-function names are in the file; the module graph imports ndarray and ndarray-resample |

Used for: the in-browser recording transcription (Onsets and Frames); loaded only when a recording is converted in the browser.

Licence: Apache-2.0, `magenta-music-1.23.1/LICENSE.txt` (the `LICENSE` of github.com/magenta/magenta-js, byte for byte: the npm tarball carries no licence file, and that file has had one commit, of 2018-03-27). The package has no NOTICE file.

Copyright: Copyright 2018 The Magenta Team. All rights reserved. (the first line of that LICENSE; the bundle has no header of its own).

## tfjs-3.21.0/

TensorFlow.js 3.21.0 (npm `@tensorflow/tfjs`), `dist/tf.fesm.min.js`: the package's flat ES module build, with no imports (the converter, the layers, the data API and the CPU and WebGL backends are inside it).
The page used to ask esm.sh to build this package; the Basic Pitch path (the next section) now imports this file, through an import map, as `./vendor/tfjs-3.21.0/tf.fesm.min.js?h=<12 hex of the sha256>`.
The UMD build of the same package (`dist/tf.min.js`) is not used: it would put a second `tf` over the 2.8.6 one the Onsets and Frames path keeps in `window.tf`, and an ES module cannot import a UMD file.

| File | From | Size | sha256 | In the tarball |
| --- | --- | --- | --- | --- |
| `tfjs-3.21.0/tf.fesm.min.js` | npm `@tensorflow/tfjs@3.21.0`, `dist/tf.fesm.min.js` | 1,069,735 bytes | `2b719ce53b3de9798b23836074de66ac38edadf61066e4d04d7929d100a2a03a` | `package/dist/tf.fesm.min.js` |

Tarball: `https://registry.npmjs.org/@tensorflow/tfjs/-/tfjs-3.21.0.tgz`, integrity `sha512-khcARd3/872llL/oF4ouR40qlT71mylU66PGT8kHP/GJ5YKj44sv8lDRjU7lOVlJK7jsJFWEsNVHI3eMc/GWNQ==` (the registry's `dist.integrity`). The file is byte for byte the one in the tarball.

Embedded in this file (compiled into it by its authors; the file is not changed, and their licence texts are in `LICENSE-embedded.txt`):

| Embedded | Version | Licence | Copyright | From | How it is known to be in the file |
| --- | --- | --- | --- | --- | --- |
| seedrandom (with its alea, xor128, xorwow, xorshift7, xor4096 and tychei generators) | 3.0.5 | MIT | Copyright 2019 David Bau; alea: Copyright (C) 2010 Johannes Baagøe | https://github.com/davidbau/seedrandom | tfjs-core 3.21.0 asks for ^3.0.5 (3.0.5 is the last 3.0.x); the generators' names are in the file; the package's rollup report lists it |
| long | 4.0.0 | Apache-2.0 | Daniel Wirtz (the package names no copyright line; derived from the Closure Library) | https://github.com/dcodeIO/long.js | tfjs-core 3.21.0 pins long 4.0.0; the package's rollup report lists it |

Used for: the Basic Pitch note-detection path of the in-browser recording transcription; loaded only when a recording is converted in the browser as a full song (arrangement mode) or when the Onsets and Frames model could not run.

Licence: Apache-2.0, `tfjs-3.21.0/LICENSE.txt` (the `LICENSE` of github.com/tensorflow/tfjs at the tag `tfjs-v3.21.0`, byte for byte: the npm tarball carries no licence file). The package has no NOTICE file.

Copyright: Copyright 2022 Google LLC (the notice in the file's header).

## basic-pitch-1.0.1/

Basic Pitch 1.0.1 (npm `@spotify/basic-pitch`), the package's ES module build (`esm/`) and its model (`model/`: the TensorFlow.js graph model and its one weights file, 742 KB): the note-detection fallback of
the in-browser recording transcription. The three modules import `@tensorflow/tfjs` and `@tonejs/midi` by bare name and each other without ".js", so the page gives the browser an import map the first time
this path is used (`loadAmt`): `@tensorflow/tfjs` is the file of the previous section, `./inference` and `./toMidi` are the files here, and **`@tonejs/midi` is a one-line stand-in that throws if it is ever
used** - `toMidi.js` imports it for `generateFileData` (writing a MIDI file), which PPP never calls, and its own build is not an ES module. The stand-in is in the page (a `data:` address in the map), not in
this folder: nothing here is changed. Without import maps (Safari before 16.4, Chrome before 89, Firefox before 108) or when a file cannot be fetched, the page falls back to esm.sh as before.

| File | From | Size | sha256 | In the tarball |
| --- | --- | --- | --- | --- |
| `basic-pitch-1.0.1/esm/index.js` | npm `@spotify/basic-pitch@1.0.1`, `esm/index.js` | 167 bytes | `c49399b9859489f9968c7257cd83dfa2f4954260b21184f793f05b87a055aa7b` | `package/esm/index.js` |
| `basic-pitch-1.0.1/esm/inference.js` | npm `@spotify/basic-pitch@1.0.1`, `esm/inference.js` | 5,013 bytes | `d0bceb71ee6d35aa50575dea0b09bf9ef324353f1dc862ddc30450bdcfa65d6a` | `package/esm/inference.js` |
| `basic-pitch-1.0.1/esm/toMidi.js` | npm `@spotify/basic-pitch@1.0.1`, `esm/toMidi.js` | 13,252 bytes | `c6492ceae181d24fb254a152d0853f2a60f27e78547db96258026ddcd81ef618` | `package/esm/toMidi.js` |
| `basic-pitch-1.0.1/model/model.json` | `https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/model.json` (npm `@spotify/basic-pitch@1.0.1`) | 174,537 bytes | `1ed1aaee3409ec1dc098c8b01f430c0911f6fe9412e7af8086750f9e8f302f68` | `package/model/model.json` |
| `basic-pitch-1.0.1/model/group1-shard1of1.bin` | `https://cdn.jsdelivr.net/npm/@spotify/basic-pitch@1.0.1/model/group1-shard1of1.bin` (npm `@spotify/basic-pitch@1.0.1`) | 742,392 bytes | `b142a95737a52e1e412d5f92e73d8bb80dfe8d04941acc0702f11f4524fb377c` | `package/model/group1-shard1of1.bin` |

Tarball: `https://registry.npmjs.org/@spotify/basic-pitch/-/basic-pitch-1.0.1.tgz`, integrity `sha512-SAxiFi9ZnyhGdhWEOS9YVhdunZiKzI3I5zOccZzDzQRr4s00Ii9lphqlPMMfby3iYa7TSupB2g8yuu1kJ6gL+Q==` (the registry's `dist.integrity`). Each file above is byte for byte the file in the tarball; the two model files are also the bytes jsDelivr served on 2026-10-15. The source maps (`index.js.map`) are not here.

Used for: the note-detection fallback of the in-browser recording transcription (the model is part of this folder: this path needs no internet); loaded only when a recording is converted in the browser as a full song (arrangement mode) or when the Onsets and Frames model could not run.

Licence: Apache-2.0, `basic-pitch-1.0.1/LICENSE.txt` (the package's own `LICENSE`, byte for byte). The package has no NOTICE file.

Copyright: Copyright 2022 Spotify AB (the notice in the package's `src/*.ts`; the compiled `esm/` files carry none).

### Optional libraries: the way back (`PPP.cdn`, G13-D3)

The five sections above (pdf.js, TensorFlow.js 2.8.6, Magenta.js, TensorFlow.js 3.21.0, Basic Pitch) are loaded on demand, never from the head. They share the switch of React: `?cdn=1` in the
address (this visit), or `localStorage['ppp.cdn'] = '1'` (this device), puts the jsDelivr / esm.sh addresses the page used before G13-8 back; `?cdn=0` is "vendored" for one visit; any other value is no
choice, and no choice is the default: vendored. In the default, a vendored file that cannot be fetched is asked for once more at its CDN address. The switch is removed one release after G13-8 has been
live (G13-D3).

A CDN copy of a plain `<script>` (pdf.js, TensorFlow.js 2.8.6, `transcription.js`) is loaded with its `integrity` (the sha384 of the published file, which is the vendored file) and `crossorigin="anonymous"`, so a CDN that
answered with anything else is refused by the browser. SRI cannot be put on what is not a `<script>`: pdf.js starts its worker itself (a blob wrapper that calls `importScripts` on a CDN worker), and the Basic Pitch
fallback is `import()` of esm.sh / jsDelivr `+esm` builds, which are those services' builds and not the published files: those two are taken on the CDN's word, as they were before G13-8.
A fallback is not silent: `PPP.libFallbacks` (read-only) counts, per library (`pdfjs`, `tfjs-2.8.6`, `magenta-music`, `basic-pitch`), the times PPP's own copy could not be fetched; it is `{}` on a healthy site
(`tests/live/smoke.js` and the browser suites read it; the anonymous counters of G13-7b carry it as `lib`). A pdf.js whose worker cannot be fetched is not handed out: the worker is asked for first and, failing that, taken from the CDN too.

What still comes from another site: the Onsets and Frames checkpoint (about 60 MB, `storage.googleapis.com`, G13 U8) and the Google fonts of the Korean, Japanese and Chinese text (G13-4b). To change a
version: replace the folder, the `?h=` values and the CDN address in `PPP_LIBS` of the app and the rows above; the tests say which of them is out of step.
