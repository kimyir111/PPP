"""Build catalog/method/index.json from books.json and the MusicXML files in
catalog/method/<book>/NNN.musicxml.

    python catalog/method/build.py

Each piece row carries what the page shows before opening it: bars, key and
time signature. Pieces are numbered by their file name (NNN), or listed in a
book's "pieces" in books.json when they have titles of their own.
"""
import json, os, re, sys, zipfile
import xml.etree.ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#']
MINOR = ['Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#']


CONTAINER = ('<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles>'
             '<rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>'
             '</rootfiles></container>\n')


def pack(path):
    """NNN.musicxml -> NNN.mxl (zipped, about a tenth of the size)."""
    out = path[:-len('.musicxml')] + '.mxl'
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        z.writestr('META-INF/container.xml', CONTAINER)
        z.write(path, 'score.xml')
    os.remove(path)
    return out


def load(path):
    if path.endswith('.mxl'):
        z = zipfile.ZipFile(path)
        return ET.fromstring(z.read('score.xml'))
    return ET.parse(path).getroot()


def meta(path):
    root = load(path)
    part = root.find('part')
    measures = part.findall('measure')
    fifths, mode, time = 0, 'major', ''
    for m in measures[:1]:
        a = m.find('attributes')
        if a is not None:
            k = a.find('key')
            if k is not None:
                fifths = int(k.findtext('fifths', '0'))
                mode = (k.findtext('mode') or 'major').lower()
            t = a.find('time')
            if t is not None:
                sym = t.get('symbol')
                time = t.findtext('beats') + '/' + t.findtext('beat-type')
    staves = int(part.findtext('measure/attributes/staves', '1'))
    notes = sum(1 for n in part.iter('note') if n.find('pitch') is not None)
    key = (MINOR if mode == 'minor' else MAJOR)[fifths + 7]
    return {'measures': len(measures), 'key': key, 'mode': 'minor' if mode == 'minor' else 'major',
            'time': time, 'staves': staves, 'notes': notes}


def main():
    books = json.load(open(os.path.join(HERE, 'books.json'), encoding='utf-8'))
    out = {'license': books['license'], 'books': []}
    for b in books['books']:
        d = os.path.join(HERE, b['id'])
        pieces = []
        titled = {p['no']: p for p in b.get('pieces', [])}
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith('.musicxml'):
                    pack(os.path.join(d, f))
        files = sorted(f for f in os.listdir(d) if f.endswith('.mxl')) if os.path.isdir(d) else []
        for f in files:
            m = re.match(r'(\d+)', f)
            if not m:
                continue
            no = int(m.group(1))
            row = {'no': no, 'file': b['id'] + '/' + f}
            for k in ('title', 'name'):
                if no in titled and titled[no].get(k):
                    row[k] = titled[no][k]
            row.update(meta(os.path.join(d, f)))
            pieces.append(row)
        book = {k: v for k, v in b.items() if k != 'pieces'}
        book['pieces'] = pieces
        out['books'].append(book)
        print(f"{b['id']:12} {len(pieces):3} of {b.get('count', len(pieces))}")
    json.dump(out, open(os.path.join(HERE, 'index.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
