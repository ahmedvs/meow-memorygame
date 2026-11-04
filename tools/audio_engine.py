"""Original audio synthesis engine for Meow Memory.

Everything in the game soundtrack is generated from code with numpy/scipy.
No samples, loops, MIDI files, or downloaded music are used.  The only network
input is the edge-tts narration for the trailer (cached under tools/audio-src).

The module intentionally contains no composition decisions: generate_audio.py
uses these primitives to build the menu loop, battle loop, and trailer.
"""
from __future__ import annotations

import math
import re
import subprocess
import wave
from functools import lru_cache
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from scipy import signal

SR = 48_000
TWOPI = 2.0 * np.pi
EPS = 1e-12

NOTE_RE = re.compile(r"^([A-Ga-g])([#b]?)(-?\d+)$")
_SEMITONES = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


# ---------------------------------------------------------------------------
# Notes, levels, timing
# ---------------------------------------------------------------------------
def midi_name(name: str) -> int:
    """Convert a note such as D4, Bb2 or C#5 to a MIDI number."""
    match = NOTE_RE.match(name.strip())
    if not match:
        raise ValueError(f"Bad note name: {name!r}")
    letter, accidental, octave = match.groups()
    value = 12 * (int(octave) + 1) + _SEMITONES[letter.upper()]
    value += {"#": 1, "b": -1, "": 0}[accidental]
    return value


def hz(note: str | int | float) -> float:
    """Frequency in Hz for a note name or MIDI number."""
    if isinstance(note, str):
        note = midi_name(note)
    return 440.0 * (2.0 ** ((float(note) - 69.0) / 12.0))


