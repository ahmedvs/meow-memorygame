"""Generate original looping chapter themes for Meow Memory Story Mode.

Every sound is synthesised from scratch with numpy: no samples, no external
melodies. The result is a set of warm, soft-fantasy loops that match the game's
royal-lavender identity.
"""
from __future__ import annotations

import math
import subprocess
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve

SR = 44100
DUR = 24.0
N = int(SR * DUR)
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "audio-src"
OUT = ROOT / "assets" / "audio"
SRC.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)


def midi(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def add_note(buf: np.ndarray, start: float, dur: float, freq: float, gain: float,
             kind: str = "piano", pan: float = 0.0) -> None:
    """Add one stereo note. ``buf`` has shape (N, 2)."""
    start_i = max(0, int(start * SR))
    length = max(1, int(dur * SR))
    end_i = min(N, start_i + length)
    if end_i <= start_i:
        return
    t = np.arange(end_i - start_i) / SR
    env = np.ones_like(t)

    if kind == "piano":
        attack, decay = 0.008, 2.2
        env = np.minimum(1.0, t / attack) * np.exp(-t / decay)
        wave = (np.sin(2 * np.pi * freq * t)
                + .42 * np.sin(2 * np.pi * freq * 2.001 * t)
                + .17 * np.sin(2 * np.pi * freq * 3.002 * t)
                + .07 * np.sin(2 * np.pi * freq * 4.01 * t))
        wave *= .55
    elif kind == "epiano":
        attack, decay = 0.012, 1.5
        env = np.minimum(1.0, t / attack) * np.exp(-t / decay)
        wave = np.sin(2 * np.pi * freq * t) + .22 * np.sin(2 * np.pi * freq * 2 * t)
    elif kind == "pluck":
        env = np.minimum(1.0, t / .004) * np.exp(-t / .17)
        wave = (np.sin(2 * np.pi * freq * t)
                + .28 * np.sin(2 * np.pi * freq * 2.01 * t)
                + .09 * np.sin(2 * np.pi * freq * 3.02 * t))
    elif kind == "marimba":
        env = np.minimum(1.0, t / .005) * np.exp(-t / .48)
        wave = np.sin(2 * np.pi * freq * t) + .38 * np.sin(2 * np.pi * freq * 3.97 * t)
    elif kind == "bell":
        env = np.minimum(1.0, t / .01) * np.exp(-t / 1.7)
        wave = (np.sin(2 * np.pi * freq * t)
                + .3 * np.sin(2 * np.pi * freq * 2.72 * t)
                + .12 * np.sin(2 * np.pi * freq * 5.1 * t))
    elif kind == "pad":
        attack, release = .55, 1.1
        env = np.minimum(1.0, t / attack) * np.exp(-np.maximum(0, t - (dur - release)) / release)
        wave = (np.sin(2 * np.pi * freq * t + .15 * np.sin(2 * np.pi * .18 * t))
                + .16 * np.sin(2 * np.pi * freq * 1.004 * t))
    elif kind == "brass":
        env = np.minimum(1.0, t / .09) * np.exp(-np.maximum(0, t - (dur - .28)) / .28)
        wave = sum((1.0 / (h ** 1.4)) * np.sin(2 * np.pi * freq * h * t)
                   for h in range(1, 7))
    elif kind == "cello":
        env = np.minimum(1.0, t / .18) * np.exp(-np.maximum(0, t - (dur - .4)) / .4)
        wave = sum((1.0 / (h ** 1.15)) * np.sin(2 * np.pi * freq * h * t)
                   for h in range(1, 5))
    elif kind == "choir":
        env = np.minimum(1.0, t / .7) * np.exp(-np.maximum(0, t - (dur - .9)) / .9)
        wave = (np.sin(2 * np.pi * freq * t + .2 * np.sin(2 * np.pi * .22 * t))
                + .14 * np.sin(2 * np.pi * freq * 1.006 * t))
    else:
        env = np.exp(-t / max(.08, dur * .35))
        wave = np.sin(2 * np.pi * freq * t)

    # Gentle high-shelf style tilt so the loops stay soft, never neon.
    if kind in ("brass", "cello"):
        wave = np.tanh(wave * .9) * .82

    fade = int(.018 * SR)
    if len(env) > fade * 2:
        env[:fade] *= np.linspace(0, 1, fade)
        env[-fade:] *= np.linspace(1, 0, fade)

    left = np.cos((pan + 1) * math.pi / 4)
    right = np.sin((pan + 1) * math.pi / 4)
    mono = wave * env * gain
    buf[start_i:end_i, 0] += mono * left
    buf[start_i:end_i, 1] += mono * right


def add_noise(buf: np.ndarray, start: float, dur: float, gain: float,
              color: str = "wood", pan: float = 0.0) -> None:
    start_i = max(0, int(start * SR))
    end_i = min(N, start_i + int(dur * SR))
    if end_i <= start_i:
        return
    n = end_i - start_i
    noise = np.random.default_rng(int(start * 1000) + 17).normal(0, 1, n)
    t = np.arange(n) / SR
    if color == "wood":
        noise = noise * np.exp(-t / .035)
        noise = np.convolve(noise, [.4, .6], mode="same")
    elif color == "timpani":
        noise = noise * np.exp(-t / .09)
    else:
        noise = noise * np.exp(-t / .03)
    left = np.cos((pan + 1) * math.pi / 4)
    right = np.sin((pan + 1) * math.pi / 4)
    buf[start_i:end_i, 0] += noise * gain * left
    buf[start_i:end_i, 1] += noise * gain * right


def add_timpani(buf: np.ndarray, start: float, freq: float, gain: float) -> None:
    start_i = max(0, int(start * SR))
    end_i = min(N, start_i + int(.7 * SR))
    if end_i <= start_i:
        return
    t = np.arange(end_i - start_i) / SR
    env = np.minimum(1.0, t / .006) * np.exp(-t / .25)
    pitch = freq * (1 + .12 * np.exp(-t / .06))
    wave = np.sin(2 * np.pi * np.cumsum(pitch) / SR)
    mono = wave * env * gain
    buf[start_i:end_i, 0] += mono * .8
    buf[start_i:end_i, 1] += mono * .8
    add_noise(buf, start, .18, gain * .38, "timpani")


def chord(buf: np.ndarray, start: float, dur: float, notes: list[int],
          gain: float, kind: str = "piano", spread: float = 0.0) -> None:
    for i, note in enumerate(notes):
        pan = (-.35 if i % 2 == 0 else .35) * (1 if spread else 0)
        add_note(buf, start + i * spread, dur, midi(note), gain, kind, pan)


def reverb(buf: np.ndarray, amount: float = .22) -> np.ndarray:
    rng = np.random.default_rng(7123)
    length = int(SR * 1.15)
    ir = rng.normal(0, 1, length) * np.exp(-np.arange(length) / (SR * .29))
    ir[:int(SR * .018)] = 0
    ir /= np.max(np.abs(ir)) + 1e-9
    wet = np.stack([fftconvolve(buf[:, c], ir, mode="full")[:N] for c in range(2)], axis=1)
    return buf * .86 + wet * amount


def finish(buf: np.ndarray) -> np.ndarray:
    buf = reverb(buf)
    # Short loop seams: tiny fade only, no audible gap.
    edge = int(.08 * SR)
    buf[:edge] *= np.linspace(0, 1, edge)[:, None]
    buf[-edge:] *= np.linspace(1, 0, edge)[:, None]
    peak = np.max(np.abs(buf))
    if peak > .9:
        buf = buf * (.9 / peak)
    return buf


def theme_intro() -> np.ndarray:
    b = np.zeros((N, 2), dtype=np.float64)
    chords = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 59],
              [48, 55, 59, 64], [41, 48, 52, 57]]
    for i, notes in enumerate(chords):
        start = i * 4.0
        chord(b, start, 3.8, notes, .055, "piano", .012)
        chord(b, start, 3.9, [notes[0] - 12, notes[1] - 12], .032, "pad", .02)
        # Soft upper arpeggio.
        for j, note in enumerate([notes[2] + 12, notes[3] + 12, notes[1] + 12, notes[2] + 12]):
            add_note(b, start + .45 + j * .62, 1.35, midi(note), .027, "piano", -.18 + j * .12)
    melody = [72, 76, 79, 76, 74, 72, 69, 72, 77, 79, 76, 72, 69, 67, 69, 72]
    for i, note in enumerate(melody):
        add_note(b, .7 + i * 1.45, 1.55, midi(note), .023, "piano", .1)
    return finish(b)


