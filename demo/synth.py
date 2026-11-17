"""Original synthesized soundtrack for the demo, locked to the video's scene timing.

usage: synth.py out/timing.json audio/
writes audio/synth-music.wav (beat, bass, chords, arp) and audio/synth-sfx.wav
(whooshes into each cut, typing ticks, pops on the model switches, mouse clicks).
Key D major, I-V-vi-IV, tempo from timing.json (default 100 BPM).
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 44100
RNG = np.random.default_rng(7)

timing = json.loads(Path(sys.argv[1]).read_text())
out_dir = Path(sys.argv[2])
BPM = timing["bpm"]
BEAT = 60 / BPM
TOTAL = timing["total"]
N = int((TOTAL + 2.5) * SR)
start = dict(zip(timing["ids"], timing["starts"]))
dur = dict(zip(timing["ids"], timing["durs"]))


def midi(n):
    return 440 * 2 ** ((n - 69) / 12)


def env(n, attack, decay):
    t = np.arange(n) / SR
    a = np.minimum(1, t / max(attack, 1e-4))
    return a * np.exp(-t / decay)


def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, "low", fs=SR, output="sos"), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def saw(f, n, detune=0.0):
    t = np.arange(n) / SR
    ph = (t * f * (1 + detune)) % 1
    return 2 * ph - 1


def add(buf, at, sig, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= len(buf) or i + len(sig) <= 0:
        return
    if i < 0:
        sig = sig[-i:]
        i = 0
    sig = sig[: len(buf) - i]
    left = np.cos((pan + 1) * np.pi / 4)
    right = np.sin((pan + 1) * np.pi / 4)
    buf[i:i + len(sig), 0] += sig * gain * left * 1.414
    buf[i:i + len(sig), 1] += sig * gain * right * 1.414


# ---- instruments -----------------------------------------------------------

def kick():
    n = int(0.45 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    click = hp(RNG.standard_normal(n), 3000) * np.exp(-t / 0.004) * 0.3
    return np.tanh(1.6 * (body + click))


def clap():
    n = int(0.3 * SR)
    noise = bp(RNG.standard_normal(n), 900, 4000)
    e = np.zeros(n)
    for k, d in enumerate([0, 0.011, 0.022]):
        i = int(d * SR)
        e[i:] += env(n - i, 0.001, 0.008 if k < 2 else 0.12)
    return noise * e * 0.6


def hat(open_=False):
    n = int((0.25 if open_ else 0.06) * SR)
    return hp(RNG.standard_normal(n), 7000) * env(n, 0.001, 0.09 if open_ else 0.018) * 0.35


def pluck(note, length=0.35):
    n = int(length * SR)
    f = midi(note)
    t = np.arange(n) / SR
    tone = np.sign(np.sin(2 * np.pi * f * t)) * 0.4 + np.sin(2 * np.pi * 2 * f * t) * 0.3
    return lp(tone, 2600) * env(n, 0.002, 0.09)


def bass_note(note, length):
    n = int(length * SR)
    f = midi(note)
    sig = 0.6 * saw(f, n) + 0.5 * np.sin(2 * np.pi * f * np.arange(n) / SR)
    sig = lp(sig, 380)
    e = np.minimum(1, np.arange(n) / (0.005 * SR)) * np.minimum(1, (n - np.arange(n)) / (0.02 * SR))
    return sig * e * 0.55


def pad_chord(notes, length, cutoff):
    n = int(length * SR)
    sig = np.zeros(n)
    for note in notes:
        for d in (-0.004, 0.0, 0.005):
            sig += saw(midi(note), n, d)
    sig = lp(sig / (3 * len(notes)), cutoff)
    a = np.minimum(1, np.arange(n) / (0.25 * SR))
    r = np.minimum(1, (n - np.arange(n)) / (0.3 * SR))
    return sig * a * r * 0.5


# ---- sound effects -----------------------------------------------------------

def whoosh(length=0.6, up=True):
    n = int(length * SR)
    noise = RNG.standard_normal(n)
    out = np.zeros(n)
    steps = 24
    for s in range(steps):
        a = s * n // steps
        b = (s + 1) * n // steps
        frac = s / (steps - 1)
        centre = 400 * (16 ** (frac if up else 1 - frac))
        seg = bp(noise, centre / 1.6, min(centre * 1.6, 18000))[a:b]
        out[a:b] = seg
    shape = np.sin(np.pi * np.linspace(0, 1, n)) ** 2 * np.linspace(0.3, 1, n)
    return out * shape * 0.6


def swell(length=1.6):
    # reverse-cymbal style: filtered noise that grows and brightens, ending on the cut
    n = int(length * SR)
    noise = RNG.standard_normal(n)
    out = np.zeros(n)
    steps = 20
    for s in range(steps):
        a = s * n // steps
        b = (s + 1) * n // steps
        out[a:b] = lp(noise, 800 + 7000 * (s / (steps - 1)) ** 2)[a:b]
    shape = np.linspace(0, 1, n) ** 2.5
    tail = np.minimum(1, (n - np.arange(n)) / (0.05 * SR))
    return out * shape * tail * 0.5


def blip(f0, f1, length=0.16):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = f0 * (f1 / f0) ** (t / length)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(n, 0.002, length / 3) * 0.6


def tick():
    n = int(0.025 * SR)
    return bp(RNG.standard_normal(n), 2000, 6000) * env(n, 0.0005, 0.004) * 0.5


def thock():
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 180 * t) * env(n, 0.001, 0.02) + bp(RNG.standard_normal(n), 800, 3000) * env(n, 0.0005, 0.006) * 0.5) * 0.7


def chime(notes):
    n = int(1.2 * SR)
    t = np.arange(n) / SR
    sig = np.zeros(n)
    for k, note in enumerate(notes):
        i = int(k * 0.06 * SR)
        f = midi(note)
        part = (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(2 * np.pi * 3 * f * t)) * env(n, 0.002, 0.35)
        sig[i:] += part[: n - i]
    return sig * 0.25


def impact():
    n = int(1.4 * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t / 0.08)) / SR) * env(n, 0.002, 0.5)
    crash = hp(RNG.standard_normal(n), 4000) * env(n, 0.001, 0.4) * 0.25
    return np.tanh(1.3 * boom) * 0.8 + crash


# ---- arrangement -------------------------------------------------------------

music = np.zeros((N, 2))
drums = np.zeros((N, 2))
sfx = np.zeros((N, 2))

# D major: D - A - Bm - G, one chord per bar
PROG = [
    (50, [62, 66, 69, 74]),
    (45, [61, 64, 69, 73]),
    (47, [62, 66, 71, 74]),
    (43, [62, 67, 71, 74]),
]
BAR = 4 * BEAT
HOOK_PAD = 1.6
HOOK_ARP = 0.75
HOOK_SUB = 1.0
bars = int(np.ceil(TOTAL / BAR)) + 1
groove_in = start["intro"]
groove_out_lo = start["panel"]
outro = start["outro"]


def full(t):
    return groove_in <= t < TOTAL - 0.2 and not (groove_out_lo <= t < outro)


for b in range(bars):
    t0 = b * BAR
    root, chord = PROG[b % 4]
    if t0 < groove_in:
        # hook: the filter opens bar by bar so it builds toward the intro
        cutoff = 1100 + 1000 * (t0 / max(groove_in - BAR, BAR))
    elif groove_out_lo <= t0 < outro:
        cutoff = 1400
    else:
        cutoff = 2200
    add(music, t0, pad_chord(chord, BAR + 0.3, cutoff), HOOK_PAD if t0 < groove_in else 0.35)
    if t0 < groove_in:
        # hook: a held sub-bass note gives it body before the beat comes in
        add(music, t0, bass_note(root, BAR), HOOK_SUB)
    for s in range(16):
        t = t0 + s * BEAT / 4
        if t >= TOTAL - 0.1:
            break
        beat = s // 4
        sub = s % 4
        # arp: 16ths over the chord, up an octave on the 2nd half of the bar
        if t >= 0.0:
            note = chord[s % 4] + (12 if s >= 8 else 0)
            gain = HOOK_ARP if t < groove_in else 0.26
            add(music, t, pluck(note), gain, pan=-0.35 if s % 2 else 0.35)
            add(music, t + 0.75 * BEAT, pluck(note), gain * 0.35, pan=0.6 if s % 2 else -0.6)
        # hook: soft hats in its last bar lead into the groove
        if groove_in - BAR <= t < groove_in and sub in (1, 3):
            add(drums, t, hat(), 0.12 + 0.18 * (t - (groove_in - BAR)) / BAR, pan=-0.2)
        # the first bar of the groove ramps in instead of dropping in at full level
        ramp = min(1.0, 0.4 + 0.6 * max(0.0, t - groove_in) / BAR)
        if full(t):
            if sub == 0:
                add(drums, t, kick(), 0.9 * ramp)
            if sub == 0 and beat in (1, 3):
                add(drums, t, clap(), 0.6 * ramp)
            if sub == 2:
                add(drums, t, hat(open_=True), 0.5 * ramp, pan=0.2)
                add(music, t, bass_note(root, BEAT / 2 - 0.02), 1.0)
            if sub in (1, 3):
                add(drums, t, hat(), 0.4 * ramp, pan=-0.2)
            if sub == 0:
                add(music, t, bass_note(root, BEAT / 4), 0.8)
        elif groove_out_lo <= t < outro and sub == 0:
            # breakdown in the panel scene: just a soft pulse
            add(drums, t, kick(), 0.35)

# sidechain pump on the music bus from every full-groove kick
pump = np.ones(N)
for b in range(bars * 4):
    t = b * BEAT
    if full(t):
        i = int(t * SR)
        n = int(BEAT * SR)
        depth = 0.55 * min(1.0, 0.3 + 0.7 * max(0.0, t - groove_in) / BAR)
        shape = 1 - depth * np.exp(-np.arange(n) / (0.09 * SR))
        pump[i:i + n] = np.minimum(pump[i:i + n], shape[: N - i])
music *= pump[:, None]
music += drums

# ---- sfx on the video's events (offsets match index.html) ----------------------
for sid in timing["ids"][2:]:
    add(sfx, start[sid] - 0.55, whoosh(0.6), 0.35)
# hook -> intro: a long soft swell instead of a hit, then a gentle low thump and the chime
add(sfx, start["intro"] - 1.6, swell(1.6), 0.45)
add(sfx, start["intro"], kick(), 0.25)
add(sfx, start["intro"] + 0.1, chime([74, 78, 81, 86]), 0.6)
add(sfx, start["hook"] + 1.5, blip(220, 110, 0.25), 0.7)          # "That's overkill."
add(sfx, start["outro"], chime([74, 78, 81, 86, 90]), 0.8)


def typing(at, a, b, chars):
    for k in range(chars):
        add(sfx, at + a + (b - a) * k / chars + RNG.uniform(-0.01, 0.01), tick(), 0.35, pan=RNG.uniform(-0.3, 0.3))


typing(start["simple"], 0.5, 1.6, 23)
add(sfx, start["simple"] + 1.8, thock(), 0.7)
add(sfx, start["simple"] + 2.3, blip(880, 1320), 0.6)                # -> haiku (bright)
typing(start["complex"], 0.2, 1.8, 40)
add(sfx, start["complex"] + 2.0, thock(), 0.7)
add(sfx, start["complex"] + 2.5, blip(330, 660, 0.22), 0.7)          # -> opus (deeper)
add(sfx, start["complex"] + 2.5, impact()[: int(0.6 * SR)], 0.25)
typing(start["follow"], 0.2, 0.8, 9)
add(sfx, start["follow"] + 1.0, thock(), 0.7)
add(sfx, start["follow"] + 1.1, blip(660, 660, 0.12), 0.45)          # kept
add(sfx, start["panel"] + 1.0, thock(), 0.6)                         # click on the arrow
add(sfx, start["panel"] + 1.0, whoosh(0.35, up=True), 0.25)          # panel slides up
add(sfx, start["panel"] + 3.4, thock(), 0.6)                         # click on the switch
add(sfx, start["panel"] + 3.4, blip(660, 220, 0.3), 0.55)            # power-down

# final chord ring-out and fade
end_i = int(TOTAL * SR)
fade = np.ones(N)
fade[end_i - int(1.0 * SR):end_i] = np.linspace(1, 0, int(1.0 * SR))
fade[end_i:] = 0
music *= fade[:, None]
sfx[end_i:] = 0


def save(name, x):
    x = x[:end_i]
    peak = np.max(np.abs(x)) + 1e-9
    wavfile.write(out_dir / name, SR, (x / peak * 0.89).astype(np.float32))


save("synth-music.wav", music)
save("synth-sfx.wav", sfx)
print(f"synth: {BPM} BPM, {TOTAL:.2f}s -> {out_dir}/synth-music.wav, synth-sfx.wav")
