"""Tiny Standard MIDI File reader/writer for PPP workers. No third-party deps."""
from __future__ import annotations

import struct


def _vlq(data, i):
    n = 0
    while True:
        b = data[i]
        i += 1
        n = (n << 7) | (b & 0x7F)
        if b < 0x80:
            return n, i


def _write_vlq(n):
    n = int(n)
    parts = [n & 0x7F]
    n >>= 7
    while n:
        parts.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(parts))


def read_notes(path):
    with open(path, 'rb') as source:
        data = source.read()
    if data[:4] != b'MThd':
        raise ValueError('not a MIDI file')
    header_len = struct.unpack('>I', data[4:8])[0]
    fmt, ntrks, division = struct.unpack('>HHH', data[8:14])
    tpq = division if division & 0x8000 == 0 else 480
    i = 8 + header_len
    notes = []
    pedals = []
    tempo = 500000
    tsig = (4, 4)
    for _ in range(ntrks):
        if data[i:i + 4] != b'MTrk':
            break
        ln = struct.unpack('>I', data[i + 4:i + 8])[0]
        i += 8
        chunk = data[i:i + ln]
        i += ln
        t = 0
        running = None
        j = 0
        ons = {}
        pedal_on = {}
        last_sec = 0.0
        while j < len(chunk):
            dt, j = _vlq(chunk, j)
            t += dt
            if j >= len(chunk):
                break
            b = chunk[j]
            if b >= 0x80:
                running = b
                j += 1
            st = running
            if st is None:
                break
            if st == 0xFF:
                meta = chunk[j]
                j += 1
                ml, j = _vlq(chunk, j)
                payload = chunk[j:j + ml]
                j += ml
                if meta == 0x51 and len(payload) == 3:
                    tempo = (payload[0] << 16) | (payload[1] << 8) | payload[2]
                elif meta == 0x58 and len(payload) >= 2:
                    tsig = (payload[0], 2 ** payload[1])
                continue
            if st >= 0xF0:
                if st in (0xF0, 0xF7):
                    ml, j = _vlq(chunk, j)
                    j += ml
                continue
            kind = st & 0xF0
            if kind in (0xC0, 0xD0):
                j += 1
                continue
            a = chunk[j]
            c = chunk[j + 1]
            j += 2
            ch = st & 0x0F
            sec = t * tempo / (tpq * 1e6)
            last_sec = max(last_sec, sec)
            if kind == 0x90 and c > 0:
                ons.setdefault((ch, a), []).append((sec, c))
            elif kind in (0x80, 0x90):
                stack = ons.get((ch, a))
                if stack:
                    on, vel = stack.pop(0)
                    notes.append({'on': on, 'off': max(on + 0.03, sec), 'midi': a, 'vel': vel})
            elif kind == 0xB0 and a == 64:
                # Damper pedal (CC64). TransKun writes pedal to MIDI when its
                # checkpoint supports it; preserving the controller here is
                # what lets the notation layer distinguish a held chord from
                # a new attack instead of silently throwing pedal away.
                if c >= 64 and ch not in pedal_on:
                    pedal_on[ch] = sec
                elif c < 64 and ch in pedal_on:
                    on = pedal_on.pop(ch)
                    if sec > on:
                        pedals.append({'on': on, 'off': sec})
        for on in pedal_on.values():
            if last_sec > on:
                pedals.append({'on': on, 'off': last_sec})
    notes.sort(key=lambda n: (n['on'], n['midi']))
    pedals.sort(key=lambda p: (p['on'], p['off']))
    bpm = round(60e6 / tempo)
    return {
        'notes': notes, 'pedals': pedals,
        'ticksPerQuarter': tpq, 'bpm': bpm,
        'beatsPerBar': tsig[0], 'beatType': tsig[1]
    }


def write_notes(path, notes, ticks_per_quarter=480, bpm=120, pedals=None):
    tempo = int(60e6 / max(30, min(240, bpm)))
    events = []
    events.append((0, bytes([0xFF, 0x51, 0x03]) + struct.pack('>I', tempo)[1:]))
    events.append((0, bytes([0xFF, 0x58, 0x04, 4, 2, 24, 8])))
    for n in notes:
        on = max(0, int(round(n['on'] * ticks_per_quarter * bpm / 60)))
        off = max(on + 1, int(round(n['off'] * ticks_per_quarter * bpm / 60)))
        midi = int(n['midi'])
        vel = max(1, min(127, int(n.get('vel') or 64)))
        events.append((on, bytes([0x90, midi, vel])))
        events.append((off, bytes([0x80, midi, 0])))
    for p in pedals or []:
        on = max(0, int(round(float(p['on']) * ticks_per_quarter * bpm / 60)))
        off = max(on + 1, int(round(float(p['off']) * ticks_per_quarter * bpm / 60)))
        events.append((on, bytes([0xB0, 64, 127])))
        events.append((off, bytes([0xB0, 64, 0])))
    events.sort(key=lambda e: e[0])
    body = bytearray()
    last = 0
    for t, payload in events:
        body += _write_vlq(t - last)
        body += payload
        last = t
    body += _write_vlq(0) + bytes([0xFF, 0x2F, 0x00])
    with open(path, 'wb') as f:
        f.write(b'MThd' + struct.pack('>IHHH', 6, 0, 1, ticks_per_quarter))
        f.write(b'MTrk' + struct.pack('>I', len(body)) + body)