def theme_zaatar() -> np.ndarray:
    b = np.zeros((N, 2), dtype=np.float64)
    bass = [38, 45, 41, 43, 38, 45, 41, 43]
    for i, note in enumerate(bass):
        start = i * 3.0
        add_note(b, start, .64, midi(note), .105, "pluck", .05)
        add_note(b, start + 1.5, .42, midi(note + 7), .065, "pluck", -.12)
    melody = [62, 65, 69, 65, 62, 65, 67, 69, 74, 72, 69, 67, 65, 62, 60, 62,
              65, 69, 72, 74, 72, 69, 67, 65, 62, 65, 67, 69, 65, 62, 60, 62]
    for i, note in enumerate(melody):
        add_note(b, .2 + i * .72, .3, midi(note + 12), .048, "pluck", -.2 + (i % 2) * .4)
    for i in range(8):
        add_noise(b, .05 + i * 3.0, .07, .018, "wood", .25)
        add_noise(b, 1.55 + i * 3.0, .06, .014, "wood", -.25)
    for i in range(4):
        chord(b, i * 6.0, 2.9, [50, 53, 57], .018, "pad", .03)
    return finish(b)


def theme_luz() -> np.ndarray:
    b = np.zeros((N, 2), dtype=np.float64)
    chords = [[41, 48, 52, 55], [38, 45, 48, 52], [36, 43, 48, 52], [43, 50, 55, 58]]
    for i in range(6):
        start = i * 4.0
        notes = chords[i % len(chords)]
        chord(b, start, 3.8, notes, .042, "epiano", .02)
        chord(b, start + .08, 3.7, [notes[0] - 12, notes[2]], .023, "pad", .03)
    melody = [77, 79, 76, 72, 74, 76, 72, 69, 72, 76, 79, 77, 76, 74, 72, 69]
    for i, note in enumerate(melody):
        add_note(b, 1.1 + i * 1.4, 1.8, midi(note), .022, "bell", .26 if i % 2 else -.24)
    for i in range(4):
        add_note(b, 2.0 + i * 5.6, 2.4, midi(84), .012, "bell", .1)
    return finish(b)