def db_to_gain(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def gain_to_db(gain: float) -> float:
    return 20.0 * math.log10(max(float(gain), EPS))


def pan_gains(pan: float) -> tuple[float, float]:
    """Constant-power pan for pan in [-1, 1]."""
    pan = float(np.clip(pan, -1.0, 1.0))
    angle = (pan + 1.0) * math.pi / 4.0
    return math.cos(angle), math.sin(angle)


def ensure_stereo(x: np.ndarray) -> np.ndarray:
    if x.ndim == 1:
        return np.stack([x, x], axis=0)
    if x.ndim == 2 and x.shape[0] == 2:
        return x
    if x.ndim == 2 and x.shape[1] == 2:
        return x.T
    raise ValueError(f"Unsupported audio shape {x.shape}")


def as_mono(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x)
    if x.ndim == 1:
        return x
    return np.mean(x, axis=0)


def human_velocity(rng: np.random.Generator, low: float = 0.84, high: float = 1.0) -> float:
    return float(rng.uniform(low, high))


# ---------------------------------------------------------------------------
# Filters and envelopes
# ---------------------------------------------------------------------------
def _sos(kind: str, freq: float, order: int = 2, fs: int = SR) -> np.ndarray:
    freq = float(np.clip(freq, 10.0, fs * 0.49))
    return signal.butter(order, freq, btype=kind, fs=fs, output="sos")


@lru_cache(maxsize=512)
def _sos_cached(kind: str, freq: float, order: int) -> np.ndarray:
    return _sos(kind, freq, order)


def filt(x: np.ndarray, kind: str, freq: float, order: int = 2) -> np.ndarray:
    """Causal Butterworth highpass/lowpass along the last axis."""
    return signal.sosfilt(_sos_cached(kind, float(freq), int(order)), x, axis=-1)


def bell_biquad(freq: float, gain_db: float, q: float = 1.0, fs: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """RBJ peaking EQ."""
    a_gain = 10.0 ** (gain_db / 40.0)
    w0 = TWOPI * float(np.clip(freq, 10, fs * 0.49)) / fs
    alpha = math.sin(w0) / (2.0 * q)
    cw = math.cos(w0)
    b = np.array([1 + alpha * a_gain, -2 * cw, 1 - alpha * a_gain])
    a = np.array([1 + alpha / a_gain, -2 * cw, 1 - alpha / a_gain])
    return b / a[0], a / a[0]


def low_shelf(freq: float, gain_db: float, slope: float = 0.9, fs: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """RBJ low shelf."""
    a_gain = 10.0 ** (gain_db / 40.0)
    w0 = TWOPI * freq / fs
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / 2.0 * math.sqrt((a_gain + 1 / a_gain) * (1 / slope - 1) + 2)
    two_sqrt_a_alpha = 2.0 * math.sqrt(a_gain) * alpha
    b = np.array([
        a_gain * ((a_gain + 1) - (a_gain - 1) * cw + two_sqrt_a_alpha),
        2 * a_gain * ((a_gain - 1) - (a_gain + 1) * cw),
        a_gain * ((a_gain + 1) - (a_gain - 1) * cw - two_sqrt_a_alpha),
    ])
    a = np.array([
        (a_gain + 1) + (a_gain - 1) * cw + two_sqrt_a_alpha,
        -2 * ((a_gain - 1) + (a_gain + 1) * cw),
        (a_gain + 1) + (a_gain - 1) * cw - two_sqrt_a_alpha,
    ])
    return b / a[0], a / a[0]


def high_shelf(freq: float, gain_db: float, slope: float = 0.9, fs: int = SR) -> tuple[np.ndarray, np.ndarray]:
    """RBJ high shelf."""
    a_gain = 10.0 ** (gain_db / 40.0)
    w0 = TWOPI * freq / fs
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / 2.0 * math.sqrt((a_gain + 1 / a_gain) * (1 / slope - 1) + 2)
    two_sqrt_a_alpha = 2.0 * math.sqrt(a_gain) * alpha
    b = np.array([
        a_gain * ((a_gain + 1) + (a_gain - 1) * cw + two_sqrt_a_alpha),
        -2 * a_gain * ((a_gain - 1) + (a_gain + 1) * cw),
        a_gain * ((a_gain + 1) + (a_gain - 1) * cw - two_sqrt_a_alpha),
    ])
    a = np.array([
        (a_gain + 1) - (a_gain - 1) * cw + two_sqrt_a_alpha,
        2 * ((a_gain - 1) - (a_gain + 1) * cw),
        (a_gain + 1) - (a_gain - 1) * cw - two_sqrt_a_alpha,
    ])
    return b / a[0], a / a[0]


def eq_chain(x: np.ndarray, biquads: Sequence[tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
    y = np.asarray(x, dtype=np.float64)
    for b, a in biquads:
        y = signal.lfilter(b, a, y, axis=-1)
    return y


def _smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def fade_edges(x: np.ndarray, fade_in: int = 0, fade_out: int = 0) -> np.ndarray:
    """Apply raised-cosine edge fades, returning a copy."""
    y = x.copy()
    if x.ndim == 1:
        if fade_in > 0:
            n = min(fade_in, y.shape[-1])
            y[:n] *= 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, n, endpoint=False))
        if fade_out > 0:
            n = min(fade_out, y.shape[-1])
            y[-n:] *= 0.5 + 0.5 * np.cos(np.linspace(0, math.pi, n, endpoint=False))
    else:
        if fade_in > 0:
            n = min(fade_in, y.shape[-1])
            shape = 0.5 - 0.5 * np.cos(np.linspace(0, math.pi, n, endpoint=False))
            y[:, :n] *= shape
        if fade_out > 0:
            n = min(fade_out, y.shape[-1])
            shape = 0.5 + 0.5 * np.cos(np.linspace(0, math.pi, n, endpoint=False))
            y[:, -n:] *= shape
    return y


def env_ar(n: int, attack_s: float, release_s: float, fs: int = SR) -> np.ndarray:
    """Raised-cosine attack/sustain/release envelope."""
    env = np.ones(n)
    na = min(n, max(1, int(attack_s * fs)))
    nr = min(n, max(1, int(release_s * fs)))
    if na:
        env[:na] *= np.sin(np.linspace(0, math.pi / 2, na, endpoint=True)) ** 2
    if nr:
        env[-nr:] *= np.cos(np.linspace(0, math.pi / 2, nr, endpoint=True)) ** 2
    if na + nr > n:
        env = np.maximum(env, 1e-6)
    return env


def exp_env(n: int, decay_s: float, attack_s: float = 0.002, fs: int = SR) -> np.ndarray:
    t = np.arange(n, dtype=np.float64) / fs
    attack = 1.0 - np.exp(-t / max(attack_s, 1e-5))
    return attack * np.exp(-t / max(decay_s, 1e-5))


def noise_band(n: int, low: float | None, high: float | None, seed: int, order: int = 2) -> np.ndarray:
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(n)
    if low is not None:
        x = filt(x, "highpass", low, order)
    if high is not None:
        x = filt(x, "lowpass", high, order)
    return x


def normalize_peak(x: np.ndarray, peak: float = 1.0) -> np.ndarray:
    m = float(np.max(np.abs(x))) if x.size else 0.0
    if m < EPS:
        return x
    return x * (peak / m)


def soft_clip(x: np.ndarray, drive: float = 1.4, ceiling: float = 1.0) -> np.ndarray:
    """Gentle musical saturation that preserves relative dynamics."""
    driven = np.tanh(x * drive) / math.tanh(drive)
    return driven * ceiling


def fft_convolve_stereo(x: np.ndarray, ir: np.ndarray) -> np.ndarray:
    """Convolve stereo channels with a stereo IR using overlap-free FFT."""
    x = ensure_stereo(np.asarray(x, dtype=np.float64))
    ir = ensure_stereo(np.asarray(ir, dtype=np.float64))
    out = np.empty((2, x.shape[1] + ir.shape[1] - 1), dtype=np.float64)
    for c in range(2):
        out[c] = signal.fftconvolve(x[c], ir[c], mode="full")
    return out


# ---------------------------------------------------------------------------
# Wavetable oscillators
# ---------------------------------------------------------------------------
_TABLE_SIZE = 4096
_TABLE_CACHE: dict[tuple[str, int], np.ndarray] = {}


def _wave_table(kind: str, n_harm: int) -> np.ndarray:
    key = (kind, int(n_harm))
    cached = _TABLE_CACHE.get(key)
    if cached is not None:
        return cached
    n_harm = max(1, int(n_harm))
    phase = np.arange(_TABLE_SIZE, dtype=np.float64) * TWOPI / _TABLE_SIZE
    out = np.zeros(_TABLE_SIZE, dtype=np.float64)
    if kind == "saw":
        for h in range(1, n_harm + 1):
            out += np.sin(phase * h) / h
    elif kind == "warm":
        # Soft, slightly hollow saw.  The low-pass style spectral tilt keeps the
        # pad expensive-sounding instead of buzzy.
        for h in range(1, n_harm + 1):
            out += np.sin(phase * h) * (0.78 ** (h - 1)) / (h ** 1.22)
    elif kind == "string":
        for h in range(1, n_harm + 1):
            amp = (1.0 / h) * (0.94 ** (h - 1)) * (1.0 + 0.12 * math.sin(h * 0.7))
            out += np.sin(phase * h + 0.15 * h) * amp
    elif kind == "triangle":
        for h in range(1, n_harm + 1, 2):
            out += np.sin(phase * h) * ((-1.0) ** ((h - 1) // 2)) / (h * h)
    elif kind == "softsquare":
        for h in range(1, n_harm + 1, 2):
            out += np.sin(phase * h) / (h ** 1.35)
    else:
        raise ValueError(kind)
    m = float(np.max(np.abs(out))) or 1.0
    out = out / m
    _TABLE_CACHE[key] = out
    return out


def _table_for(freq: float, limit_hz: float, kind: str) -> tuple[np.ndarray, int]:
    n_harm = int(min(72, max(1, math.floor(limit_hz / max(freq, 1e-6)))))
    return _wave_table(kind, n_harm), n_harm


def wt_osc(
    freq: float | np.ndarray,
    n: int,
    kind: str = "warm",
    phase: float = 0.0,
    limit_hz: float = 10_000.0,
    fs: int = SR,
) -> np.ndarray:
    """Band-limited wavetable oscillator. Frequency can vary per sample."""
    base_freq = float(np.max(freq)) if isinstance(freq, np.ndarray) else float(freq)
    if isinstance(freq, np.ndarray):
        base_freq = float(np.min(freq))
    table, _ = _table_for(base_freq, limit_hz, kind)
    if isinstance(freq, np.ndarray):
        cycles = phase / TWOPI + np.cumsum(freq, dtype=np.float64) / fs
    else:
        cycles = phase / TWOPI + np.arange(n, dtype=np.float64) * (float(freq) / fs)
    pos = (cycles % 1.0) * len(table)
    i0 = np.floor(pos).astype(np.int64)
    frac = pos - i0
    out = table[i0 % len(table)] * (1.0 - frac) + table[(i0 + 1) % len(table)] * frac
    return out


def additive_pluck(
    freq: float,
    duration: float,
    *,
    brightness: float = 0.7,
    decay: float = 1.5,
    attack: float = 0.0025,
    fs: int = SR,
    seed: int = 0,
    body: float = 0.35,
    detune_cents: float = 0.0,
    tone: str = "harp",
) -> np.ndarray:
    """Additive plucked string with per-partial damping and a pick transient."""
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    f = float(freq) * (2.0 ** (detune_cents / 1200.0))
    max_h = int(min(36, max(1, (fs * 0.45) / max(f, 1.0))))
    # Slight inharmonicity makes the attack read as a real string.
    inharm = 2.8e-5 if tone == "harp" else 5.5e-5
    out = np.zeros(n, dtype=np.float64)
    for h in range(1, max_h + 1):
        fh = f * h * math.sqrt(1.0 + inharm * h * h)
        if fh >= fs * 0.46:
            break
        # Pluck-position comb + spectral slope.
        position = 0.19 if tone == "harp" else 0.27
        comb = 0.62 + 0.38 * abs(math.sin(math.pi * h * position))
        partial_amp = (comb / (h ** brightness))
        partial_decay = max(decay / (1.0 + 0.23 * (h - 1) ** 1.12), 1e-4)
        out += partial_amp * np.exp(-t / partial_decay) * np.sin(
            TWOPI * fh * t + h * 0.37
        )
    # Pick/pluck noise, very brief.
    rng = np.random.default_rng(seed)
    pick = noise_band(n, 1500.0, 6500.0, seed + 11, order=2)
    pick *= np.exp(-t / 0.0065)
    out += pick * (0.055 if tone == "harp" else 0.035)
    # Low body resonance.
    if body > 0:
        b1, a1 = bell_biquad(210 if tone == "harp" else 260, 2.0 * body, q=1.6)
        out = signal.lfilter(b1, a1, out)
        b2, a2 = bell_biquad(520 if tone == "harp" else 430, 1.2 * body, q=1.2)
        out = signal.lfilter(b2, a2, out)
    out *= 1.0 - np.exp(-t / max(attack, 1e-5))
    # Guarantee no truncated click at the tail.
    tail = min(n, int(0.06 * fs))
    out[-tail:] *= np.linspace(1.0, 0.0, tail)
    return normalize_peak(out)


def bell_note(
    freq: float,
    duration: float = 2.2,
    *,
    fs: int = SR,
    shimmer: float = 0.45,
    seed: int = 0,
) -> np.ndarray:
    """Celesta/glass bell: mostly harmonic, with a short metallic strike."""
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    ratios = (1.0, 2.001, 2.89, 4.11, 5.43, 7.02)
    amps = (1.0, 0.26, 0.11, 0.065, 0.035, 0.014)
    decays = (1.55, 1.0, 0.64, 0.42, 0.29, 0.18)
    out = np.zeros(n, dtype=np.float64)
    for amp, ratio, dec in zip(amps, ratios, decays):
        if freq * ratio > fs * 0.46:
            break
        env = np.exp(-t / dec) * (1.0 - np.exp(-t / 0.0015))
        out += amp * env * np.sin(TWOPI * freq * ratio * t + ratio)
    # Airy strike partial and a subdued noise tinkle.
    out += shimmer * 0.055 * np.exp(-t / 0.06) * np.sin(TWOPI * freq * 9.17 * t + 0.8)
    rng = np.random.default_rng(seed)
    tink = noise_band(n, 2500, 11000, seed + 7, order=2) * np.exp(-t / 0.018)
    out += tink * 0.018
    out *= 0.5 - 0.5 * np.cos(np.minimum(t / 0.002, 1.0) * math.pi)
    tail = min(n, int(0.05 * fs))
    out[-tail:] *= np.linspace(1.0, 0.0, tail)
    return normalize_peak(out)


def piano_note(
    freq: float,
    duration: float = 3.0,
    *,
    fs: int = SR,
    seed: int = 0,
) -> np.ndarray:
    """Felt-piano-like additive tone for the dedication and end card."""
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    out = np.zeros(n, dtype=np.float64)
    # Piano bass strings need more inharmonicity than the treble.
    inharm = 0.00022 if freq < 200 else 0.00009
    max_h = int(min(40, max(1, fs * 0.44 / freq)))
    for h in range(1, max_h + 1):
        fh = freq * h * math.sqrt(1.0 + inharm * h * h)
        if fh > fs * 0.45:
            break
        amp = 1.0 / (h ** 1.25)
        env = np.exp(-t / (2.2 / (1.0 + 0.42 * (h - 1)))) * (1.0 - np.exp(-t / 0.003))
        # A very quiet detuned unison string.
        out += amp * env * (np.sin(TWOPI * fh * t + 0.2 * h) + 0.23 * np.sin(TWOPI * fh * 1.0008 * t + 0.9))
    hammer = noise_band(n, 500, 4200, seed + 3, order=2) * np.exp(-t / 0.009)
    out += hammer * 0.04
    b, a = bell_biquad(160, 1.2, 0.9)
    out = signal.lfilter(b, a, out)
    out *= 1.0 - np.exp(-t / 0.0018)
    tail = min(n, max(1, int(0.12 * fs)))
    out[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(out)


# ---------------------------------------------------------------------------
# Pads, strings, bass
# ---------------------------------------------------------------------------
def pad_chord(
    notes: Iterable[str | int],
    duration: float,
    *,
    amp: float = 1.0,
    attack: float = 0.65,
    release: float = 1.4,
    cutoff: float = 2600.0,
    detune_cents: float = 7.0,
    spread: float = 0.82,
    shimmer: float = 0.0,
    fs: int = SR,
    seed: int = 0,
) -> np.ndarray:
    """Warm, slowly moving detuned pad. Returns stereo peak-normalised to amp."""
    n = max(8, int(duration * fs))
    out = np.zeros((2, n), dtype=np.float64)
    rng = np.random.default_rng(seed)
    t = np.arange(n, dtype=np.float64) / fs
    env = env_ar(n, attack, release, fs)
    notes = tuple(notes)
    # Slow filter/amp movement gives life without audible LFO wobble.
    breathe = 1.0 + 0.035 * np.sin(TWOPI * 0.085 * t + rng.uniform(0, TWOPI))
    for idx, note in enumerate(notes):
        f = hz(note)
        for v, (cents, pan) in enumerate(
            ((-detune_cents, -spread), (0.0, 0.0), (detune_cents, spread))
        ):
            phase = rng.uniform(0, TWOPI)
            vib_rate = 0.10 + 0.018 * v
            vib = 1.0 + 0.0009 * np.sin(TWOPI * vib_rate * t + idx + v)
            osc = wt_osc(f * (2 ** (cents / 1200)) * vib, n, "warm", phase, limit_hz=7000)
            gl, gr = pan_gains(pan * (0.8 + 0.1 * idx))
            voice = osc * env * breathe * (0.42 if v != 1 else 0.5)
            out[0] += voice * gl
            out[1] += voice * gr
    # Subdued octave air that makes the pad feel wide rather than loud.
    hi_note = hz(notes[-1]) * 2.0
    if hi_note < 1600 and shimmer > 0:
        air = wt_osc(hi_note * 1.003, n, "triangle", rng.uniform(0, 6.28), limit_hz=8000)
        air *= env * shimmer
        out[0] += air * 0.4
        out[1] += air * 0.3
    out = filt(out, "highpass", 105.0, 2)
    out = filt(out, "lowpass", cutoff, 2)
    # Very gentle stereo width and de-mud.
    b, a = bell_biquad(330, -1.6, 1.0)
    out = signal.lfilter(b, a, out, axis=-1)
    return normalize_peak(out, amp)


def string_ensemble(
    notes: Iterable[str | int],
    duration: float,
    *,
    amp: float = 1.0,
    attack: float = 0.45,
    release: float = 1.0,
    cutoff: float = 4800.0,
    fs: int = SR,
    seed: int = 0,
) -> np.ndarray:
    """Warm cinematic string section built from four detuned bowed voices."""
    n = max(8, int(duration * fs))
    out = np.zeros((2, n), dtype=np.float64)
    t = np.arange(n, dtype=np.float64) / fs
    env = env_ar(n, attack, release, fs)
    rng = np.random.default_rng(seed)
    for idx, note in enumerate(notes):
        f = hz(note)
        for v, cents in enumerate((-11.0, -4.5, 4.0, 12.0)):
            vib_depth = 0.0029 + 0.0006 * v
            vib_rate = 4.4 + 0.35 * v + rng.uniform(-0.1, 0.1)
            vib = 1.0 + vib_depth * np.sin(TWOPI * vib_rate * t + rng.uniform(0, TWOPI))
            osc = wt_osc(f * (2 ** (cents / 1200)) * vib, n, "string", rng.uniform(0, TWOPI), limit_hz=9500)
            # Bow noise is only in the first few ms of the note, not a sample.
            bow = noise_band(n, 1200, 7000, seed + idx * 7 + v, 2) * np.exp(-t / 0.035) * 0.008
            pan = (-0.75, -0.25, 0.3, 0.78)[v]
            gl, gr = pan_gains(pan)
            voice = (osc + bow) * env
            out[0] += voice * gl
            out[1] += voice * gr
    out = filt(out, "highpass", 125, 2)
    out = filt(out, "lowpass", cutoff, 2)
    out += 0.08 * np.roll(out, 19, axis=1)  # broad, not phasey section width
    return normalize_peak(out, amp)


def sub_bass(
    freq: float,
    duration: float,
    *,
    amp: float = 1.0,
    attack: float = 0.012,
    release: float = 0.14,
    drive: float = 1.2,
    fm: int = SR,
) -> np.ndarray:
    """Rounded mono-ish sub bass. Avoids square-wave mud."""
    n = max(8, int(duration * fm))
    t = np.arange(n, dtype=np.float64) / fm
    env = env_ar(n, attack, release, fm)
    # Short pitch/level bloom on the front gives weight without boom.
    pitch = 1.0 + 0.013 * np.exp(-t / 0.035)
    phase = TWOPI * freq * np.cumsum(pitch) / fm
    fundamental = np.sin(phase)
    octave = 0.16 * np.sin(phase * 2.0 + 0.25)
    fifth = 0.07 * np.sin(phase * 3.0 + 0.8)
    x = (fundamental + octave + fifth) * env
    b, a = bell_biquad(520, -2.0, 0.9)
    x = signal.lfilter(b, a, x)
    x = soft_clip(x * drive, drive=1.35, ceiling=0.92)
    tail = min(n, max(1, int(0.04 * fm)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


def pluck_bass(
    freq: float,
    duration: float,
    *,
    amp: float = 1.0,
    fs: int = SR,
    seed: int = 0,
) -> np.ndarray:
    """Muted round bass pluck layered under the sub for small speakers."""
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    env = (1.0 - np.exp(-t / 0.004)) * np.exp(-t / 0.34)
    pitch = 1.0 + 0.02 * np.exp(-t / 0.018)
    phase = TWOPI * freq * np.cumsum(pitch) / fs
    x = np.sin(phase) + 0.35 * np.sin(phase * 2.0) + 0.11 * np.sin(phase * 3.0)
    click = noise_band(n, 900, 5000, seed, 2) * np.exp(-t / 0.006) * 0.03
    x = (x + click) * env
    x = filt(x, "lowpass", 850, 2)
    tail = min(n, max(1, int(0.025 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


# ---------------------------------------------------------------------------
# Percussion and sound design
# ---------------------------------------------------------------------------
def kick(
    duration: float = 0.48,
    *,
    amp: float = 1.0,
    punch: float = 1.0,
    low_hz: float = 48.0,
    high_hz: float = 145.0,
    decay_s: float = 0.17,
    seed: int = 1,
    fs: int = SR,
) -> np.ndarray:
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    freq = low_hz + (high_hz - low_hz) * np.exp(-t / (0.022 + 0.01 * punch))
    phase = TWOPI * np.cumsum(freq) / fs
    body = np.sin(phase) * np.exp(-t / decay_s)
    body += 0.20 * np.sin(phase * 2.03 + 0.5) * np.exp(-t / (decay_s * 0.55))
    click = noise_band(n, 1600, 9000, seed + 1, 2) * np.exp(-t / 0.0035) * (0.08 * punch)
    beater = np.sin(TWOPI * 900 * t) * np.exp(-t / 0.004) * (0.05 * punch)
    x = body + click + beater
    x = filt(x, "lowpass", 5200, 2)
    x = soft_clip(x * 1.28, drive=1.25, ceiling=0.96)
    tail = min(n, max(1, int(0.03 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


def heartbeat(amp: float = 1.0, *, fs: int = SR) -> np.ndarray:
    """A deep, soft lub-dub for the trailer's intimate moments."""
    lub = kick(0.35, amp=1.0, punch=0.55, low_hz=43, high_hz=78, decay_s=0.18, fs=fs)
    n_lub = lub.size
    total = int(0.72 * fs)
    out = np.zeros(total)
    out[:n_lub] += lub
    dub = kick(0.30, amp=0.66, punch=0.40, low_hz=40, high_hz=68, decay_s=0.15, seed=5, fs=fs)
    start = int(0.20 * fs)
    out[start : start + dub.size] += dub[: max(0, min(dub.size, total - start))]
    out = filt(out, "lowpass", 420, 2)
    return normalize_peak(out, amp)


def shaker(duration: float = 0.11, *, amp: float = 1.0, seed: int = 2, fs: int = SR) -> np.ndarray:
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    rng = np.random.default_rng(seed)
    x = rng.standard_normal(n)
    x = filt(x, "highpass", 4800, 2)
    x = filt(x, "highpass", 7000, 1)
    env = (1.0 - np.exp(-t / 0.003)) * np.exp(-t / 0.036)
    # Tiny second grain gives the "ch-ch" feel.
    env += 0.13 * np.exp(-((t - 0.017) ** 2) / (2 * 0.004 ** 2))
    out = x * env
    tail = min(n, max(1, int(0.018 * fs)))
    out[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(out, amp)


def brushed_darbuka_dum(duration: float = 0.36, *, amp: float = 1.0, seed: int = 3, fs: int = SR) -> np.ndarray:
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    freq = 95.0 + 42.0 * np.exp(-t / 0.035)
    phase = TWOPI * np.cumsum(freq) / fs
    body = np.sin(phase) * np.exp(-t / 0.13) * 0.9
    body += 0.26 * np.sin(phase * 1.51) * np.exp(-t / 0.075)
    skin = noise_band(n, 120, 650, seed + 1, 2) * np.exp(-t / 0.028) * 0.25
    x = body + skin
    x = filt(x, "lowpass", 2600, 2)
    tail = min(n, max(1, int(0.025 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


def darbuka_tak(duration: float = 0.16, *, amp: float = 1.0, seed: int = 4, fs: int = SR) -> np.ndarray:
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    tone = np.sin(TWOPI * 430 * t) * np.exp(-t / 0.028) * 0.5
    snap = noise_band(n, 1500, 8000, seed, 2) * (1.0 - np.exp(-t / 0.001)) * np.exp(-t / 0.024)
    x = tone + 0.46 * snap
    x = filt(x, "highpass", 330, 2)
    tail = min(n, max(1, int(0.012 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


def darbuka_slap(duration: float = 0.13, *, amp: float = 1.0, seed: int = 6, fs: int = SR) -> np.ndarray:
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    snap = noise_band(n, 1900, 9000, seed, 2) * (1.0 - np.exp(-t / 0.001)) * np.exp(-t / 0.019)
    tone = np.sin(TWOPI * 710 * t) * np.exp(-t / 0.018) * 0.25
    out = 0.72 * snap + tone
    tail = min(n, max(1, int(0.012 * fs)))
    out[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(out, amp)


def clap(duration: float = 0.30, *, amp: float = 1.0, seed: int = 8, fs: int = SR, soft: bool = False) -> np.ndarray:
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    env = np.zeros(n)
    for offset, level in ((0.0, 0.7), (0.009, 0.9), (0.019, 0.6), (0.031, 0.35)):
        env += level * np.exp(-((t - offset) ** 2) / (2 * 0.0032 ** 2))
    env += 0.12 * np.exp(-t / 0.08)
    x = noise_band(n, 850, 3600 if soft else 5200, seed, 2) * env
    x = filt(x, "highpass", 650, 2)
    tail = min(n, max(1, int(0.03 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


def closed_hat(duration: float = 0.08, *, amp: float = 1.0, seed: int = 9, fs: int = SR) -> np.ndarray:
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    # Metallic-ish inharmonic cluster plus noise, synthesised, not sampled.
    rng = np.random.default_rng(seed)
    metal = np.zeros(n)
    for ratio, level in ((5.1, 0.24), (7.7, 0.18), (11.3, 0.10), (14.9, 0.06)):
        metal += level * np.sin(TWOPI * 317 * ratio * t + rng.uniform(0, TWOPI))
    noise = rng.standard_normal(n)
    noise = filt(noise, "highpass", 7500, 2)
    env = (1.0 - np.exp(-t / 0.0007)) * np.exp(-t / 0.018)
    x = 0.5 * noise + metal * 0.6
    x *= env
    tail = min(n, max(1, int(0.008 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


def open_hat(duration: float = 0.33, *, amp: float = 1.0, seed: int = 10, fs: int = SR) -> np.ndarray:
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    rng = np.random.default_rng(seed)
    x = noise_band(n, 7000, 16000, seed, 2)
    for ratio in (3.7, 6.2, 9.1):
        x += 0.07 * np.sin(TWOPI * 383 * ratio * t + rng.uniform(0, TWOPI))
    env = (1.0 - np.exp(-t / 0.002)) * np.exp(-t / 0.11)
    x *= env
    tail = min(n, max(1, int(0.03 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


def card_flip(duration: float = 0.10, *, amp: float = 1.0, seed: int = 12, fs: int = SR) -> np.ndarray:
    """Syncopated paper/card swipe with a tiny wooden tick."""
    n = max(8, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    x = noise_band(n, 1800, 7500, seed, 2)
    env = (1.0 - np.exp(-t / 0.002)) * np.exp(-t / 0.026)
    click = np.sin(TWOPI * 1800 * t) * np.exp(-t / 0.003) * 0.22
    out = (x * env * 0.8) + click
    out = filt(out, "highpass", 900, 2)
    tail = min(n, max(1, int(0.01 * fs)))
    out[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(out, amp)


def whoosh(
    duration: float = 1.1,
    *,
    amp: float = 1.0,
    seed: int = 14,
    fs: int = SR,
    reverse: bool = False,
) -> np.ndarray:
    """Stereo swept-noise transition. Starts near silent if reverse=False."""
    n = max(16, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    u = t / max(duration, 1e-4)
    env_low = np.exp(-((u - 0.36) ** 2) / (2 * 0.18 ** 2))
    env_mid = np.exp(-((u - 0.59) ** 2) / (2 * 0.16 ** 2))
    env_hi = np.exp(-((u - 0.82) ** 2) / (2 * 0.14 ** 2))
    low = noise_band(n, 180, 700, seed + 1, 2) * env_low
    mid = noise_band(n, 600, 2800, seed + 2, 2) * env_mid
    high = noise_band(n, 2500, 9000, seed + 3, 2) * env_hi
    x = low * 0.9 + mid * 0.75 + high * 0.42
    # Airy sine sweep adds a directional cue.
    sweep = np.sin(TWOPI * (240 + 1150 * u ** 1.7) * t) * (env_mid * 0.028)
    x += sweep
    x *= _smoothstep(np.minimum(u / 0.08, 1.0)) * _smoothstep(np.minimum((1 - u) / 0.22, 1.0))
    pan = np.linspace(-0.85, 0.85, n) if not reverse else np.linspace(0.8, -0.8, n)
    gl = np.cos((pan + 1) * math.pi / 4)
    gr = np.sin((pan + 1) * math.pi / 4)
    out = np.stack([x * gl, x * gr])
    return normalize_peak(out, amp)


def riser(
    duration: float,
    *,
    amp: float = 1.0,
    seed: int = 15,
    fs: int = SR,
    start_hz: float = 48.0,
    end_hz: float = 760.0,
) -> np.ndarray:
    """Noise-and-tone riser with accelerating shimmer."""
    n = max(16, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    u = np.clip(t / max(duration, 1e-4), 0.0, 1.0)
    noise = noise_band(n, 300, 11000, seed, 2)
    high = noise_band(n, 1800, 16000, seed + 1, 2)
    env = u ** 2.4
    freq = start_hz + (end_hz - start_hz) * (u ** 1.7)
    tone = np.sin(TWOPI * np.cumsum(freq) / fs)
    sub = np.sin(TWOPI * np.cumsum(freq * 0.5) / fs) * 0.35
    tick = (np.sin(TWOPI * 9.0 * t) > 0.93).astype(float) * 0.012
    x = (noise * 0.55 + high * 0.22 + tone * 0.16 + sub * 0.1) * env + tick * env
    x *= _smoothstep(np.minimum((1.0 - u) / 0.06, 1.0))
    pan = np.linspace(-0.3, 0.45, n)
    gl = np.cos((pan + 1) * math.pi / 4)
    gr = np.sin((pan + 1) * math.pi / 4)
    return normalize_peak(np.stack([x * gl, x * gr]), amp)


def drop_impact(
    duration: float = 2.2,
    *,
    amp: float = 1.0,
    seed: int = 17,
    fs: int = SR,
    deep: bool = True,
    bright: float = 1.0,
) -> np.ndarray:
    n = max(16, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    # Sub drop, restrained so it does not swamp laptop speakers.
    f0 = 64.0 if deep else 86.0
    f1 = 31.0 if deep else 43.0
    freq = f1 + (f0 - f1) * np.exp(-t / 0.24)
    phase = TWOPI * np.cumsum(freq) / fs
    sub = np.sin(phase) * np.exp(-t / 0.52) * 0.85
    body = np.sin(phase * 1.99 + 0.4) * np.exp(-t / 0.20) * 0.18
    # Initial transient: a soft wooden crack rather than a clipped sample.
    crack = noise_band(n, 500, 6000, seed, 2) * np.exp(-t / 0.028) * 0.45 * bright
    metal = np.zeros(n)
    for ratio, level in ((3.3, 0.05), (5.7, 0.03), (8.1, 0.02)):
        metal += level * np.sin(TWOPI * 90 * ratio * t) * np.exp(-t / 0.35)
    x = sub + body + crack + metal
    x = soft_clip(x * 1.28, drive=1.3, ceiling=0.95)
    x = filt(x, "lowpass", 5800, 2)
    tail = min(n, max(1, int(0.05 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(x, amp)


def reverse_swell(
    duration: float = 1.25,
    *,
    amp: float = 1.0,
    seed: int = 18,
    fs: int = SR,
) -> np.ndarray:
    n = max(16, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    u = np.clip(t / max(duration, 1e-4), 0.0, 1.0)
    noise = noise_band(n, 1400, 14000, seed, 2) + 0.4 * noise_band(n, 200, 3000, seed + 2, 2)
    env = u ** 2.8
    # A soft chime is reversed along with the noise, making a glassy suck-in.
    chime = np.sin(TWOPI * 1180 * t) + 0.5 * np.sin(TWOPI * 1760 * t)
    chime *= 0.018 * env
    x = noise * env * 0.36 + chime
    x *= _smoothstep(np.minimum((1 - u) / 0.025, 1.0))
    return normalize_peak(x, amp)


def zap(duration: float = 0.45, *, amp: float = 1.0, seed: int = 19, fs: int = SR, up: bool = True) -> np.ndarray:
    n = max(16, int(duration * fs))
    t = np.arange(n, dtype=np.float64) / fs
    u = np.clip(t / max(duration, 1e-4), 0.0, 1.0)
    f = (620 + 4200 * u ** 1.3) if up else (4700 - 3800 * u ** 1.2)
    phase = TWOPI * np.cumsum(f) / fs
    env = (1.0 - np.exp(-t / 0.002)) * np.exp(-t / (duration * 0.32))
    x = np.sin(phase) + 0.35 * np.sin(phase * 1.99 + 0.3)
    x *= env
    sparkle = noise_band(n, 4000, 16000, seed, 2) * np.exp(-t / 0.045) * 0.18
    x += sparkle
    pan = 0.55 * np.sin(TWOPI * 1.4 * u)
    gl = np.cos((pan + 1) * math.pi / 4)
    gr = np.sin((pan + 1) * math.pi / 4)
    tail = min(n, max(1, int(0.03 * fs)))
    x[-tail:] *= np.cos(np.linspace(0, math.pi / 2, tail, endpoint=True)) ** 2
    return normalize_peak(np.stack([x * gl, x * gr]), amp)


def cat_glint(duration: float = 1.5, *, amp: float = 1.0, seed: int = 20, fs: int = SR) -> np.ndarray:
    """A high, tiny magical sparkle for the cat-eye reveal."""
    n = max(16, int(duration * fs))
    out = np.zeros((2, n))
    notes = (hz("D6"), hz("A6"), hz("F6"), hz("E7"))
    for i, f in enumerate(notes):
        start = int((0.035 + i * 0.055) * fs)
        bell = bell_note(f, duration * 0.8, shimmer=0.8, seed=seed + i, fs=fs)
        length = min(bell.size, n - start)
        gain = (0.7, 0.4, 0.28, 0.15)[i]
        pan = (-0.55, 0.3, -0.1, 0.65)[i]
        gl, gr = pan_gains(pan)
        out[0, start:start + length] += bell[:length] * gl * gain
        out[1, start:start + length] += bell[:length] * gr * gain
    return normalize_peak(out, amp)


# ---------------------------------------------------------------------------
# Delay, reverb, dynamics and analysis
# ---------------------------------------------------------------------------
def pingpong_delay(
    send: np.ndarray,
    delay_s: float,
    *,
    feedback: float = 0.3,
    repeats: int = 4,
    wet: float = 0.22,
    fs: int = SR,
    wrap: bool = True,
) -> np.ndarray:
    """Simple musical ping-pong delay with loop-aware wrapping."""
    dry = ensure_stereo(send)
    n = dry.shape[1]
    mono = as_mono(dry)
    out = np.zeros((2, n))
    d = max(1, int(round(delay_s * fs)))
    for r in range(1, repeats + 1):
        gain = (feedback ** (r - 1)) * wet
        shift = d * r
        if wrap:
            rolled = np.roll(mono, shift)
        else:
            rolled = np.zeros_like(mono)
            if shift < n:
                rolled[shift:] = mono[: n - shift]
        pan = -0.55 if r % 2 else 0.55
        gl, gr = pan_gains(pan)
        # The first repeat is centred-ish; subsequent repeats alternate width.
        out[0] += rolled * gain * gl
        out[1] += rolled * gain * gr
    return out


def make_impulse_response(
    duration: float = 2.4,
    *,
    decay: float = 0.55,
    predelay_ms: float = 19.0,
    fs: int = SR,
    seed: int = 101,
    brightness: float = 6500.0,
) -> np.ndarray:
    """Synthetic stereo plate/room IR: decorrelated noise with early taps."""
    n = max(32, int(duration * fs))
    rng = np.random.default_rng(seed)
    t = np.arange(n, dtype=np.float64) / fs
    ir = np.zeros((2, n))
    for c in range(2):
        noise = rng.standard_normal(n)
        noise = filt(noise, "highpass", 140, 2)
        noise = filt(noise, "lowpass", brightness, 2)
        env = np.exp(-t / decay) * (0.4 + 0.6 * (1.0 - np.exp(-t / 0.02)))
        ir[c] = noise * env
        # Sparse early reflections make the space feel physical.
        for k, (delay, level) in enumerate(((0.011, 0.6), (0.023, 0.42), (0.037, 0.3), (0.061, 0.22), (0.089, 0.14))):
            idx = int((delay + 0.002 * k * (c + 1)) * fs)
            if idx < n:
                ir[c, idx] += level * (1 if rng.random() > 0.5 else -1)
        ir[c] = filt(ir[c], "lowpass", brightness, 2)
    # Remove any DC and normalize energy.
    ir -= np.mean(ir, axis=1, keepdims=True)
    energy = math.sqrt(float(np.sum(ir * ir)) / 2.0)
    ir /= max(energy, EPS)
    ir *= math.sqrt(fs / 2400.0) * 0.018
    pre = int(predelay_ms * fs / 1000.0)
    ir = np.concatenate([np.zeros((2, pre)), ir], axis=1)
    return ir


def reverb_send(
    send: np.ndarray,
    ir: np.ndarray,
    *,
    wet_rms: float = 0.42,
    wrap: bool = True,
) -> np.ndarray:
    """Convolve a stereo send with an IR; circular for seamless loops."""
    dry = ensure_stereo(send)
    n = dry.shape[1]
    if wrap:
        # Fast circular convolution using a power-of-two FFT.
        nfft = 1 << int(math.ceil(math.log2(n + ir.shape[1] - 1)))
        wet = np.zeros((2, n))
        for c in range(2):
            conv = np.fft.irfft(np.fft.rfft(dry[c], nfft) * np.fft.rfft(ir[c], nfft), nfft)
            wet[c] = conv[:n]
            tail = conv[n : n + ir.shape[1] - 1]
            wet[c, : tail.size] += tail
    else:
        wet_full = fft_convolve_stereo(dry, ir)
        wet = wet_full[:, :n]
    want = np.sqrt(float(np.mean(dry * dry))) * wet_rms
    have = math.sqrt(float(np.mean(wet * wet)))
    if have > EPS:
        wet *= want / have
    return wet


def _control_rate_gain(
    peak: np.ndarray,
    *,
    attack_s: float,
    release_s: float,
    ceiling: float,
    fs: int = SR,
    block: int = 32,
) -> np.ndarray:
    """Block-rate peak-following gain, interpolated smoothly to audio rate."""
    n = peak.size
    nblocks = int(math.ceil(n / block))
    pads = nblocks * block - n
    padded = np.pad(peak, (0, pads), mode="edge") if pads else peak
    block_peak = padded.reshape(nblocks, block).max(axis=1)
    need = np.minimum(1.0, ceiling / np.maximum(block_peak, EPS))
    rate = fs / block
    attack = math.exp(-1.0 / max(attack_s * rate, 1e-6))
    release = math.exp(-1.0 / max(release_s * rate, 1e-6))
    gain = np.ones(nblocks, dtype=np.float64)
    g = 1.0
    for i, req in enumerate(need):
        a = attack if req < g else release
        g = a * g + (1.0 - a) * req
        gain[i] = g
    x_blocks = (np.arange(nblocks, dtype=np.float64) + 0.5) * block
    return np.interp(np.arange(n, dtype=np.float64), x_blocks, gain, left=gain[0], right=gain[-1])


def bus_compress(
    x: np.ndarray,
    *,
    threshold_db: float = -20.0,
    ratio: float = 2.0,
    attack_ms: float = 24.0,
    release_ms: float = 180.0,
    makeup_db: float = 0.0,
    knee_db: float = 6.0,
    fs: int = SR,
) -> np.ndarray:
    """Smooth stereo-linked feed-forward bus compressor (control-rate envelope)."""
    y = ensure_stereo(x.copy())
    peak = np.max(np.abs(y), axis=0)
    # Smooth sample peaks to a millisecond-scale control envelope; a block RMS
    # would under-react to transients, so the block peak is intentional here.
    block = 32
    nblocks = int(math.ceil(peak.size / block))
    padded = np.pad(peak, (0, nblocks * block - peak.size), mode="edge")
    ctrl = padded.reshape(nblocks, block).max(axis=1)
    rate = fs / block
    attack = math.exp(-1.0 / (attack_ms * 0.001 * rate))
    release = math.exp(-1.0 / (release_ms * 0.001 * rate))
    env = np.empty(nblocks)
    e = 0.0
    for i, p in enumerate(ctrl):
        coeff = attack if p > e else release
        e = coeff * e + (1.0 - coeff) * p
        env[i] = e
    env_db = 20.0 * np.log10(np.maximum(env, EPS))
    over = env_db - threshold_db
    gain_db = np.where(
        over <= -knee_db / 2,
        0.0,
        np.where(
            over >= knee_db / 2,
            -over * (1 - 1 / ratio),
            -((over + knee_db / 2) ** 2) / (2 * knee_db) * (1 - 1 / ratio),
        ),
    )
    ctrl_gain = np.power(10.0, (gain_db + makeup_db) / 20.0)
    x_nodes = (np.arange(nblocks, dtype=np.float64) + 0.5) * block
    gain = np.interp(np.arange(y.shape[1], dtype=np.float64), x_nodes, ctrl_gain)
    return y * gain


def soft_limit(x: np.ndarray, ceiling_db: float = -1.6, fs: int = SR) -> np.ndarray:
    """Gentle safety limiter with a smooth control-rate envelope.

    The goal is transparent peak safety, not competitive loudness.  A final
    static trim guarantees that sample peaks cannot exceed the ceiling after
    the smoothed gain envelope.
    """
    y = ensure_stereo(x.copy())
    ceiling = db_to_gain(ceiling_db)
    peak = np.max(np.abs(y), axis=0)
    gain = _control_rate_gain(
        peak,
        attack_s=0.00035,
        release_s=0.060,
        ceiling=ceiling,
        fs=fs,
    )
    y *= gain
    m = float(np.max(np.abs(y)))
    if m > ceiling:
        y *= ceiling / m
    return y


def loudness_lufs(x: np.ndarray, fs: int = SR) -> float:
    """ITU-R BS.1770-4 integrated loudness (K-weighting + gating)."""
    audio = ensure_stereo(np.asarray(x, dtype=np.float64))
    # K-weighting coefficients for 48 kHz.  If another sample rate is needed,
    # fall back to a close approximation via the same filters (we only use 48k).
    if fs == 48_000:
        b1 = np.array([1.53512485958697, -2.69169618940638, 1.19839281085285])
        a1 = np.array([1.0, -1.69065929318241, 0.73248077421585])
        b2 = np.array([1.0, -2.0, 1.0])
        a2 = np.array([1.0, -1.99004745483398, 0.99007225036621])
    else:
        # A serviceable approximation at other rates.
        b1, a1 = signal.iirfilter(2, 1500, btype="highpass", fs=fs)
        b2, a2 = signal.iirfilter(2, 38, btype="highpass", fs=fs)
    filtered = signal.lfilter(b1, a1, audio, axis=-1)
    filtered = signal.lfilter(b2, a2, filtered, axis=-1)
    block = int(0.400 * fs)
    step = int(0.100 * fs)
    if filtered.shape[1] < block:
        energy = float(np.sum(filtered * filtered) / filtered.size)
        return -0.691 + 10.0 * math.log10(max(energy, EPS))
    energies = []
    for start in range(0, filtered.shape[1] - block + 1, step):
        seg = filtered[:, start : start + block]
        # BS.1770 sums the weighted mean-square of each channel.
        energies.append(float(np.sum(seg * seg) / block))
    energies = np.asarray(energies)
    loudness = -0.691 + 10.0 * np.log10(np.maximum(energies, EPS))
    abs_gate = loudness > -70.0
    if not np.any(abs_gate):
        return -100.0
    integrated = -0.691 + 10.0 * math.log10(float(np.mean(energies[abs_gate])))
    rel_gate = abs_gate & (loudness > integrated - 10.0)
    if np.any(rel_gate):
        integrated = -0.691 + 10.0 * math.log10(float(np.mean(energies[rel_gate])))
    return float(integrated)


def true_peak_db(x: np.ndarray, oversample: int = 4) -> float:
    """Approximate dBTP using polyphase oversampling."""
    y = ensure_stereo(np.asarray(x, dtype=np.float64))
    # resample_poly at 4x; remove tiny numerical ringing before measuring.
    up = signal.resample_poly(y, oversample, 1, axis=-1)
    peak = float(np.max(np.abs(up)))
    return 20.0 * math.log10(max(peak, EPS))


def peak_dbfs(x: np.ndarray) -> float:
    return 20.0 * math.log10(max(float(np.max(np.abs(x))), EPS))


def rms_dbfs(x: np.ndarray) -> float:
    return 20.0 * math.log10(max(float(np.sqrt(np.mean(np.square(x)))), EPS))


def dc_offset(x: np.ndarray) -> float:
    return float(np.mean(ensure_stereo(x)))


def dither_float_to_int24(x: np.ndarray, *, seed: int = 1234) -> np.ndarray:
    """TPDF dither then quantise to signed 24-bit integers (values in [-2^23, 2^23-1])."""
    y = ensure_stereo(np.asarray(x, dtype=np.float64))
    rng = np.random.default_rng(seed)
    # 1 LSB TPDF at 24-bit.  Kept far below the programme level.
    dither = (rng.random(y.shape) - rng.random(y.shape)) / (2 ** 23)
    y = np.clip(y + dither, -1.0, 1.0)
    return np.rint(y * (2 ** 23 - 1)).astype(np.int32)


def write_wav24(path: str | Path, x: np.ndarray, fs: int = SR, *, seed: int = 1234) -> None:
    """Write an interleaved 24-bit PCM WAV without adding any leading samples."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    y = ensure_stereo(np.asarray(x, dtype=np.float64))
    q = dither_float_to_int24(y, seed=seed)
    interleaved = q.T.reshape(-1)
    # Low three bytes of little-endian int32 give a valid 24-bit sample.
    raw = interleaved.astype("<i4").view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(fs)
        w.writeframes(raw)


def read_wav(path: str | Path) -> tuple[int, np.ndarray]:
    with wave.open(str(path), "rb") as w:
        fs = w.getframerate()
        channels = w.getnchannels()
        width = w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width == 2:
        data = np.frombuffer(raw, dtype="<i2").astype(np.float64) / 32768.0
    elif width == 3:
        b = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 3).astype(np.int32)
        val = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        val = np.where(val >= (1 << 23), val - (1 << 24), val)
        data = val.astype(np.float64) / float(1 << 23)
    elif width == 4:
        data = np.frombuffer(raw, dtype="<i4").astype(np.float64) / float(1 << 31)
    else:
        raise ValueError(f"Unsupported WAV width {width}")
    if channels == 2:
        data = data.reshape(-1, 2).T
    elif channels == 1:
        data = data.reshape(1, -1)
    return fs, data


# ---------------------------------------------------------------------------
# Loudness trim + loop helpers
# ---------------------------------------------------------------------------
def gain_to_lufs(x: np.ndarray, target_lufs: float, ceiling_db: float = -1.6) -> np.ndarray:
    """Static loudness normalisation followed by a transparent peak safety."""
    y = ensure_stereo(np.asarray(x, dtype=np.float64))
    current = loudness_lufs(y)
    y = y * db_to_gain(target_lufs - current)
    if peak_dbfs(y) > ceiling_db:
        y = soft_limit(y, ceiling_db=ceiling_db)
    return y


def prepare_loop(x: np.ndarray, loop_n: int, crossfade_ms: float = 17.0) -> np.ndarray:
    """Trim a rendered N+W loop to N samples with a circular de-click.

    The generator renders an extra crossfade-length continuation of the loop.
    We fade the loop starting point from that continuation into the original
    start.  This removes the arbitrary waveform discontinuity at the seam
    while preserving the loop's full musical length and energy.
    """
    y = ensure_stereo(np.asarray(x, dtype=np.float64))
    if y.shape[1] < loop_n:
        raise ValueError("Loop buffer is shorter than loop_n")
    w = min(int(crossfade_ms * SR / 1000.0), loop_n // 2, y.shape[1] - loop_n)
    out = y[:, :loop_n].copy()
    if w > 0:
        fade_in = np.sin(np.linspace(0, math.pi / 2, w, endpoint=True))[None, :]
        fade_out = np.cos(np.linspace(0, math.pi / 2, w, endpoint=True))[None, :]
        continuation = y[:, loop_n : loop_n + w]
        out[:, :w] = out[:, :w] * fade_in + continuation * fade_out
    return out


def add_at(
    buf: np.ndarray,
    sig: np.ndarray,
    start_s: float,
    *,
    gain: float = 1.0,
    pan: float = 0.0,
    wrap_n: int | None = None,
    fs: int = SR,
) -> None:
    """Add a mono/stereo event to a stereo buffer, optionally wrapping a loop."""
    dst = ensure_stereo(buf) if not (buf.ndim == 2 and buf.shape[0] == 2) else buf
    src = np.asarray(sig, dtype=np.float64)
    if src.ndim == 1:
        gl, gr = pan_gains(pan)
        stereo = np.stack([src * gl, src * gr]) * gain
    else:
        stereo = ensure_stereo(src) * gain
    length = stereo.shape[1]
    if length == 0:
        return
    start = int(round(start_s * fs))
    if wrap_n is None:
        if start >= dst.shape[1]:
            return
        if start < 0:
            # Allow useful pre-roll events by trimming their heads.
            cut = min(length, -start)
            stereo = stereo[:, cut:]
            start = 0
            length = stereo.shape[1]
        take = min(length, dst.shape[1] - start)
        dst[:, start : start + take] += stereo[:, :take]
        return
    n = wrap_n
    start = int(round(start_s * fs)) % n
    # Split the event at the loop boundary instead of doing a large bincount.
    first = min(length, n - start)
    if first > 0:
        dst[:, start : start + first] += stereo[:, :first]
    rest = length - first
    if rest > 0:
        # A long event may in principle wrap more than once.
        pos = 0
        while pos < rest:
            take = min(rest - pos, n)
            dst[:, :take] += stereo[:, first + pos : first + pos + take]
            pos += take


def crossfade_loop_safe(sig: np.ndarray, start_s: float, duration_s: float, loop_n: int) -> tuple[int, int]:
    """Return integer sample bounds of an event, wrapping it into the loop."""
    start = int(round(start_s * SR)) % loop_n
    end = start + int(round(duration_s * SR))
    return start, end


# ---------------------------------------------------------------------------
# Encoders
# ---------------------------------------------------------------------------
def run(cmd: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(
        list(cmd),
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )


def encode_ogg(src: str | Path, dst: str | Path, *, quality: int = 8) -> None:
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-map_metadata", "-1",
        "-c:a", "libvorbis", "-q:a", str(quality),
        "-ar", str(SR), "-ac", "2", str(dst),
    ])


def encode_mp3(src: str | Path, dst: str | Path, *, quality: int = 2) -> None:
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-map_metadata", "-1",
        "-c:a", "libmp3lame", "-q:a", str(quality),
        "-ar", str(SR), "-ac", "2", "-write_xing", "1", "-id3v2_version", "0",
        str(dst),
    ])