def theme_mishmish() -> np.ndarray:
    b = np.zeros((N, 2), dtype=np.float64)
    bass = [45, 52, 41, 43, 45, 52, 43, 41]
    for i, note in enumerate(bass):
        start = i * 2.8
        add_note(b, start, .42, midi(note), .11, "pluck", .02)
        add_note(b, start + .7, .22, midi(note + 12), .05, "marimba", -.2)
        add_note(b, start + 1.4, .22, midi(note + 7), .045, "marimba", .2)
    melody = [69, 72, 76, 72, 74, 76, 79, 76, 72, 69, 67, 69, 72, 74, 76, 79,
              81, 79, 76, 74, 72, 69, 67, 69, 72, 76, 74, 72, 69, 67, 65, 69]
    for i, note in enumerate(melody):
        add_note(b, .12 + i * .7, .34, midi(note), .05, "marimba", -.3 + (i % 2) * .6)
    for i in range(8):
        add_noise(b, .05 + i * 2.8, .06, .022, "wood", .3)
        add_noise(b, 1.35 + i * 2.8, .06, .017, "wood", -.3)
    for i in range(4):
        add_timpani(b, i * 5.6, midi(33), .055)
    return finish(b)


def theme_zill() -> np.ndarray:
    b = np.zeros((N, 2), dtype=np.float64)
    t = np.arange(N) / SR
    # Low, breathing drone.
    for freq, gain in [(midi(26), .065), (midi(38), .026), (midi(39), .022)]:
        lfo = .8 + .2 * np.sin(2 * np.pi * .07 * t)
        b[:, 0] += np.sin(2 * np.pi * freq * t) * gain * lfo
        b[:, 1] += np.sin(2 * np.pi * freq * 1.003 * t) * gain * lfo
    chord(b, 0, 23.5, [50, 53, 56], .018, "pad", .03)
    for i, note in enumerate([74, 77, 80, 77, 75, 72, 68, 72]):
        add_note(b, 1.2 + i * 2.85, 1.8, midi(note), .032, "bell", -.4 if i % 2 else .4)
    for i in range(5):
        add_timpani(b, 1.8 + i * 5.2, midi(31), .035)
    for i in range(3):
        add_noise(b, 4.0 + i * 7.4, .9, .009, "air", .0)
    return finish(b)


def theme_bundoq() -> np.ndarray:
    b = np.zeros((N, 2), dtype=np.float64)
    bass = [36, 43, 44, 39, 36, 43, 41, 43]
    for i, note in enumerate(bass):
        start = i * 3.0
        add_note(b, start, .48, midi(note), .095, "pluck", .05)
        add_note(b, start + .75, .3, midi(note + 7), .042, "marimba", -.16)
        add_note(b, start + 1.5, .3, midi(note + 12), .038, "marimba", .16)
    melody = [72, 75, 79, 75, 72, 68, 72, 75, 77, 79, 82, 79, 77, 75, 72, 68]
    for i, note in enumerate(melody):
        add_note(b, .55 + i * 1.42, .8, midi(note), .035, "marimba", .24 if i % 2 else -.24)
    for i in range(4):
        chord(b, i * 6.0, 5.7, [48, 51, 55, 58], .018, "brass", .03)
    for i in range(3):
        add_timpani(b, .1 + i * 7.1, midi(36), .028)
    return finish(b)


def theme_final() -> np.ndarray:
    b = np.zeros((N, 2), dtype=np.float64)
    # Driving low strings.
    seq = [38, 38, 50, 50, 36, 36, 43, 43, 38, 38, 50, 50, 41, 41, 45, 45]
    for i, note in enumerate(seq):
        start = i * 1.5
        add_note(b, start, 1.28, midi(note), .09, "cello", .02)
        add_note(b, start, 1.12, midi(note + 12), .028, "cello", -.28)
    brass_chords = [[50, 53, 57, 62], [46, 50, 53, 58], [48, 52, 55, 60], [45, 50, 53, 57],
                    [50, 53, 57, 62], [46, 50, 53, 58], [48, 52, 55, 60], [45, 50, 53, 57]]
    for i, notes in enumerate(brass_chords):
        start = i * 3.0
        chord(b, start, 2.75, notes, .038, "brass", .01)
        chord(b, start, 2.9, [notes[0] + 12, notes[2] + 12], .017, "choir", .03)
    melody = [74, 77, 81, 77, 74, 72, 70, 72, 74, 77, 79, 81, 79, 77, 74, 72]
    for i, note in enumerate(melody):
        add_note(b, .35 + i * 1.5, 1.2, midi(note), .036, "brass", .22 if i % 2 else -.22)
    for i in range(16):
        add_timpani(b, i * 1.5, midi(36 if i % 4 else 31), .038)
    for i in range(8):
        add_noise(b, i * 3.0 + .02, .16, .016, "timpani", .0)
    return finish(b)


THEMES = {
    "story-intro": theme_intro,
    "story-zaatar": theme_zaatar,
    "story-luz": theme_luz,
    "story-mishmish": theme_mishmish,
    "story-zill": theme_zill,
    "story-bundoq": theme_bundoq,
    "story-final": theme_final,
}


def main() -> None:
    for name, builder in THEMES.items():
        print(f"rendering {name}…", flush=True)
        audio = builder()
        wav_path = SRC / f"{name}.wav"
        wavfile.write(str(wav_path), SR, (np.clip(audio, -1, 1) * 32767).astype(np.int16))
        mp3_path = OUT / f"{name}.mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path),
             "-codec:a", "libmp3lame", "-b:a", "144k", "-ar", "44100", str(mp3_path)],
            check=True,
        )
        print(f"  wrote {mp3_path.relative_to(ROOT)} ({mp3_path.stat().st_size / 1024:.0f} KB)")
    print("done")


if __name__ == "__main__":
    main()
