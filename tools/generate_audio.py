"""Meow Memory original soundtrack generator.

Run from the repository root:
    python tools/generate_audio.py             # everything
    python tools/generate_audio.py --only menu # selected deliverables
    python tools/generate_audio.py --force-tts # refresh Arabic narration

All music and sound design are synthesized from first principles using
numpy/scipy (see audio_engine.py).  The only external content is the Arabic
edge-tts narration, cached under tools/audio-src/voice.  No samples or
copyrighted music are used.

Outputs:
    assets/audio/menu-theme.ogg / .mp3
    tools/audio-src/menu-theme.wav
    assets/audio/battle-theme.ogg / .mp3
    tools/audio-src/battle-theme.wav
    assets/audio/trailer-mix.wav / .mp3
    assets/audio/trailer-cues.json
    tools/AUDIO_NOTES.md
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np
from scipy import signal

import audio_engine as ae
import audio_voice as voice

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "assets" / "audio"
SRC = ROOT / "tools" / "audio-src"
TOOLS = ROOT / "tools"

MENU_BPM = 88.0
MENU_BEATS = 64
MENU_BAR = 4.0 * 60.0 / MENU_BPM
MENU_BEAT = 60.0 / MENU_BPM
MENU_SECONDS = 16.0 * MENU_BAR
MENU_N = int(round(MENU_SECONDS * ae.SR))

BATTLE_BPM = 112.0
BATTLE_BEATS = 64
BATTLE_BAR = 4.0 * 60.0 / BATTLE_BPM
BATTLE_BEAT = 60.0 / BATTLE_BPM
BATTLE_SECONDS = 16.0 * BATTLE_BAR
BATTLE_N = int(round(BATTLE_SECONDS * ae.SR))

TRAILER_BPM = 100.0
TRAILER_BEAT = 0.6
TRAILER_BAR = 2.4
TRAILER_SECONDS = 44.8
TRAILER_N = int(round(TRAILER_SECONDS * ae.SR))
LOOP_XFADE_S = 0.012
LOOP_GUARD = int(round(LOOP_XFADE_S * ae.SR))


# ---------------------------------------------------------------------------
# Small mixing desk
# ---------------------------------------------------------------------------
class Score:
    """A lightweight multitrack accumulator with reverb/delay sends."""

    def __init__(self, n: int, *, seed: int, loop_continuation_n: int | None = None):
        self.n = int(n)
        self.rng = np.random.default_rng(seed)
        self.buses: dict[str, np.ndarray] = {}
        self.reverb_send = np.zeros((2, self.n), dtype=np.float64)
        self.delay_send = np.zeros((2, self.n), dtype=np.float64)
        self._kick_times: list[float] = []
        # For interactive loops, events in the first few milliseconds are
        # repeated just after the loop point so the seam crossfade has a true
        # view of the next downbeat.
        self.loop_continuation_n = loop_continuation_n
        self.continuation_window = 0.055

    def bus(self, name: str) -> np.ndarray:
        if name not in self.buses:
            self.buses[name] = np.zeros((2, self.n), dtype=np.float64)
        return self.buses[name]

    @staticmethod
    def _pan_event(sig: np.ndarray, pan: float) -> np.ndarray:
        src = ae.ensure_stereo(sig)
        if abs(pan) < 1e-6:
            return src
        gl, gr = ae.pan_gains(pan)
        # Balance stereo, constant-power pan mono.  The sqrt(2) restores the
        # centre level for stereo material.
        if np.asarray(sig).ndim == 1:
            return np.stack([src[0] * gl, src[1] * gr])
        return np.stack([src[0] * gl * math.sqrt(2.0), src[1] * gr * math.sqrt(2.0)])

    def add(
        self,
        bus: str,
        sig: np.ndarray,
        start_s: float,
        *,
        gain_db: float = 0.0,
        pan: float = 0.0,
        verb: float = 0.0,
        delay: float = 0.0,
    ) -> None:
        if sig is None:
            return
        src = self._pan_event(np.asarray(sig, dtype=np.float64), pan)
        gain = ae.db_to_gain(gain_db)
        stem = src * gain
        ae.add_at(self.bus(bus), stem, start_s)
        if verb:
            ae.add_at(self.reverb_send, stem, start_s, gain=verb)
        if delay:
            ae.add_at(self.delay_send, stem, start_s, gain=delay)
        if (
            self.loop_continuation_n is not None
            and 0.0 <= start_s < self.continuation_window
        ):
            cont_t = self.loop_continuation_n + start_s
            if cont_t < self.n:
                ae.add_at(self.bus(bus), stem, cont_t)
                if verb:
                    ae.add_at(self.reverb_send, stem, cont_t, gain=verb)
                if delay:
                    ae.add_at(self.delay_send, stem, cont_t, gain=delay)

    def add_kick(self, start_s: float, *, gain_db: float, pan: float = 0.0, **kwargs) -> None:
        self._kick_times.append(float(start_s))
        sig = ae.kick(seed=kwargs.pop("seed", int(self.rng.integers(1, 1_000_000))), **kwargs)
        self.add("perc", sig, start_s, gain_db=gain_db, pan=pan, verb=0.05)

    def sidechain(self, bus: str, *, depth_db: float, attack_s: float = 0.008, release_s: float = 0.18) -> None:
        """Duck a bus from the kicks collected so far (loop-aware)."""
        if not self._kick_times:
            return
        b = self.bus(bus)
        duck = sidechain_envelope(self.n, self._kick_times, depth_db, attack_s, release_s)
        b *= duck[None, :]

    def finish(
        self,
        *,
        ir: np.ndarray,
        verb_rms: float,
        delay_s: float,
        delay_wet: float,
        bus_gains_db: dict[str, float] | None = None,
        delay_feedback: float = 0.3,
    ) -> np.ndarray:
        gains = bus_gains_db or {}
        out = np.zeros((2, self.n), dtype=np.float64)
        for name, b in self.buses.items():
            out += b * ae.db_to_gain(gains.get(name, 0.0))
        wet = ae.reverb_send(self.reverb_send, ir, wet_rms=verb_rms, wrap=False)
        out += wet
        echo = ae.pingpong_delay(
            self.delay_send, delay_s, feedback=delay_feedback, repeats=4, wet=delay_wet, wrap=False
        )
        out += echo
        out -= np.mean(out, axis=1, keepdims=True)
        bus_report = []
        for name, b in self.buses.items():
            bus_report.append(f"{name} {ae.rms_dbfs(b):.1f}/{ae.peak_dbfs(b):.1f}")
        print("    mix buses (RMS/peak dBFS): " + ", ".join(bus_report))
        print(f"    sends: verb {ae.rms_dbfs(wet):.1f}, delay {ae.rms_dbfs(echo):.1f}; mix {ae.rms_dbfs(out):.1f}/{ae.peak_dbfs(out):.1f}")
        return out


def sidechain_envelope(
    n: int,
    times: Sequence[float],
    depth_db: float,
    attack_s: float = 0.008,
    release_s: float = 0.18,
    fs: int = ae.SR,
) -> np.ndarray:
    depth = depth_db
    env = np.ones(n, dtype=np.float64)
    attack_n = max(1, int(attack_s * fs))
    tail_n = min(n, int((release_s * 4.0) * fs))
    shape_t = np.arange(tail_n, dtype=np.float64) / fs
    shape = (1.0 - np.exp(-shape_t / max(attack_s, 1e-4))) * np.exp(-shape_t / max(release_s, 1e-4))
    shape = shape / max(float(np.max(shape)), 1e-9)
    drop = 1.0 - ae.db_to_gain(-depth)
    for t in times:
        start = int(round(t * fs)) % n
        count = min(tail_n, n - start)
        env[start : start + count] = np.minimum(env[start : start + count], 1.0 - drop * shape[:count])
    return env


# ---------------------------------------------------------------------------
# Instrument wrappers (all original synthesis)
# ---------------------------------------------------------------------------
def add_harp(
    sc: Score,
    bar: int,
    beat: float,
    note: str | int,
    *,
    dur: float,
    gain_db: float,
    pan: float = 0.0,
    tone: str = "harp",
    verb: float = 0.26,
    delay: float = 0.08,
    bus: str = "arp",
    bar_len: float = MENU_BAR,
) -> None:
    seed = int(sc.rng.integers(1, 2_000_000_000))
    brightness = 0.68 if tone == "harp" else 0.82
    decay = 1.35 if tone == "harp" else 1.0
    sig = ae.additive_pluck(
        ae.hz(note), dur, brightness=brightness, decay=decay, seed=seed,
        tone="oud" if tone == "oud" else "harp",
    )
    sc.add(bus, sig, bar * bar_len + beat * (bar_len / 4.0), gain_db=gain_db, pan=pan, verb=verb, delay=delay)


def add_bell(
    sc: Score,
    t: float,
    note: str | int,
    *,
    dur: float = 2.4,
    gain_db: float,
    pan: float = 0.0,
    verb: float = 0.5,
    delay: float = 0.18,
    bus: str = "melody",
    shimmer: float = 0.45,
) -> None:
    sig = ae.bell_note(ae.hz(note), dur, seed=int(sc.rng.integers(1, 2_000_000_000)), shimmer=shimmer)
    sc.add(bus, sig, t, gain_db=gain_db, pan=pan, verb=verb, delay=delay)


def add_pad(
    sc: Score,
    t: float,
    notes: Sequence[str | int],
    *,
    dur: float,
    gain_db: float,
    attack: float = 0.7,
    release: float = 1.4,
    cutoff: float = 2500.0,
    verb: float = 0.35,
    bus: str = "pad",
    seed: int | None = None,
    detune: float = 7.0,
) -> None:
    sig = ae.pad_chord(
        notes, dur, attack=attack, release=release, cutoff=cutoff, seed=seed or int(sc.rng.integers(1, 2_000_000_000)),
        detune_cents=detune, spread=0.8,
    )
    sc.add(bus, sig, t, gain_db=gain_db, verb=verb)


def add_strings(
    sc: Score,
    t: float,
    notes: Sequence[str | int],
    *,
    dur: float,
    gain_db: float,
    attack: float = 0.45,
    release: float = 1.0,
    cutoff: float = 4800.0,
    verb: float = 0.4,
    bus: str = "strings",
) -> None:
    sig = ae.string_ensemble(notes, dur, attack=attack, release=release, cutoff=cutoff, seed=int(sc.rng.integers(1, 2_000_000_000)))
    sc.add(bus, sig, t, gain_db=gain_db, verb=verb)


def add_piano(
    sc: Score,
    t: float,
    note: str | int,
    *,
    dur: float = 2.8,
    gain_db: float,
    pan: float = 0.0,
    verb: float = 0.4,
    bus: str = "piano",
) -> None:
    sig = ae.piano_note(ae.hz(note), dur, seed=int(sc.rng.integers(1, 2_000_000_000)))
    sc.add(bus, sig, t, gain_db=gain_db, pan=pan, verb=verb)


def add_darbuka_dum(sc: Score, t: float, *, gain_db: float, pan: float = 0.0, soft: bool = False) -> None:
    sig = ae.brushed_darbuka_dum(seed=int(sc.rng.integers(1, 2_000_000_000)))
    if not soft:
        sig = sig * 1.0
    sc.add("perc", sig, t, gain_db=gain_db, pan=pan, verb=0.10)


def add_darbuka_tak(sc: Score, t: float, *, gain_db: float, pan: float = 0.0, slap: bool = False) -> None:
    seed = int(sc.rng.integers(1, 2_000_000_000))
    sig = ae.darbuka_slap(seed=seed) if slap else ae.darbuka_tak(seed=seed)
    sc.add("perc", sig, t, gain_db=gain_db, pan=pan, verb=0.08)


def add_hat(sc: Score, t: float, *, gain_db: float, pan: float = 0.0, open_: bool = False) -> None:
    seed = int(sc.rng.integers(1, 2_000_000_000))
    sig = ae.open_hat(seed=seed) if open_ else ae.closed_hat(seed=seed)
    sc.add("perc", sig, t, gain_db=gain_db, pan=pan, verb=0.03)


def add_shaker(sc: Score, t: float, *, gain_db: float, pan: float = 0.0) -> None:
    sig = ae.shaker(seed=int(sc.rng.integers(1, 2_000_000_000)))
    sc.add("perc", sig, t, gain_db=gain_db, pan=pan, verb=0.04)


def add_clap(sc: Score, t: float, *, gain_db: float, pan: float = 0.0, soft: bool = True) -> None:
    sig = ae.clap(seed=int(sc.rng.integers(1, 2_000_000_000)), soft=soft)
    sc.add("perc", sig, t, gain_db=gain_db, pan=pan, verb=0.12)


def stereo_width(x: np.ndarray, amount: float = 1.1) -> np.ndarray:
    """Gentle mid/side widening that remains mono-compatible."""
    y = ae.ensure_stereo(x)
    mid = (y[0] + y[1]) * 0.5
    side = (y[0] - y[1]) * 0.5 * amount
    return np.stack([mid + side, mid - side])


def trailer_pluck(
    sc: Score,
    t: float,
    note: str | int,
    *,
    gain_db: float,
    pan: float = 0.0,
    dur: float = 1.15,
    brightness: float = 0.64,
    decay: float = 1.25,
    verb: float = 0.34,
    delay: float = 0.11,
    bus: str = "keys",
    tone: str = "harp",
) -> None:
    sig = ae.additive_pluck(
        ae.hz(note), dur, brightness=brightness, decay=decay,
        seed=int(sc.rng.integers(1, 2_000_000_000)), tone=tone,
    )
    sc.add(bus, sig, t, gain_db=gain_db, pan=pan, verb=verb, delay=delay)


def trailer_sfx(
    sc: Score,
    t: float,
    sig: np.ndarray,
    *,
    gain_db: float,
    pan: float = 0.0,
) -> None:
    # Sound design stays out of the music's reverb send so it can be ducked
    # separately from the score and remain punchy.
    sc.add("sfx", sig, t, gain_db=gain_db, pan=pan, verb=0.0, delay=0.0)


def add_cue(cues: list[dict], t: float, type_: str, label: str) -> None:
    # 30 fps frame-friendly, six decimals for clean JSON.
    tq = round(round(float(t) * 30.0) / 30.0, 6)
    cues.append({"t": tq, "type": type_, "label": label})


def stereo_width(x: np.ndarray, amount: float = 1.1) -> np.ndarray:
    """Gentle mid/side widening that remains mono-compatible."""
    y = ae.ensure_stereo(x)
    mid = (y[0] + y[1]) * 0.5
    side = (y[0] - y[1]) * 0.5 * amount
    return np.stack([mid + side, mid - side])


# ---------------------------------------------------------------------------
# Menu: 88 BPM, 16 bars, D minor / Nahawand
# ---------------------------------------------------------------------------
MENU_PAD_SPANS = [
    (0, 2, ("D3", "F3", "A3", "E4"), "Dm(add9)"),
    (2, 4, ("Bb2", "D3", "F3", "A3"), "Bb(maj7)"),
    (4, 6, ("F3", "A3", "C4", "E4", "G4"), "F(maj9)"),
    (6, 7, ("G3", "Bb3", "D4", "F4", "A4"), "Gm9"),
    (7, 8, ("A2", "E3", "G3", "D4"), "A7sus4"),
    (8, 10, ("D3", "F3", "A3", "C4", "E4"), "Dm9"),
    (10, 12, ("Bb2", "D3", "F3", "A3"), "Bb(maj7)"),
    (12, 13, ("G3", "Bb3", "D4", "F4", "A4"), "Gm9"),
    (13, 14, ("A2", "E3", "G3", "C#4"), "A7"),
    (14, 15, ("Bb2", "D3", "F3", "A3"), "Bb(maj7)"),
    (15, 16, ("A2", "E3", "G3", "D4"), "A7sus4"),
]

MENU_BAR_CHORDS = [
    "Dm", "Dm", "Bb", "Bb", "F", "F", "Gm", "A",
    "Dm", "Dm", "Bb", "Bb", "Gm", "A", "Bb", "Asus",
]

MENU_ARP_POOLS = {
    "Dm": ("D3", "F3", "A3", "D4", "E4", "A4", "F4", "D4"),
    "Bb": ("Bb3", "D4", "F4", "Bb4", "A4", "F4", "D4", "Bb3"),
    "F": ("F3", "A3", "C4", "G4", "A4", "E4", "C4", "A3"),
    "Gm": ("G3", "Bb3", "D4", "A4", "F4", "D4", "Bb3", "G3"),
    "A": ("A3", "C#4", "E4", "G4", "A4", "E4", "C#4", "A3"),
    "Asus": ("A3", "D4", "E4", "G4", "A4", "E4", "D4", "A3"),
}
MENU_ARP_ORDERS = (
    (0, 1, 2, 3, 4, 3, 2, 1),
    (0, 2, 1, 3, 4, 3, 2, 1),
    (0, 1, 2, 3, 2, 4, 5, 3),
    (0, 2, 3, 1, 4, 3, 2, 1),
)

MENU_BASS_ROOTS = [
    "D2", "D2", "Bb1", "Bb1", "F2", "F2", "G2", "A2",
    "D2", "D2", "Bb1", "Bb1", "G2", "A2", "Bb1", "A2",
]

# (bar index, beat, note, beats held)
MENU_MELODY = [
    (0, 0.0, "A4", 0.75), (0, 0.5, "D5", 0.5), (0, 1.0, "F5", 0.5), (0, 1.5, "E5", 1.65),
    (0, 3.0, "D5", 0.55),
    (1, 1.0, "A4", 0.8), (1, 2.5, "D5", 1.0),
    (2, 0.0, "F5", 0.9), (2, 1.5, "A5", 0.5), (2, 2.0, "G5", 0.5), (2, 2.5, "F5", 1.25),
    (3, 0.0, "D5", 0.75), (3, 0.75, "C5", 0.45), (3, 1.25, "D5", 0.45), (3, 2.5, "F5", 1.45),
    (4, 0.0, "E5", 1.1), (4, 1.5, "G5", 0.5), (4, 2.0, "A5", 1.45),
    (5, 0.0, "G5", 0.5), (5, 0.5, "F5", 0.5), (5, 1.0, "E5", 1.2), (5, 2.5, "C5", 0.45), (5, 3.0, "E5", 1.25),
    (6, 0.0, "D5", 0.8), (6, 1.0, "F5", 0.5), (6, 1.5, "G5", 0.5), (6, 2.0, "A5", 1.45),
    (7, 0.0, "E5", 0.85), (7, 1.0, "D5", 0.45), (7, 1.5, "C#5", 0.5), (7, 2.5, "E5", 1.45),
    (8, 0.0, "A5", 0.5), (8, 0.5, "D6", 0.5), (8, 1.0, "F6", 0.5), (8, 1.5, "E6", 1.35),
    (8, 3.0, "D6", 0.5),
    (9, 0.0, "F5", 0.75), (9, 0.75, "E5", 0.45), (9, 1.25, "D5", 0.75), (9, 2.5, "A4", 1.45),
    (10, 0.0, "F5", 0.8), (10, 1.0, "A5", 0.8), (10, 2.0, "Bb5", 0.9), (10, 3.0, "A5", 0.9),
    (11, 0.0, "G5", 0.75), (11, 0.75, "F5", 0.45), (11, 1.25, "D5", 0.7), (11, 2.0, "C5", 1.35),
    (12, 0.0, "D5", 0.7), (12, 0.75, "G5", 0.45), (12, 1.25, "Bb5", 0.9), (12, 2.25, "A5", 1.15),
    (13, 0.0, "C#5", 0.9), (13, 1.0, "E5", 0.9), (13, 2.0, "G5", 0.9), (13, 3.0, "F5", 0.95),
    (14, 0.0, "D5", 0.7), (14, 0.75, "F5", 0.45), (14, 1.25, "Bb5", 0.9), (14, 2.25, "A5", 1.05),
    (15, 0.0, "C#5", 0.5), (15, 0.5, "E5", 0.75), (15, 1.25, "D5", 0.75), (15, 2.0, "A4", 1.6),
]


def render_menu() -> tuple[np.ndarray, dict]:
    n = MENU_N + LOOP_GUARD
    sc = Score(n, seed=8801, loop_continuation_n=MENU_N)
    bar = MENU_BAR

    # Pads.  We begin before the first downbeat with a very soft swell; no fade
    # at the end, because the final pad/reverb tail is part of the loop.
    for b0, b1, notes, name in MENU_PAD_SPANS:
        dur = (b1 - b0) * bar + 0.75
        level = -18.3
        if b0 in (0, 8):
            level = -19.5
        elif b0 >= 12:
            level = -18.8
        add_pad(
            sc, b0 * bar, notes, dur=dur, gain_db=level, attack=0.75, release=1.55,
            cutoff=2450 if b0 < 8 else 2850, verb=0.42,
            bus="pad", seed=1100 + b0,
        )
    # A high airy fifth at the top of the second half.
    for t, note, level in (
        (8 * bar, "A5", -36.0), (10 * bar, "E5", -39.0),
        (12 * bar, "D6", -38.0), (14 * bar, "A5", -39.0),
    ):
        add_bell(sc, t, note, dur=4.5, gain_db=level, pan=0.25, verb=0.65, delay=0.1, bus="air", shimmer=0.8)

    # Harp/oud arpeggios.
    for b, key in enumerate(MENU_BAR_CHORDS):
        pool = MENU_ARP_POOLS[key]
        order = MENU_ARP_ORDERS[b % len(MENU_ARP_ORDERS)]
        # Intro leaves the last two eighths of a phrase to breathe.
        positions = (0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5)
        if b in (0, 1):
            positions = positions[:6]
        for k, beat in enumerate(positions):
            idx = order[k % len(order)]
            tone = "oud" if k % 2 == 0 else "harp"
            level = -25.6 if k not in (0, 4) else -24.2
            # Spread gentle microtiming; keep the loop musically locked.
            jitter = float(sc.rng.normal(0.0, 0.0028))
            seed = int(sc.rng.integers(1, 2_000_000_000))
            sig = ae.additive_pluck(
                ae.hz(pool[idx]), 1.05 if tone == "oud" else 1.45,
                brightness=0.72 if tone == "oud" else 0.58,
                decay=0.9 if tone == "oud" else 1.55,
                seed=seed, tone=tone,
            )
            pan = (-0.32, 0.16, -0.1, 0.34, 0.26, -0.22, 0.1, -0.3)[k]
            sc.add("arp", sig, b * bar + beat * MENU_BEAT + jitter, gain_db=level, pan=pan, verb=0.24, delay=0.09)
        # Low root pluck anchors the bar.
        if b >= 2:
            root = MENU_BASS_ROOTS[b]
            sig = ae.additive_pluck(ae.hz(root) * 2.0, 2.2, brightness=0.9, decay=1.9, seed=b + 50, tone="oud")
            sc.add("arp", sig, b * bar, gain_db=-31.0, pan=-0.04, verb=0.15, delay=0.02)

    # Melody: celesta / music-box bell with a close double in the second half.
    for b, beat, note, held in MENU_MELODY:
        t = b * bar + beat * MENU_BEAT
        if note in ("D6", "F6", "E6"):
            level = -21.0
        elif note in ("Bb5", "A5", "G5"):
            level = -19.5
        else:
            level = -18.6
        dur = max(1.15, 1.2 + held * MENU_BEAT * 0.8)
        add_bell(
            sc, t, note, dur=min(3.6, dur), gain_db=level,
            pan=(-0.08 if b % 2 else 0.08), verb=0.52, delay=0.17, bus="melody",
        )
        # A quiet plucked shadow one octave below adds body on long notes.
        if held >= 1.1:
            seed = int(sc.rng.integers(1, 2_000_000_000))
            shadow = ae.additive_pluck(ae.hz(note) / 2.0, 1.9, brightness=0.9, decay=1.65, seed=seed, tone="harp")
            sc.add("melody", shadow, t, gain_db=-30.0, pan=0.1, verb=0.28, delay=0.03)

    # Rounded sub bass and a light upper bass articulation.
    for b, root in enumerate(MENU_BASS_ROOTS):
        level = -30.0 if b < 2 else -28.5
        sig = ae.sub_bass(ae.hz(root), bar * 0.96, attack=0.035, release=0.25)
        sc.add("bass", sig, b * bar, gain_db=level, pan=0.0, verb=0.06)
        if b >= 2:
            upper = ae.pluck_bass(ae.hz(root) * 2.0, 0.65, seed=b + 90)
            sc.add("bass", upper, b * bar + 2.45 * MENU_BEAT, gain_db=-36.0, pan=0.06, verb=0.05)
        if b in (7, 11, 15):
            # A little fifth at the turnaround.
            fifth = ae.pluck_bass(ae.hz(root) * 2.0 * 2 ** (7 / 12), 0.45, seed=b + 140)
            sc.add("bass", fifth, b * bar + 3.48 * MENU_BEAT, gain_db=-38.0, pan=-0.08, verb=0.05)

    # Brushed percussion enters after two bars.
    for b in range(2, 16):
        start = b * bar
        # Shaker on eighths, soft and human.
        for k in range(8):
            t = start + k * (MENU_BEAT / 2) + float(sc.rng.normal(0, 0.0018))
            accent = 0.9 if k in (1, 3, 5, 7) else (-1.2 if k in (0, 4) else -3.2)
            add_shaker(sc, t, gain_db=-38.0 + accent, pan=(-0.1 if k % 2 else 0.12))
        # Soft maqsum-inspired darbuka.
        pattern = (
            (0.0, "dum", -27.0), (1.0, "tak", -33.0), (1.5, "tak", -34.0),
            (2.0, "dum", -28.0), (2.5, "tak", -34.5), (3.0, "tak", -33.5),
        )
        if b in (3, 7, 11, 15):
            pattern = pattern + ((3.5, "tak", -31.0),)
        for beat, kind, level in pattern:
            t = start + beat * MENU_BEAT
            if kind == "dum":
                add_darbuka_dum(sc, t, gain_db=level, pan=-0.02, soft=True)
            else:
                add_darbuka_tak(sc, t, gain_db=level, pan=(0.18 if beat % 1 else -0.15))
        # Feather-soft frame-drum brush on 2 and 4.
        if b >= 4:
            for beat in (1.0, 3.0):
                sig = ae.noise_band(int(0.16 * ae.SR), 500, 2400, seed=int(sc.rng.integers(1, 2**31 - 1)), order=2)
                sig *= np.exp(-np.arange(sig.size) / (0.04 * ae.SR))
                sc.add("perc", sig, start + beat * MENU_BEAT, gain_db=-43.0, pan=0.22, verb=0.1)

    # Turnaround sparkle and a breath right before the loop seam.
    add_bell(sc, 15 * bar + 3.3 * MENU_BEAT, "A5", dur=2.0, gain_db=-27.0, pan=0.28, verb=0.55, delay=0.2, bus="air")
    add_bell(sc, 15 * bar + 3.7 * MENU_BEAT, "E6", dur=1.4, gain_db=-33.0, pan=-0.24, verb=0.65, delay=0.22, bus="air")

    for b in range(16):
        if b % 4 == 0:
            # Barely audible sub bloom at the top of each phrase.
            bloom = ae.sub_bass(ae.hz(MENU_BASS_ROOTS[b]) / 2.0, 1.0, attack=0.15, release=0.4)
            sc.add("bass", bloom, b * bar, gain_db=-40.0, pan=0.0, verb=0.0)

    ir = ae.make_impulse_response(2.5, decay=0.62, predelay_ms=26, seed=990, brightness=6200)
    pre = sc.finish(
        ir=ir, verb_rms=0.38, delay_s=0.75 * MENU_BEAT, delay_wet=0.16,
        bus_gains_db={"pad": -0.5, "arp": 4.0, "melody": -1.2, "air": 6.0, "bass": 0.5, "perc": 7.0},
    )

    # Master EQ and a whisper of harmonic richness.
    pre = ae.filt(pre, "highpass", 30.0, 2)
    b, a = ae.bell_biquad(440.0, -1.25, 0.9)
    pre = signal.lfilter(b, a, pre, axis=-1)
    b, a = ae.bell_biquad(3200.0, 1.1, 0.8)
    pre = signal.lfilter(b, a, pre, axis=-1)
    b, a = ae.bell_biquad(2200.0, 0.7, 1.1)
    pre = signal.lfilter(b, a, pre, axis=-1)
    b, a = ae.high_shelf(7200.0, 1.8, 0.7)
    pre = signal.lfilter(b, a, pre, axis=-1)
    warm = np.tanh(pre * 1.18) / math.tanh(1.18)
    pre = pre + 0.04 * (warm - pre)
    pre = stereo_width(pre, 1.10)
    pre = ae.fade_edges(pre, int(0.002 * ae.SR), 0)

    mastered = master_to_lufs(pre, target_lufs=-16.0, ceiling_db=-1.9, loop_n=MENU_N, loop_xfade=LOOP_GUARD)
    stats = track_stats(mastered, MENU_N, "menu-theme", MENU_BPM)
    return mastered, stats


# ---------------------------------------------------------------------------
# Battle: 112 BPM, 16 bars, playful action
# ---------------------------------------------------------------------------
BATTLE_BAR_CHORDS = [
    "Dm", "Bb", "Dm", "C", "Dm", "Bb", "F", "A",
    "Bb", "C", "Dm", "A", "Gm", "Bb", "C", "A",
]
BATTLE_CHORD_NOTES = {
    "Dm": ("D3", "F3", "A3", "E4"),
    "Bb": ("Bb2", "D3", "F3", "A3"),
    "F": ("F3", "A3", "C4", "E4"),
    "C": ("C3", "E3", "G3", "D4"),
    "A": ("A2", "C#4", "E4", "G4"),
    "Gm": ("G3", "Bb3", "D4", "F4"),
}
BATTLE_ROOTS = ["D2", "Bb1", "D2", "C2", "D2", "Bb1", "F2", "A2", "Bb1", "C2", "D2", "A2", "G2", "Bb1", "C2", "A2"]
BATTLE_ARP_POOLS = {
    "Dm": ("D3", "F3", "A3", "D4", "E4", "A4", "F4", "D4"),
    "Bb": ("Bb3", "D4", "F4", "Bb4", "A4", "F4", "D4", "Bb3"),
    "F": ("F3", "A3", "C4", "F4", "G4", "A4", "E4", "C4"),
    "C": ("C3", "E3", "G3", "C4", "D4", "G4", "E4", "C4"),
    "A": ("A2", "C#4", "E4", "A4", "G4", "E4", "C#4", "A3"),
    "Gm": ("G3", "Bb3", "D4", "G4", "A4", "D4", "Bb3", "G3"),
}

# (bar, beat, note, hold beats)
BATTLE_MELODY = [
    (0, 0.0, "A4", 0.5), (0, 0.5, "D5", 0.5), (0, 1.0, "F5", 0.5), (0, 1.75, "E5", 1.2),
    (0, 3.0, "D5", 0.45), (0, 3.5, "F5", 0.45),
    (1, 0.0, "F5", 0.45), (1, 0.5, "A5", 0.45), (1, 1.0, "G5", 0.45), (1, 1.75, "F5", 1.2),
    (1, 3.0, "D5", 0.45), (1, 3.5, "C5", 0.45),
    (2, 0.0, "C5", 0.45), (2, 0.5, "F5", 0.45), (2, 1.0, "A5", 0.55), (2, 1.75, "G5", 0.8),
    (2, 2.5, "F5", 0.45), (2, 3.0, "E5", 0.7),
    (3, 0.0, "E5", 0.55), (3, 0.5, "G5", 0.5), (3, 1.0, "F5", 0.45), (3, 1.75, "E5", 1.0),
    (3, 2.5, "D5", 0.45), (3, 3.0, "C5", 0.8), (3, 3.5, "D5", 0.5),
    (4, 0.0, "A4", 0.5), (4, 0.5, "D5", 0.5), (4, 1.0, "F5", 0.5), (4, 1.75, "E5", 1.2),
    (4, 3.0, "A5", 0.5), (4, 3.5, "G5", 0.4),
    (5, 0.0, "F5", 0.5), (5, 0.5, "A5", 0.5), (5, 1.0, "G5", 0.5), (5, 1.75, "F5", 1.0),
    (5, 2.5, "D5", 0.45), (5, 3.0, "E5", 0.45), (5, 3.5, "F5", 0.4),
    (6, 0.0, "A5", 0.5), (6, 0.5, "G5", 0.4), (6, 1.0, "F5", 0.5), (6, 1.5, "E5", 0.8),
    (6, 2.5, "D5", 0.4), (6, 3.0, "C5", 0.45), (6, 3.5, "A4", 0.8),
    (7, 0.0, "C#5", 0.65), (7, 0.75, "E5", 0.5), (7, 1.25, "A5", 0.5), (7, 1.75, "G5", 0.8),
    (7, 2.5, "E5", 0.45), (7, 3.0, "C#5", 0.9),
    (8, 0.0, "D5", 0.5), (8, 0.5, "F5", 0.5), (8, 1.0, "A5", 0.5), (8, 1.75, "G5", 0.9),
    (8, 2.5, "F5", 0.45), (8, 3.0, "D5", 0.45), (8, 3.5, "C5", 0.4),
    (9, 0.0, "E5", 0.45), (9, 0.5, "G5", 0.45), (9, 1.0, "A5", 0.6), (9, 1.75, "G5", 0.8),
    (9, 2.5, "E5", 0.45), (9, 3.0, "D5", 0.45), (9, 3.5, "C5", 0.45),
    (10, 0.0, "A5", 0.35), (10, 0.5, "D6", 0.35), (10, 1.0, "F6", 0.4), (10, 1.5, "E6", 1.0),
    (10, 3.0, "D6", 0.5), (10, 3.5, "C6", 0.4),
    (11, 0.0, "A5", 0.5), (11, 0.5, "G5", 0.45), (11, 1.0, "E5", 0.5), (11, 1.75, "C#5", 0.9),
    (11, 2.5, "A4", 0.45), (11, 3.0, "C#5", 0.5), (11, 3.5, "E5", 0.6),
    (12, 0.0, "G4", 0.5), (12, 0.5, "Bb4", 0.5), (12, 1.0, "D5", 0.5), (12, 1.75, "G5", 0.9),
    (12, 2.5, "F5", 0.45), (12, 3.0, "D5", 0.45), (12, 3.5, "Bb4", 0.45),
    (13, 0.0, "D5", 0.5), (13, 0.5, "F5", 0.5), (13, 1.0, "A5", 0.55), (13, 1.75, "G5", 0.8),
    (13, 2.5, "F5", 0.45), (13, 3.0, "D5", 0.45), (13, 3.5, "C5", 0.45),
    (14, 0.0, "E5", 0.5), (14, 0.5, "G5", 0.5), (14, 1.0, "A5", 0.6), (14, 1.75, "G5", 0.75),
    (14, 2.5, "E5", 0.5), (14, 3.0, "D5", 0.5), (14, 3.5, "C5", 0.4),
    (15, 0.0, "A4", 0.6), (15, 0.5, "C#5", 0.5), (15, 1.0, "E5", 0.5), (15, 1.75, "A5", 1.4),
    (15, 3.0, "G5", 0.4), (15, 3.5, "E5", 0.4),
]


def render_battle() -> tuple[np.ndarray, dict]:
    n = BATTLE_N + LOOP_GUARD
    sc = Score(n, seed=11201, loop_continuation_n=BATTLE_N)
    bar = BATTLE_BAR

    # --- Harmonic bed ------------------------------------------------------
    for b, key in enumerate(BATTLE_BAR_CHORDS):
        notes = BATTLE_CHORD_NOTES[key]
        # The pad opens up across the 16-bar arc.
        level = -25.0 if b < 4 else (-23.3 if b < 8 else (-22.0 if b < 12 else -21.6))
        add_pad(
            sc, b * bar, notes, dur=bar + 0.35, gain_db=level, attack=0.16, release=0.55,
            cutoff=1500 if b < 4 else 2100, verb=0.28, bus="pad", seed=2900 + b, detune=8.0,
        )
    for b in (3, 7, 11, 15):
        # A warm string shadow at each transition (3 beats long).
        notes = BATTLE_CHORD_NOTES[BATTLE_BAR_CHORDS[b]] + ("A4",)
        add_strings(sc, b * bar, notes, dur=bar * 0.8, gain_db=-31.0, attack=0.28, release=0.4, verb=0.22, bus="strings")

    # --- Kick/percussion grid ---------------------------------------------
    kick_plan = []
    for b in range(16):
        if b < 4:
            beats = (0.0, 1.5, 2.5, 3.25)
        elif b < 8:
            beats = (0.0, 1.0, 2.0, 2.75, 3.5)
        elif b < 12:
            beats = (0.0, 1.0, 2.0, 3.0, 3.75 if b % 2 else 3.5)
        else:
            beats = (0.0, 1.0, 2.0, 3.0, 3.5)
        if b in (3, 7, 11, 15):
            beats = tuple(sorted(set(beats + (3.75,))))
        for beat in beats:
            if beat >= 4.0:
                continue
            # The extra 3.75 in the last bar is handled as a fill below.
            if b == 15 and beat == 3.75:
                continue
            kick_plan.append((b * bar + beat * BATTLE_BEAT, b))

    for t, b in kick_plan:
        level = -22.5 if b < 8 else -21.5
        if t == 0.0:
            level = -20.0
        if b in (3, 7, 11, 15) and abs((t - b * bar) - bar + 0.25 * BATTLE_BEAT) < 0.01:
            level -= 1.0
        sc.add_kick(t, gain_db=level, pan=0.0, duration=0.45, punch=0.8, low_hz=50, high_hz=138, decay_s=0.155)

    # Sidechain the pad and a touch of the bass.
    sc.sidechain("pad", depth_db=3.4, attack_s=0.006, release_s=0.16)
    sc.sidechain("bass", depth_db=1.4, attack_s=0.006, release_s=0.12)

    for b in range(16):
        start = b * bar
        # Claps on 2 and 4, slightly different width each time.
        for beat in (1.0, 3.0):
            add_clap(sc, start + beat * BATTLE_BEAT, gain_db=-26.0 if b < 8 else -24.5, pan=-0.08, soft=True)
        # Hats: closed eighths with offbeat emphasis.
        hat_count = 16 if b >= 8 else 8
        for k in range(hat_count):
            beat = k * (4.0 / hat_count)
            t = start + beat * BATTLE_BEAT
            if b < 8:
                level = -35.0 if k % 2 else -38.0
            else:
                level = -33.0 if k % 2 else -36.5
            add_hat(sc, t, gain_db=level, pan=0.12 if k % 2 else -0.18)
        # Darbuka maqsum + loose fills.
        darbuka_pattern = (
            (0.0, "dum", -27.5), (0.5, "tak", -34.0), (1.5, "tak", -33.0),
            (2.0, "dum", -28.0), (3.0, "tak", -33.5), (3.5, "tak", -35.0),
        )
        for beat, kind, level in darbuka_pattern:
            t = start + beat * BATTLE_BEAT
            if kind == "dum":
                add_darbuka_dum(sc, t, gain_db=level, pan=-0.02, soft=False)
            else:
                add_darbuka_tak(sc, t, gain_db=level, pan=0.22 if (beat * 2) % 2 else -0.2)
        if b in (3, 7, 11, 15):
            for k, beat in enumerate((2.75, 3.0, 3.25, 3.75)):
                add_darbuka_tak(sc, start + beat * BATTLE_BEAT, gain_db=-30.5 + k * 0.7, pan=(-0.4 if k % 2 else 0.35), slap=(k == 3))
            add_open_hat = True
        else:
            add_open_hat = False
        if b % 2 == 1:
            add_hat(sc, start + 3.5 * BATTLE_BEAT, gain_db=-31.0, pan=0.3, open_=True)
        if b >= 4:
            for k in range(8):
                # Low shaker bed in sixteenths only in the hotter half.
                if b < 8 and k % 2:
                    continue
                add_shaker(sc, start + (k * 0.5) * BATTLE_BEAT, gain_db=-39.5 + (1.0 if k % 2 else 0.0), pan=-0.16 if k % 2 else 0.18)
        # A soft card-flip tick in the stereo gaps.
        if b not in (0, 1):
            for beat in (0.75, 2.25):
                tick = ae.card_flip(seed=int(sc.rng.integers(1, 2**31 - 1)))
                sc.add("perc", tick, start + beat * BATTLE_BEAT, gain_db=-34.0, pan=0.36 if beat < 1 else -0.35, verb=0.15, delay=0.05)

    # --- Bass -------------------------------------------------------------
    bass_pattern = (
        (0.0, 0, "root", 0.38), (0.75, 0, "root", 0.22), (1.5, 7, "fifth", 0.23),
        (2.0, 0, "root", 0.35), (2.75, 12, "octave", 0.22), (3.5, 7, "fifth", 0.18),
    )
    for b in range(16):
        root_name = BATTLE_ROOTS[b]
        root = ae.hz(root_name)
        for beat, semis, kind, dur_s in bass_pattern:
            if b in (0, 1) and beat in (2.75,):
                continue
            f = root * (2 ** (semis / 12))
            sig = ae.sub_bass(f, dur_s, attack=0.008, release=0.09, drive=1.45)
            level = -29.5 if b < 8 else -28.5
            sc.add("bass", sig, b * bar + beat * BATTLE_BEAT, gain_db=level, pan=0.0, verb=0.03)
            upper = ae.pluck_bass(f * 2.0, dur_s * 0.95, seed=5000 + b * 13 + int(beat * 100))
            sc.add("bass", upper, b * bar + beat * BATTLE_BEAT, gain_db=level - 5.5, pan=0.04, verb=0.03)
        if b in (7, 15):
            # A pickup fill note under the transition.
            f = root * 2 ** (7 / 12)
            sig = ae.sub_bass(f, 0.18, attack=0.005, release=0.08, drive=1.4)
            sc.add("bass", sig, b * bar + 3.78 * BATTLE_BEAT, gain_db=-31.0, pan=0.0, verb=0.02)

    # --- Arpeggio & hook --------------------------------------------------
    for b, key in enumerate(BATTLE_BAR_CHORDS):
        pool = BATTLE_ARP_POOLS[key]
        if b < 8:
            positions = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5]
        else:
            positions = [k * 0.25 for k in range(16)]
        order = (0, 1, 2, 3, 2, 4, 3, 5, 4, 2, 3, 1, 2, 4, 3, 1)
        for k, beat in enumerate(positions):
            idx = order[k % len(order)]
            level = (-31.0 if b < 8 else -33.0) + (1.0 if k % 4 == 0 else 0.0)
            if b < 8 and k == 7:
                continue
            seed = int(sc.rng.integers(1, 2_000_000_000))
            sig = ae.additive_pluck(
                ae.hz(pool[idx]), 0.48 if b >= 8 else 0.65,
                brightness=0.75, decay=0.55, seed=seed, tone="harp",
            )
            pan = (-0.46 if k % 2 == 0 else 0.46) if b < 8 else (-0.55 if (k // 4) % 2 == 0 else 0.55)
            sc.add("arp", sig, b * bar + beat * BATTLE_BEAT, gain_db=level, pan=pan, verb=0.12, delay=0.12)
        # A bell stab / charm on the top of every other bar.
        if b % 2 == 1:
            add_bell(
                sc, b * bar + 2.5 * BATTLE_BEAT, ("A5", "D6", "F5", "C6")[(b // 2) % 4],
                dur=1.2, gain_db=-29.0, pan=(0.2 if b % 4 == 1 else -0.2), verb=0.4, delay=0.2, bus="bell",
                shimmer=0.25,
            )

    for b, beat, note, held in BATTLE_MELODY:
        t = b * bar + beat * BATTLE_BEAT
        # Hook gets wider and brighter as the loop builds.
        level = -17.0 if b < 8 else -16.0
        if note in ("D6", "E6", "F6"):
            level -= 1.4
        seed = int(sc.rng.integers(1, 2_000_000_000))
        sig = ae.additive_pluck(
            ae.hz(note), min(1.8, 0.55 + held * BATTLE_BEAT),
            brightness=0.56, decay=0.95, seed=seed, tone="harp",
        )
        sc.add("lead", sig, t, gain_db=level, pan=0.08 if b % 4 < 2 else -0.08, verb=0.3, delay=0.22)
        if held >= 0.8:
            add_bell(sc, t, note, dur=1.4, gain_db=-27.0, pan=-0.18 if b % 2 else 0.18, verb=0.5, delay=0.22, bus="bell")

    # --- Cinematic stingers every 4 bars --------------------------------
    for b, strength in ((0, 1.0), (4, 0.82), (8, 1.0), (12, 1.16)):
        t = b * bar
        if b > 0:
            # Noise riser ending exactly on the boundary.
            sw = ae.reverse_swell(0.72, amp=0.7 * strength, seed=700 + b)
            sc.add("fx", sw, t - 0.70, gain_db=-24.0, pan=-0.1, verb=0.22)
            imp = ae.drop_impact(1.5, amp=0.9 * strength, seed=710 + b, deep=True)
            sc.add("fx", imp, t, gain_db=-22.0, pan=0.0, verb=0.2)
        else:
            imp = ae.drop_impact(1.5, amp=0.85, seed=719, deep=True)
            sc.add("fx", imp, 0.0, gain_db=-22.0, pan=0.0, verb=0.16)
        # Handbell sparkle on the stinger.
        for k, note in enumerate(("A5", "D6", "F6")):
            add_bell(sc, t + 0.012 * k, note, dur=1.3, gain_db=-30.0 - k * 1.0, pan=(-0.4 + 0.4 * k), verb=0.55, delay=0.22, bus="bell", shimmer=0.3)
    # Whoosh at the two biggest lifts.
    for t, pan in ((8 * bar, -0.3), (12 * bar, 0.25)):
        wh = ae.whoosh(0.95, seed=int(t * 10) + 3)
        sc.add("fx", wh, t - 0.10, gain_db=-26.0, pan=pan, verb=0.25)

    # Per-bar little bell answers in the second half.
    for b in range(8, 16, 2):
        add_bell(sc, b * bar + 3.2 * BATTLE_BEAT, ("E6", "D6")[(b // 2) % 2], dur=1.2, gain_db=-31.0, pan=-0.3, verb=0.45, delay=0.2, bus="bell", shimmer=0.25)

    # Last-bar fill and a soft reversed inhale across the loop seam.
    for k in range(8):
        beat = 3.0 + k * 0.125
        add_darbuka_tak(sc, 15 * bar + beat * BATTLE_BEAT, gain_db=-30.0 + k * 0.7, pan=(-0.35 + 0.1 * k), slap=(k >= 5))
    fill_sw = ae.reverse_swell(0.55, amp=0.5, seed=733)
    sc.add("fx", fill_sw, 16 * bar - 0.52, gain_db=-29.0, pan=0.0, verb=0.25)
    glint = ae.cat_glint(1.2, amp=0.4, seed=744)
    sc.add("fx", glint, 15 * bar + 2.2 * BATTLE_BEAT, gain_db=-33.0, pan=0.0, verb=0.4)

    ir = ae.make_impulse_response(1.75, decay=0.42, predelay_ms=18, seed=1190, brightness=7200)
    pre = sc.finish(
        ir=ir, verb_rms=0.27, delay_s=0.75 * BATTLE_BEAT, delay_wet=0.16, delay_feedback=0.29,
        bus_gains_db={"pad": -0.5, "strings": 4.0, "arp": 8.0, "perc": -0.5, "bass": -1.0, "lead": -1.0, "bell": 1.0, "fx": 1.5},
    )
    pre = ae.filt(pre, "highpass", 33.0, 2)
    b, a = ae.low_shelf(110.0, -0.7, 0.8)
    pre = signal.lfilter(b, a, pre, axis=-1)
    b, a = ae.bell_biquad(230.0, -1.1, 0.9)
    pre = signal.lfilter(b, a, pre, axis=-1)
    b, a = ae.bell_biquad(3600.0, 1.0, 0.8)
    pre = signal.lfilter(b, a, pre, axis=-1)
    b, a = ae.high_shelf(6800.0, 1.5, 0.7)
    pre = signal.lfilter(b, a, pre, axis=-1)
    # A little tape weight makes the kick feel round, not clipped.
    warm = np.tanh(pre * 1.25) / math.tanh(1.25)
    pre = pre + 0.05 * (warm - pre)
    pre = stereo_width(pre, 1.12)
    pre = ae.fade_edges(pre, int(0.002 * ae.SR), 0)

    mastered = master_to_lufs(pre, target_lufs=-15.0, ceiling_db=-2.0, loop_n=BATTLE_N, loop_xfade=LOOP_GUARD)
    stats = track_stats(mastered, BATTLE_N, "battle-theme", BATTLE_BPM)
    return mastered, stats


# ---------------------------------------------------------------------------
# Trailer: 100 BPM, 44.8 s, D minor / Nahawand with Hijaz-tinged C#/Bb
# ---------------------------------------------------------------------------
MEOW_MIDI = (69, 74, 77, 76)  # A4 D5 F5 E5: the four-note "meow" cell


def make_section_automation(n: int, *, fs: int = ae.SR) -> np.ndarray:
    """Cinematic music-bed automation for the trailer (dB over time).

    Hand-authored so the intro is intimate, the middle breathes with the VO,
    the montage builds, the dedication opens up, and the final lift is allowed
    to be the loudest moment.  SFX and VO are deliberately not included.
    """
    points = (
        (0.0, -6.0), (2.30, -6.0), (2.40, -3.5), (3.30, -3.2), (4.80, -3.5),
        (7.10, -3.5), (7.20, -3.0), (9.60, -3.0), (11.80, -2.7), (12.00, -1.0),
        (16.80, -0.5), (19.00, 0.0), (19.20, 0.0), (23.90, 0.2), (24.00, 1.0),
        (26.40, 1.2), (28.70, 1.2), (28.80, -2.0), (33.50, -2.0), (33.60, -5.0),
        (35.90, -5.0), (36.00, 0.5), (38.40, 0.7), (40.70, 0.7), (40.80, 0.0),
        (41.00, -2.0), (44.80, -2.3),
    )
    times = np.asarray([p[0] for p in points], dtype=np.float64)
    gains = np.asarray([p[1] for p in points], dtype=np.float64)
    t = np.arange(n, dtype=np.float64) / fs
    return np.interp(t, times, gains)


def make_voice_space_automation(n: int, *, fs: int = ae.SR) -> np.ndarray:
    """Extra local score thinning under the densest narration lines.

    This is arrangement/mix automation on the music bed, in addition to the
    explicit 6 dB voice duck.  It gives the two busiest lines (F and I) a little
    more air without making the narration itself jump in level.
    """
    points = (
        (0.0, 0.0), (23.95, 0.0), (24.20, -2.6), (27.00, -2.6), (27.55, 0.0),
        (36.90, 0.0), (37.10, -4.0), (39.60, -4.0), (40.15, 0.0), (44.80, 0.0),
    )
    times = np.asarray([p[0] for p in points], dtype=np.float64)
    gains = np.asarray([p[1] for p in points], dtype=np.float64)
    t = np.arange(n, dtype=np.float64) / fs
    return np.interp(t, times, gains)


def make_duck_envelope(
    n: int,
    manifests: Sequence[dict],
    *,
    depth_db: float,
    pre_s: float = 0.14,
    attack_s: float = 0.10,
    release_s: float = 0.32,
    fs: int = ae.SR,
) -> np.ndarray:
    env = np.ones(n, dtype=np.float64)
    target = ae.db_to_gain(-depth_db)
    for item in manifests:
        a = int(round((item["start"] - pre_s) * fs))
        b = int(round(item["start"] * fs))
        c = int(round(item["end"] * fs))
        d = int(round((item["end"] + release_s) * fs))
        a = max(0, a)
        b = max(a, min(n, b))
        c = max(b, min(n, c))
        d = max(c, min(n, d))
        # Smooth anticipation and release.  The gain reaches target exactly at
        # the first phoneme and only releases after the phrase has ended.
        if b > a:
            ramp = 0.5 - 0.5 * np.cos(np.linspace(0.0, math.pi, b - a))
            env[a:b] = np.minimum(env[a:b], 1.0 + (target - 1.0) * ramp)
        if c > b:
            env[b:c] = np.minimum(env[b:c], target)
        if d > c:
            ramp = 0.5 + 0.5 * np.cos(np.linspace(0.0, math.pi, d - c))
            env[c:d] = np.minimum(env[c:d], target + (1.0 - target) * ramp)
    return env


def render_trailer(manifests: list[dict] | None = None) -> tuple[np.ndarray, dict, list[dict]]:
    if manifests is None:
        manifests = voice.process_voice_lines()
    n = TRAILER_N
    sc = Score(n, seed=14001)
    cues: list[dict] = []
    b = TRAILER_BAR
    beat = TRAILER_BEAT

    def sec(t: float, label: str) -> None:
        add_cue(cues, t, "section", label)

    def fx_cue(t: float, type_: str, label: str) -> None:
        add_cue(cues, t, type_, label)

    # =====================================================================
    # 0.0–2.4  Dark, intimate intro: sub drone, distant sparkle, heartbeat,
    # cat-eye glint and a reverse swell into the title.
    # =====================================================================
    sec(0.0, "Intro — dark intimate, distant sparkle, heartbeat / مقدمة هادئة")
    dr = ae.sub_bass(ae.hz("D1"), 2.55, attack=0.28, release=0.35, drive=1.15)
    sc.add("bass", dr, 0.0, gain_db=-27.0, pan=0.0, verb=0.18)
    dr2 = ae.sub_bass(ae.hz("D2"), 2.45, attack=0.38, release=0.45, drive=1.1)
    sc.add("bass", dr2, 0.015, gain_db=-31.0, pan=0.0, verb=0.22)
    add_pad(
        sc, 0.0, ("D2", "A2", "D3", "F3"), dur=2.55, gain_db=-20.5,
        attack=0.55, release=0.55, cutoff=850, verb=0.52, bus="pad", seed=8101,
    )
    add_strings(
        sc, 0.02, ("D3", "A3", "F4"), dur=2.4, gain_db=-35.0,
        attack=0.9, release=0.55, cutoff=1800, verb=0.42, bus="pad",
    )
    add_bell(sc, 0.35, "D6", dur=4.0, gain_db=-33.0, pan=0.52, verb=0.85, delay=0.12, bus="keys", shimmer=0.9)
    add_bell(sc, 1.18, "A6", dur=3.8, gain_db=-35.0, pan=-0.48, verb=0.9, delay=0.18, bus="keys", shimmer=0.9)
    add_bell(sc, 1.62, "F6", dur=3.0, gain_db=-39.0, pan=0.30, verb=0.9, delay=0.2, bus="keys", shimmer=1.0)
    # Heartbeat is intentionally felt more than heard.
    trailer_sfx(sc, 0.28, ae.heartbeat(amp=0.82), gain_db=-18.5)
    trailer_sfx(sc, 1.22, ae.heartbeat(amp=0.62), gain_db=-21.0)
    fx_cue(0.3, "heartbeat", "First heartbeat / نبضة")
    fx_cue(1.2, "heartbeat", "Second heartbeat / نبضة ثانية")
    glint = ae.cat_glint(1.65, amp=0.55, seed=812)
    trailer_sfx(sc, 1.767, glint, gain_db=-24.0)
    fx_cue(1.767, "glint", "Cat-eye glint / لمعة عين القطة")
    sw = ae.reverse_swell(1.15, amp=0.55, seed=813)
    trailer_sfx(sc, 1.30, sw, gain_db=-26.0, pan=-0.12)
    fx_cue(1.3, "riser", "Reverse swell into title reveal / تصعيد عكسي")
    # A low, dark heartbeat thump under the final approach.
    thump = ae.kick(0.8, punch=0.45, low_hz=40, high_hz=70, decay_s=0.34, seed=814)
    trailer_sfx(sc, 1.98, thump, gain_db=-34.0)
    add_pad(
        sc, 2.02, ("D2", "A2", "E3"), dur=0.40, gain_db=-32.0,
        attack=0.1, release=0.2, cutoff=650, verb=0.2, bus="pad", seed=815,
    )

    # =====================================================================
    # 2.4–4.8  Cat eyes open / title reveal: magical impact + pluck motif,
    # no heavy drums.
    # =====================================================================
    sec(2.4, "Cat eyes open / title reveal — magical impact & meow motif / افتتاح العنوان")
    imp = ae.drop_impact(2.0, amp=0.95, seed=820, deep=True, bright=1.1)
    trailer_sfx(sc, 2.4, imp, gain_db=-16.0)
    fx_cue(2.4, "impact", "Title reveal magical impact / صدمة سحرية")
    glint2 = ae.cat_glint(2.1, amp=0.7, seed=821)
    trailer_sfx(sc, 2.4, glint2, gain_db=-21.0)
    add_pad(
        sc, 2.4, ("D3", "F3", "A3", "E4"), dur=2.7, gain_db=-19.0,
        attack=0.28, release=0.55, cutoff=3100, verb=0.48, bus="pad", seed=822,
    )
    add_strings(
        sc, 2.4, ("D3", "A3", "F4"), dur=2.55, gain_db=-33.0,
        attack=0.55, release=0.5, cutoff=2600, verb=0.4, bus="pad",
    )
    bassd = ae.sub_bass(ae.hz("D2"), 2.35, attack=0.2, release=0.3, drive=1.1)
    sc.add("bass", bassd, 2.4, gain_db=-31.0, pan=0.0, verb=0.15)
    # The brand motif is deliberately unadorned here.
    for i, midi in enumerate(MEOW_MIDI):
        t = 2.4 + i * 0.105
        trailer_pluck(
            sc, t, midi, gain_db=-16.5, pan=(-0.26 + 0.17 * i),
            dur=1.5, brightness=0.55, decay=1.4, verb=0.46, delay=0.17,
        )
        if i in (0, 3):
            add_bell(sc, t, midi + 12, dur=2.7, gain_db=-28.0, pan=(0.25 if i else -0.2), verb=0.7, delay=0.2, bus="keys", shimmer=0.55)
    # Airy celestial answer at the end of the title bar.
    for k, note in enumerate(("F5", "A5", "D6", "F6")):
        add_bell(sc, 3.22 + k * 0.16, note, dur=2.2, gain_db=-35.0 + 1.2 * k, pan=0.22 - 0.12 * k, verb=0.75, delay=0.2, bus="keys", shimmer=0.7)
    sw2 = ae.reverse_swell(0.48, amp=0.36, seed=823)
    trailer_sfx(sc, 4.32, sw2, gain_db=-32.0)
    fx_cue(4.32, "riser", "Short reverse swell into logo / تصعيد قصير")

    # =====================================================================
    # 4.8–7.2  Logo reveal / tagline: warm chord swell, soft pulse starts.
    # =====================================================================
    sec(4.8, "Logo reveal / tagline — warm chord swell, soft pulse / الشعار والشعار النصي")
    add_pad(
        sc, 4.8, ("Bb2", "D3", "F3", "A3", "D4"), dur=2.6, gain_db=-19.5,
        attack=0.50, release=0.50, cutoff=3900, verb=0.46, bus="pad", seed=830,
    )
    add_strings(
        sc, 4.8, ("Bb2", "F3", "D4", "A4"), dur=2.45, gain_db=-30.0,
        attack=0.55, release=0.55, cutoff=4200, verb=0.45, bus="pad",
    )
    for note, level in (("Bb2", -30.0), ("F3", -32.0), ("D4", -34.0)):
        add_piano(sc, 4.8, note, dur=2.6, gain_db=level, pan=(-0.18 if note == "Bb2" else 0.16), verb=0.5, bus="keys")
    sc.add("bass", ae.sub_bass(ae.hz("Bb1"), 1.15, attack=0.05, release=0.18, drive=1.2), 4.8, gain_db=-30.0, pan=0.0, verb=0.1)
    sc.add("bass", ae.sub_bass(ae.hz("F2"), 1.05, attack=0.05, release=0.18, drive=1.2), 6.0, gain_db=-32.0, pan=0.0, verb=0.1)
    for t in (4.8, 6.0):
        sc.add_kick(t, gain_db=-27.0, pan=0.0, duration=0.4, punch=0.55, low_hz=54, high_hz=118, decay_s=0.14)
    add_bell(sc, 5.15, "D5", dur=2.2, gain_db=-33.0, pan=0.15, verb=0.6, delay=0.15, bus="keys", shimmer=0.35)
    add_bell(sc, 6.3, "F5", dur=2.0, gain_db=-35.0, pan=-0.18, verb=0.65, delay=0.15, bus="keys", shimmer=0.4)
    # A soft transition into the menu montage.
    wh = ae.whoosh(0.75, amp=0.35, seed=831, reverse=True)
    trailer_sfx(sc, 7.06, wh, gain_db=-34.0, pan=-0.2)
    fx_cue(7.06, "whoosh", "Soft whoosh into menu showcase / انتقال إلى القائمة")

    # =====================================================================
    # 7.2–12.0  Menu showcase: light groove, plucks and bells.
    # =====================================================================
    sec(7.2, "Menu showcase — light groove, oud/harp plucks & bells / استعراض القائمة")
    for start, chord, root in (
        (7.2, ("D3", "F3", "A3", "E4"), "D2"),
        (9.6, ("Bb2", "D3", "F3", "A3"), "Bb1"),
    ):
        add_pad(
            sc, start, chord, dur=2.45, gain_db=-22.4, attack=0.18, release=0.4,
            cutoff=2700, verb=0.34, bus="pad", seed=int(1000 + start * 10),
        )
        sc.add("bass", ae.sub_bass(ae.hz(root), 2.25, attack=0.025, release=0.2, drive=1.25), start, gain_db=-32.0, pan=0.0, verb=0.06)
        for k in range(8):
            add_shaker(sc, start + k * 0.3 + float(sc.rng.normal(0, 0.002)), gain_db=(-37.0 if k % 2 else -39.0), pan=(-0.12 if k % 2 else 0.14))
        for k, beatpos in enumerate((0.0, 2.0, 3.5)):
            add_darbuka_dum(sc, start + beatpos * beat, gain_db=-31.0, pan=-0.04, soft=True)
        for beatpos in (0.75, 1.5, 2.75, 3.25):
            add_darbuka_tak(sc, start + beatpos * beat, gain_db=-37.0, pan=0.16 if beatpos < 2 else -0.2)
        # Light bass pulse.
        for beatpos in (0.0, 1.5, 2.5):
            sig = ae.pluck_bass(ae.hz(root) * 2.0, 0.45, seed=int(sc.rng.integers(1, 2**31 - 1)))
            sc.add("bass", sig, start + beatpos * beat, gain_db=-35.5, pan=0.08, verb=0.08)
        # Harp arpeggio, 8th notes, panned softly.
        pool = ("D3", "F3", "A3", "D4", "E4", "A4", "F4", "D4") if root == "D2" else ("Bb2", "D4", "F4", "A4", "Bb4", "F4", "D4", "Bb3")
        for k in range(8):
            trailer_pluck(
                sc, start + k * 0.3, pool[(k * 2 + k // 3) % len(pool)],
                gain_db=-27.5, pan=(-0.30 if k % 2 else 0.25), dur=0.9,
                brightness=0.62, decay=1.3, verb=0.34, delay=0.12,
            )
    # Sparse menu-theme bell call.
    for i, (t, note) in enumerate(((7.35, "A4"), (7.65, "D5"), (7.95, "F5"), (8.25, "E5"), (10.05, "A5"), (10.65, "G5"), (11.1, "F5"))):
        add_bell(sc, t, note, dur=2.2, gain_db=-30.0, pan=(-0.12 if i % 2 else 0.18), verb=0.58, delay=0.16, bus="keys", shimmer=0.35)
    # Light kick pulse.
    for t in (7.2, 8.4, 9.6, 10.8):
        sc.add_kick(t, gain_db=-31.5, pan=0.0, duration=0.35, punch=0.5, low_hz=56, high_hz=110, decay_s=0.12)
    # Build into the first gameplay beat.
    r = ae.riser(0.6, amp=0.34, seed=844, start_hz=70, end_hz=650)
    trailer_sfx(sc, 11.4, r, gain_db=-29.0, pan=0.15)
    fx_cue(11.4, "riser", "Riser into first gameplay / تصعيد إلى اللعب")

    # =====================================================================
    # 12.0–19.2  Fruit/card montage & first gameplay: beat, darbuka,
    # syncopated card ticks, playful tension.
    # =====================================================================
    sec(12.0, "Fruit & card montage / first gameplay — beat enters / بداية اللعب")
    small_imp = ae.drop_impact(1.2, amp=0.55, seed=850, deep=False)
    trailer_sfx(sc, 12.0, small_imp, gain_db=-28.0)
    fx_cue(12.0, "hit", "Beat enters / دقة البداية")
    gameplay_bars = (
        (12.0, ("D3", "F3", "A3", "E4"), "D2", "Dm"),
        (14.4, ("Bb2", "D3", "F3", "A3"), "Bb1", "Bb"),
        (16.8, ("F3", "A3", "C4", "E4"), "F2", "F"),
    )
    for bi, (start, chord, root, key) in enumerate(gameplay_bars):
        add_pad(sc, start, chord, dur=2.45, gain_db=-24.0, attack=0.15, release=0.35, cutoff=2300, verb=0.3, bus="pad", seed=860 + bi)
        add_strings(sc, start, chord[:3], dur=2.2, gain_db=-36.0, attack=0.25, release=0.4, cutoff=3000, verb=0.25, bus="pad")
        # Playful kick/backbeat.
        for beatpos in (0.0, 1.5, 2.0, 3.0):
            sc.add_kick(start + beatpos * beat, gain_db=-24.5, pan=0.0, duration=0.38, punch=0.7, low_hz=52, high_hz=130, decay_s=0.13)
        for beatpos in (1.0, 3.0):
            add_clap(sc, start + beatpos * beat, gain_db=-29.0, pan=-0.06, soft=True)
        for k in range(8):
            add_hat(sc, start + k * 0.3, gain_db=(-35.0 if k % 2 else -38.0), pan=(0.14 if k % 2 else -0.16))
        for beatpos, kind, level in (
            (0.0, "dum", -30.0), (0.5, "tak", -36.0), (1.5, "tak", -35.0),
            (2.0, "dum", -31.0), (3.0, "tak", -36.0), (3.5, "tak", -38.0),
        ):
            if kind == "dum":
                add_darbuka_dum(sc, start + beatpos * beat, gain_db=level, pan=-0.03, soft=False)
            else:
                add_darbuka_tak(sc, start + beatpos * beat, gain_db=level, pan=(0.2 if beatpos < 2 else -0.22))
        # Bass, syncopated.
        for beatpos, semis in ((0.0, 0), (0.75, 0), (1.5, 7), (2.0, 0), (2.75, 12), (3.5, 7)):
            f = ae.hz(root) * (2 ** (semis / 12))
            sig = ae.sub_bass(f, 0.27, attack=0.007, release=0.09, drive=1.35)
            sc.add("bass", sig, start + beatpos * beat, gain_db=-32.0, pan=0.0, verb=0.04)
            upper = ae.pluck_bass(f * 2, 0.3, seed=int(sc.rng.integers(1, 2**31 - 1)))
            sc.add("bass", upper, start + beatpos * beat, gain_db=-38.0, pan=0.07, verb=0.03)
        # Syncopated card-flip ticks in stereo.
        for k, beatpos in enumerate((0.75, 1.25, 2.25, 3.25)):
            tick = ae.card_flip(seed=int(sc.rng.integers(1, 2**31 - 1)))
            sc.add("perc", tick, start + beatpos * beat, gain_db=-33.0, pan=(0.38 if k % 2 else -0.38), verb=0.12, delay=0.05)
        # Arpeggio and a bright answer.
        pool = {
            "Dm": ("D4", "F4", "A4", "D5", "E5", "A4", "F4", "D4"),
            "Bb": ("Bb3", "D4", "F4", "Bb4", "A4", "F4", "D4", "Bb3"),
            "F": ("F3", "A3", "C4", "F4", "G4", "A4", "E4", "C4"),
        }[key]
        for k in range(8):
            trailer_pluck(sc, start + k * 0.3, pool[(k * 3 + 1) % len(pool)], gain_db=-30.0, pan=(-0.42 if k % 2 else 0.42), dur=0.7, brightness=0.7, decay=0.9, verb=0.25, delay=0.1)
        if bi in (0, 2):
            for i, midi in enumerate(MEOW_MIDI):
                trailer_pluck(sc, start + 0.54 + i * 0.15, midi, gain_db=-25.0, pan=0.18, dur=0.9, brightness=0.6, decay=1.0, verb=0.35, delay=0.16)
    # Card montage accents / short bell answers at phrase ends.
    for t, note, pan in ((13.65, "A5", 0.3), (15.9, "D6", -0.25), (18.3, "E6", 0.2)):
        add_bell(sc, t, note, dur=2.0, gain_db=-32.0, pan=pan, verb=0.55, delay=0.18, bus="keys", shimmer=0.5)
    riser1 = ae.riser(1.0, amp=0.45, seed=870, start_hz=55, end_hz=850)
    trailer_sfx(sc, 18.2, riser1, gain_db=-27.0, pan=0.1)
    fx_cue(18.2, "riser", "Riser into two-player duel / تصعيد إلى المبارزة")
    # The brief explicitly asks for a whoosh at 19.2.
    wh1 = ae.whoosh(1.0, amp=0.75, seed=871)
    trailer_sfx(sc, 19.2, wh1, gain_db=-22.0, pan=0.25)
    fx_cue(19.2, "whoosh", "Duel whoosh / انتقال المبارزة")

    # =====================================================================
    # 19.2–24.0  Two-player duel: bigger percussion, stereo call/response,
    # competitive lift.
    # =====================================================================
    sec(19.2, "Two-player duel — bigger percussion & stereo call/response / المبارزة")
    duel_imp = ae.drop_impact(1.4, amp=0.65, seed=880, deep=True)
    trailer_sfx(sc, 19.2, duel_imp, gain_db=-24.0)
    for bi, (start, chord, root, key) in enumerate((
        (19.2, ("G3", "Bb3", "D4", "F4"), "G2", "Gm"),
        (21.6, ("A2", "C#4", "E4", "G4"), "A2", "A7"),
    )):
        add_pad(sc, start, chord, dur=2.45, gain_db=-23.0, attack=0.12, release=0.3, cutoff=2700, verb=0.25, bus="pad", seed=890 + bi)
        add_strings(sc, start, chord, dur=2.2, gain_db=-32.0, attack=0.18, release=0.35, cutoff=4300, verb=0.3, bus="pad")
        # Bigger, syncopated percussion.
        for beatpos in (0.0, 0.75, 1.5, 2.0, 2.75, 3.5):
            sc.add_kick(start + beatpos * beat, gain_db=(-23.5 if beatpos in (0.0, 1.5, 2.0) else -27.0), pan=0.0, duration=0.4, punch=0.75, low_hz=51, high_hz=136, decay_s=0.13)
        for beatpos in (1.0, 3.0):
            add_clap(sc, start + beatpos * beat, gain_db=-25.5, pan=(-0.1 if beatpos == 1 else 0.12), soft=False)
        for k in range(8):
            add_hat(sc, start + k * 0.3, gain_db=(-33.0 if k % 2 else -36.5), pan=(0.2 if k % 2 else -0.22))
        for beatpos in (0.0, 0.5, 1.5, 2.0, 3.0, 3.5):
            add_darbuka_dum(sc, start + beatpos * beat, gain_db=-34.0) if beatpos in (0.0, 2.0) else add_darbuka_tak(sc, start + beatpos * beat, gain_db=-33.0, pan=(0.26 if beatpos < 2 else -0.26))
        for beatpos, semis in ((0.0, 0), (0.75, 0), (1.5, 7), (2.0, 0), (2.75, 12), (3.5, 7), (3.75, 10)):
            f = ae.hz(root) * (2 ** (semis / 12))
            sc.add("bass", ae.sub_bass(f, 0.26, attack=0.007, release=0.08, drive=1.4), start + beatpos * beat, gain_db=-31.0, pan=0.0, verb=0.03)
        # Aggressive-but-cute 8th arpeggio.
        pool = ("G3", "Bb3", "D4", "G4", "A4", "D4", "Bb3", "G3") if key == "Gm" else ("A2", "C#4", "E4", "A4", "G4", "E4", "C#4", "A3")
        for k in range(8):
            trailer_pluck(sc, start + k * 0.3, pool[(k * 2 + 1) % len(pool)], gain_db=-30.5, pan=(-0.5 if k % 2 else 0.5), dur=0.6, brightness=0.74, decay=0.8, verb=0.2, delay=0.1)
    # Left/right call and response across the full duel.
    left = (("A4", 19.22), ("D5", 19.34), ("F5", 19.46), ("E5", 19.58))
    right = (("A5", 20.35), ("G5", 20.47), ("F5", 20.59), ("E5", 20.71))
    for note, t in left:
        trailer_pluck(sc, t, note, gain_db=-23.0, pan=-0.7, dur=0.85, brightness=0.58, decay=1.0, verb=0.3, delay=0.18)
    for note, t in right:
        trailer_pluck(sc, t, note, gain_db=-23.0, pan=0.7, dur=0.85, brightness=0.58, decay=1.0, verb=0.3, delay=0.18)
    add_bell(sc, 22.2, "C#6", dur=2.7, gain_db=-31.0, pan=0.28, verb=0.68, delay=0.22, bus="keys", shimmer=0.5)
    add_bell(sc, 23.2, "A5", dur=2.2, gain_db=-33.0, pan=-0.3, verb=0.68, delay=0.2, bus="keys", shimmer=0.45)
    riser2 = ae.riser(0.7, amp=0.4, seed=894, start_hz=60, end_hz=760)
    trailer_sfx(sc, 23.3, riser2, gain_db=-28.0, pan=0.0)
    fx_cue(23.3, "riser", "Duel riser into power montage / تصعيد إلى القدرات")

    # =====================================================================
    # 24.0–28.8  Ability / power montage: energy lift and four hits.
    # =====================================================================
    sec(24.0, "Ability / power montage — energy lift / استعراض القدرات")
    lift_imp = ae.drop_impact(1.8, amp=0.8, seed=900, deep=True, bright=1.2)
    trailer_sfx(sc, 24.0, lift_imp, gain_db=-20.0)
    zap1 = ae.zap(0.5, amp=0.6, seed=901, up=True)
    trailer_sfx(sc, 24.0, zap1, gain_db=-23.0)
    fx_cue(24.0, "impact", "Power montage impact + zap / انطلاق القدرات")
    for bi, (start, chord, root, key) in enumerate((
        (24.0, ("Bb2", "D3", "F3", "A3"), "Bb1", "Bb"),
        (26.4, ("C3", "E3", "G3", "D4"), "C2", "C"),
    )):
        add_pad(sc, start, chord, dur=2.45, gain_db=-21.5, attack=0.10, release=0.3, cutoff=3300, verb=0.22, bus="pad", seed=910 + bi)
        add_strings(sc, start, chord, dur=2.25, gain_db=-29.5, attack=0.12, release=0.3, cutoff=5500, verb=0.28, bus="pad")
        # A proper driving kick/clap/hat grid.
        for beatpos in (0.0, 1.0, 2.0, 3.0):
            sc.add_kick(start + beatpos * beat, gain_db=-23.0, pan=0.0, duration=0.4, punch=0.8, low_hz=50, high_hz=140, decay_s=0.12)
        for beatpos in (1.0, 3.0):
            add_clap(sc, start + beatpos * beat, gain_db=-24.5, pan=0.0, soft=False)
        for k in range(16):
            add_hat(sc, start + k * 0.15, gain_db=(-33.0 if k % 2 else -37.0), pan=(0.18 if k % 2 else -0.2))
        for beatpos in (0.0, 0.75, 1.5, 2.0, 3.0, 3.5):
            add_darbuka_dum(sc, start + beatpos * beat, gain_db=-31.0, pan=0.0) if beatpos in (0.0, 2.0) else add_darbuka_tak(sc, start + beatpos * beat, gain_db=-33.0, pan=(0.28 if beatpos < 2 else -0.28))
        for beatpos, semis in ((0.0, 0), (0.75, 0), (1.5, 7), (2.0, 0), (2.75, 12), (3.5, 7)):
            f = ae.hz(root) * (2 ** (semis / 12))
            sc.add("bass", ae.sub_bass(f, 0.25, attack=0.006, release=0.075, drive=1.45), start + beatpos * beat, gain_db=-30.0, pan=0.0, verb=0.03)
            sc.add("bass", ae.pluck_bass(f * 2, 0.26, seed=int(sc.rng.integers(1, 2**31 - 1))), start + beatpos * beat, gain_db=-36.0, pan=0.08, verb=0.03)
        pool = {
            "Bb": ("Bb3", "D4", "F4", "Bb4", "A4", "F4", "D4", "Bb3"),
            "C": ("C4", "E4", "G4", "C5", "D5", "G4", "E4", "C4"),
        }[key]
        for k in range(16):
            trailer_pluck(sc, start + k * 0.15, pool[(k * 3 + 1) % len(pool)], gain_db=-33.0, pan=(-0.55 if k % 2 else 0.55), dur=0.42, brightness=0.78, decay=0.65, verb=0.18, delay=0.08)
    sparkle1 = ae.cat_glint(1.6, amp=0.55, seed=920)
    trailer_sfx(sc, 25.2, sparkle1, gain_db=-25.0, pan=0.1)
    fx_cue(25.2, "sparkle", "Sparkle / بريق القدرة")
    wh2 = ae.whoosh(0.95, amp=0.55, seed=921)
    trailer_sfx(sc, 26.4, wh2, gain_db=-25.0, pan=0.2)
    fx_cue(26.4, "whoosh", "Power whoosh / انتقال القدرة")
    zap2 = ae.zap(0.42, amp=0.45, seed=922, up=False)
    trailer_sfx(sc, 28.2, zap2, gain_db=-25.0, pan=-0.15)
    sparkle2 = ae.cat_glint(1.5, amp=0.45, seed=923)
    trailer_sfx(sc, 28.2, sparkle2, gain_db=-28.0, pan=-0.3)
    hit2 = ae.drop_impact(1.1, amp=0.65, seed=924, deep=False)
    trailer_sfx(sc, 28.2, hit2, gain_db=-24.0)
    fx_cue(28.2, "hit", "Zap / sparkle hit / ضربة الكهرباء والبريق")

    # =====================================================================
    # 28.8–33.6  Feature/documentary montage: short breakdown, steady drive,
    # warm strings and a small accent every 0.6 s.
    # =====================================================================
    sec(28.8, "Feature / documentary montage — short breakdown, steady drive / استعراض المزايا")
    # The downbeat is a warm, drumless breath; the pulse returns one beat later.
    add_pad(
        sc, 28.8, ("D3", "F3", "A3", "E4"), dur=2.45, gain_db=-21.5,
        attack=0.20, release=0.4, cutoff=3200, verb=0.35, bus="pad", seed=930,
    )
    add_strings(
        sc, 28.8, ("D3", "A3", "F4"), dur=2.35, gain_db=-29.0,
        attack=0.35, release=0.45, cutoff=4800, verb=0.35, bus="pad",
    )
    add_pad(
        sc, 31.2, ("Bb2", "D3", "F3", "A3"), dur=2.4, gain_db=-21.0,
        attack=0.17, release=0.35, cutoff=3300, verb=0.32, bus="pad", seed=931,
    )
    add_strings(
        sc, 31.2, ("Bb2", "F3", "D4", "A4"), dur=2.3, gain_db=-29.0,
        attack=0.3, release=0.4, cutoff=5000, verb=0.32, bus="pad",
    )
    sc.add("bass", ae.sub_bass(ae.hz("D2"), 2.25, attack=0.03, release=0.2, drive=1.18), 28.8, gain_db=-33.0, pan=0.0, verb=0.05)
    sc.add("bass", ae.sub_bass(ae.hz("Bb1"), 2.2, attack=0.03, release=0.2, drive=1.18), 31.2, gain_db=-33.0, pan=0.0, verb=0.05)
    piano_notes = (("D4", 29.4), ("F4", 30.0), ("A4", 30.6), ("Bb4", 31.2), ("A4", 31.8), ("F4", 32.4), ("D4", 33.0))
    for note, t in piano_notes:
        add_piano(sc, t, note, dur=2.2, gain_db=-31.0, pan=(0.15 if int(t * 10) % 2 else -0.15), verb=0.4, bus="keys")
    # Steady but gentle pulse, returning at 29.4 after the downbeat breath.
    for i, beatpos in enumerate(range(0, 7)):
        t = 29.4 + i * 0.6
        sc.add_kick(t, gain_db=(-31.0 if i % 2 else -33.0), pan=0.0, duration=0.32, punch=0.45, low_hz=58, high_hz=110, decay_s=0.11)
        add_shaker(sc, t, gain_db=-40.0, pan=(-0.15 if i % 2 else 0.16))
        add_shaker(sc, t + 0.3, gain_db=-41.0, pan=(0.14 if i % 2 else -0.14))
    for i in range(7):
        t = 29.4 + i * 0.6
        # Small accents on every beat for the fast-cut montage.
        if i % 3 == 0:
            acc = ae.card_flip(seed=940 + i)
            sc.add("perc", acc, t, gain_db=-32.0, pan=(0.35 if i % 2 else -0.35), verb=0.12, delay=0.04)
        elif i % 3 == 1:
            add_bell(sc, t, ("A5", "D6", "F5", "E6")[i % 4], dur=1.0, gain_db=-36.0, pan=(-0.2 if i % 2 else 0.25), verb=0.5, delay=0.14, bus="keys", shimmer=0.3)
        else:
            trailer_pluck(sc, t, ("D5", "A4", "F5", "E5")[i % 4], gain_db=-33.0, pan=(0.4 if i % 2 else -0.4), dur=0.7, brightness=0.7, decay=0.9, verb=0.25, delay=0.08)
        # Cue every 0.6 s starting at 29.4 as requested by the visual rhythm.
        if t <= 33.0:
            fx_cue(t, "accent", "Montage accent / لقطة سريعة")
    # Gentle fill and a soft transition breath before the dedication.
    add_bell(sc, 33.0, "D6", dur=2.8, gain_db=-32.0, pan=0.1, verb=0.65, delay=0.2, bus="keys", shimmer=0.45)
    add_shaker(sc, 33.3, gain_db=-42.0, pan=-0.2)

    # =====================================================================
    # 33.6–36.0  Emotional dedication breakdown: drums out, piano/pad/bells,
    # heartbeat, room for the line, riser at 35.4.
    # =====================================================================
    sec(33.6, "Dedication breakdown — drums out, piano, pad & bells / الإهداء")
    add_pad(
        sc, 33.6, ("Bb2", "D3", "F3", "A3", "C4"), dur=2.5, gain_db=-19.5,
        attack=0.35, release=0.65, cutoff=3300, verb=0.48, bus="pad", seed=950,
    )
    add_strings(
        sc, 33.6, ("Bb2", "F3", "D4", "A4"), dur=2.45, gain_db=-27.5,
        attack=0.45, release=0.7, cutoff=4200, verb=0.5, bus="pad",
    )
    for note, t, level in (("Bb2", 33.6, -30.0), ("F3", 33.68, -32.0), ("D4", 34.25, -31.0), ("A4", 35.0, -35.0)):
        add_piano(sc, t, note, dur=3.0, gain_db=level, pan=(-0.15 if t < 34.0 else 0.15), verb=0.52, bus="keys")
    add_bell(sc, 34.8, "D6", dur=2.5, gain_db=-36.0, pan=0.22, verb=0.75, delay=0.2, bus="keys", shimmer=0.55)
    add_bell(sc, 35.2, "A5", dur=2.2, gain_db=-37.0, pan=-0.2, verb=0.7, delay=0.15, bus="keys", shimmer=0.45)
    trailer_sfx(sc, 33.82, ae.heartbeat(amp=0.45), gain_db=-26.0)
    trailer_sfx(sc, 34.95, ae.heartbeat(amp=0.35), gain_db=-28.0)
    fx_cue(33.6, "hit", "Drums stop for dedication / توقف الطبول للإهداء")
    fx_cue(33.82, "heartbeat", "Soft heartbeat under dedication / نبضة هادئة")
    # Riser begins exactly at 35.4 and leads to the drop.
    riser3 = ae.riser(0.6, amp=0.55, seed=960, start_hz=45, end_hz=900)
    trailer_sfx(sc, 35.4, riser3, gain_db=-24.0, pan=0.05)
    fx_cue(35.4, "riser", "Final riser / تصعيد أخير")
    swell3 = ae.reverse_swell(0.9, amp=0.35, seed=961)
    trailer_sfx(sc, 35.1, swell3, gain_db=-31.0)
    # Warm strings bloom into the drop without percussion.
    add_strings(
        sc, 35.4, ("Bb2", "F3", "D4", "A4", "D5"), dur=0.65, gain_db=-31.0,
        attack=0.2, release=0.18, cutoff=6000, verb=0.5, bus="pad",
    )

    # =====================================================================
    # 36.0–40.8  Final lift/drop: logo and confetti, full warm theme, big but
    # tasteful.  Impact at 36.0 and 40.8.
    # =====================================================================
    sec(36.0, "Final lift / drop — logo, confetti, full warm theme / الانطلاقة الأخيرة")
    final_imp = ae.drop_impact(2.2, amp=1.0, seed=970, deep=True, bright=1.25)
    trailer_sfx(sc, 36.0, final_imp, gain_db=-18.0)
    confetti = ae.cat_glint(2.6, amp=0.75, seed=971)
    trailer_sfx(sc, 36.0, confetti, gain_db=-22.0)
    fx_cue(36.0, "impact", "Final lift impact + confetti / انفجار الاحتفال")
    # Warm harmonic bed.
    for start, chord, root, key in (
        (36.0, ("Bb2", "D3", "F3", "A3"), "Bb1", "Bb"),
        (38.4, ("F2", "A3", "C4", "E4"), "F2", "F"),
    ):
        add_pad(sc, start, chord, dur=2.45, gain_db=-18.8, attack=0.10, release=0.3, cutoff=3800, verb=0.3, bus="pad", seed=int(980 + start))
        add_strings(sc, start, chord, dur=2.35, gain_db=-26.0, attack=0.12, release=0.3, cutoff=6000, verb=0.38, bus="pad")
        # Full but tasteful kit.
        for beatpos in (0.0, 1.0, 2.0, 3.0):
            sc.add_kick(start + beatpos * beat, gain_db=-21.5, pan=0.0, duration=0.42, punch=0.8, low_hz=50, high_hz=142, decay_s=0.13)
        for beatpos in (1.0, 3.0):
            add_clap(sc, start + beatpos * beat, gain_db=-24.0, pan=0.0, soft=False)
        for k in range(16):
            add_hat(sc, start + k * 0.15, gain_db=(-32.5 if k % 2 else -36.0), pan=(0.2 if k % 2 else -0.2))
        for beatpos in (0.0, 0.5, 1.5, 2.0, 3.0, 3.5):
            add_darbuka_dum(sc, start + beatpos * beat, gain_db=-30.0, pan=0.0) if beatpos in (0.0, 2.0) else add_darbuka_tak(sc, start + beatpos * beat, gain_db=-33.0, pan=(0.25 if beatpos < 2 else -0.25))
        for beatpos, semis in ((0.0, 0), (0.75, 0), (1.5, 7), (2.0, 0), (2.75, 12), (3.5, 7)):
            f = ae.hz(root) * (2 ** (semis / 12))
            sc.add("bass", ae.sub_bass(f, 0.3, attack=0.006, release=0.09, drive=1.45), start + beatpos * beat, gain_db=-28.0, pan=0.0, verb=0.03)
            sc.add("bass", ae.pluck_bass(f * 2, 0.3, seed=int(sc.rng.integers(1, 2**31 - 1))), start + beatpos * beat, gain_db=-34.0, pan=0.08, verb=0.03)
        pool = ("Bb3", "D4", "F4", "Bb4", "A4", "F4", "D4", "Bb3") if key == "Bb" else ("F3", "A3", "C4", "F4", "G4", "A4", "E4", "C4")
        for k in range(8):
            trailer_pluck(sc, start + k * 0.3, pool[(k * 3 + 1) % len(pool)], gain_db=-32.5, pan=(-0.52 if k % 2 else 0.52), dur=0.6, brightness=0.76, decay=0.8, verb=0.22, delay=0.1)
    # The meow motif gets the high, golden treatment at the drop.
    for i, midi in enumerate((81, 86, 89, 88)):  # A5 D6 F6 E6
        t = 36.0 + i * 0.15
        trailer_pluck(sc, t, midi, gain_db=-21.5, pan=(-0.18 + 0.12 * i), dur=1.4, brightness=0.6, decay=1.2, verb=0.4, delay=0.18)
        if i in (0, 3):
            add_bell(sc, t, midi, dur=2.7, gain_db=-27.0, pan=(0.3 if i else -0.25), verb=0.68, delay=0.2, bus="keys", shimmer=0.5)
    # Warm theme continuation, lower and wider under the last narration line.
    for t, note, level in ((37.2, "F5", -27.0), (37.8, "A5", -28.0), (38.4, "A5", -25.5), (39.0, "G5", -27.0), (39.6, "F5", -28.0), (40.2, "E5", -30.0)):
        add_bell(sc, t, note, dur=2.3, gain_db=level, pan=(-0.16 if int(t * 10) % 2 else 0.18), verb=0.55, delay=0.18, bus="keys", shimmer=0.35)
        trailer_pluck(sc, t, note, gain_db=level - 5.0, pan=0.15, dur=1.4, brightness=0.6, decay=1.2, verb=0.3, delay=0.12)
    # Big final crescendo and reverse swell into the end card.
    riser4 = ae.riser(0.95, amp=0.7, seed=990, start_hz=50, end_hz=950)
    trailer_sfx(sc, 39.8, riser4, gain_db=-26.0)
    fx_cue(39.8, "riser", "End-card riser / تصعيد إلى بطاقة النهاية")
    imp3 = ae.drop_impact(2.0, amp=0.9, seed=991, deep=True)
    trailer_sfx(sc, 40.8, imp3, gain_db=-20.0)
    fx_cue(40.8, "impact", "End-card impact / صدمة بطاقة النهاية")

    # =====================================================================
    # 40.8–44.8  End card: meow motif, soft magical final chord, clean finish.
    # =====================================================================
    sec(40.8, "End card — meow motif & soft magical final chord / بطاقة النهاية")
    add_pad(
        sc, 40.8, ("D3", "F3", "A3", "E4"), dur=4.0, gain_db=-21.5,
        attack=0.16, release=2.2, cutoff=3000, verb=0.55, bus="pad", seed=1001,
    )
    add_strings(
        sc, 40.8, ("D3", "A3", "F4"), dur=3.9, gain_db=-31.0,
        attack=0.25, release=2.0, cutoff=4000, verb=0.55, bus="pad",
    )
    sc.add("bass", ae.sub_bass(ae.hz("D2"), 3.8, attack=0.04, release=1.0, drive=1.1), 40.8, gain_db=-33.0, pan=0.0, verb=0.15)
    # The motif returns as a music-box memory.
    for i, midi in enumerate(MEOW_MIDI):
        t = 41.4 + i * 0.30
        add_piano(sc, t, midi, dur=3.2, gain_db=-25.0, pan=(-0.14 + 0.10 * i), verb=0.55, bus="keys")
        add_bell(sc, t, midi + 12, dur=2.4, gain_db=-34.0, pan=(0.2 - 0.08 * i), verb=0.7, delay=0.18, bus="keys", shimmer=0.45)
    # Final resolve: a soft, wide Dm(add9).
    for note, level in (("D2", -32.0), ("A2", -36.0), ("D3", -33.0), ("F3", -35.0), ("A3", -37.0), ("E4", -39.0), ("D5", -40.0)):
        add_piano(sc, 43.2, note, dur=2.5, gain_db=level, pan=float((ae.midi_name(note) % 5 - 2) * 0.06), verb=0.6, bus="keys")
    add_bell(sc, 43.2, "D6", dur=2.8, gain_db=-34.0, pan=0.12, verb=0.8, delay=0.2, bus="keys", shimmer=0.65)
    add_bell(sc, 43.5, "A6", dur=2.3, gain_db=-39.0, pan=-0.35, verb=0.85, delay=0.25, bus="keys", shimmer=0.8)
    fin = ae.cat_glint(2.2, amp=0.4, seed=1010)
    trailer_sfx(sc, 43.2, fin, gain_db=-30.0)
    fx_cue(41.4, "motif", "Meow motif — end card / فكرة المياو")
    fx_cue(43.2, "section", "Soft magical final chord / الكورد الأخير")
    fx_cue(44.8, "end", "End — clean fade to silence / النهاية")

    # ------------------------------------------------------------------
    # Music / SFX sum, voiceover ducking, and final mix.
    # ------------------------------------------------------------------
    music_names = ("pad", "keys", "bass", "perc")
    music = np.zeros((2, n), dtype=np.float64)
    for name in music_names:
        bus = sc.buses.get(name)
        if bus is not None:
            gain = {"pad": 0.0, "keys": 0.0, "bass": 0.0, "perc": -0.7}[name]
            music += bus * ae.db_to_gain(gain)
    ir = ae.make_impulse_response(2.9, decay=0.72, predelay_ms=28, seed=1101, brightness=6800)
    music_wet = ae.reverb_send(sc.reverb_send, ir, wet_rms=0.34, wrap=False)
    music += music_wet
    echo = ae.pingpong_delay(sc.delay_send, 0.75 * beat, feedback=0.29, repeats=4, wet=0.14, wrap=False)
    music += echo
    music -= np.mean(music, axis=1, keepdims=True)
    sfx = sc.buses.get("sfx", np.zeros((2, n)))
    # A little shared air/space for the sound design, but no music duck on it.
    fx_ir = ae.make_impulse_response(1.15, decay=0.30, predelay_ms=15, seed=1102, brightness=5200)
    sfx = sfx + ae.reverb_send(sfx, fx_ir, wet_rms=0.10, wrap=False) * 0.55
    sfx = ae.filt(sfx, "highpass", 35.0, 2)
    # Music tone shaping before the voice sits on top.
    music = ae.filt(music, "highpass", 29.0, 2)
    b, a = ae.low_shelf(105.0, -0.35, 0.8)
    music = signal.lfilter(b, a, music, axis=-1)
    b, a = ae.bell_biquad(265.0, -0.85, 0.9)
    music = signal.lfilter(b, a, music, axis=-1)
    b, a = ae.bell_biquad(3400.0, 0.45, 1.0)
    music = signal.lfilter(b, a, music, axis=-1)
    music = stereo_width(music, 1.08)
    # Carefully shape the cinematic arc before the voice and impacts are added.
    music *= np.power(10.0, make_section_automation(n)[None, :] / 20.0)
    music *= np.power(10.0, make_voice_space_automation(n)[None, :] / 20.0)
    # Voice bus and intelligibility / ducking balance.
    vo = voice.voice_bus_from_manifest(manifests)
    duck6 = make_duck_envelope(n, manifests, depth_db=6.0)
    duck3 = make_duck_envelope(n, manifests, depth_db=2.8)
    music_ducked = music * duck6[None, :]
    sfx_ducked = sfx * duck3[None, :]
    # Set the voice a clear but musical distance above the ducked bed.
    ratios = []
    for item in manifests:
        s = max(0, int(round(item["start"] * ae.SR)))
        e = min(n, int(round(item["end"] * ae.SR)))
        if e > s:
            vr = ae.rms_dbfs(vo[:, s:e])
            mr = ae.rms_dbfs(music_ducked[:, s:e])
            ratios.append(vr - mr)
    if ratios:
        # Use the worst-case local balance, not the median, so the softest
        # consonant in the loudest section still sits clearly above the bed.
        # All other lines then enjoy slightly more air without any level jumps.
        worst_ratio = float(np.min(ratios))
        voice_gain_db = 3.5 - worst_ratio
    else:
        voice_gain_db = 0.0
    voice_gain_db = float(np.clip(voice_gain_db, -12.0, 8.0))
    vo_gained = vo * ae.db_to_gain(voice_gain_db)
    print(
        f"    music RMS {ae.rms_dbfs(music):.1f} dBFS, ducked {ae.rms_dbfs(music_ducked):.1f}; "
        f"SFX {ae.rms_dbfs(sfx):.1f}; VO {ae.rms_dbfs(vo):.1f}; "
        f"VO window above bed median {np.median(ratios) if ratios else 0:.1f} dB; voice trim {voice_gain_db:+.1f} dB"
    )
    mix = music_ducked + sfx_ducked * ae.db_to_gain(-1.0) + vo_gained
    # Development stems: useful when judging balance without changing the
    # composed score; these live under tools/ and are not game assets.
    debug_dir = TOOLS / "audio-src" / "debug"
    debug_dir.mkdir(parents=True, exist_ok=True)
    for stem_name, stem in (
        ("trailer-music", music_ducked),
        ("trailer-music-unducked", music),
        ("trailer-sfx", sfx_ducked),
        ("trailer-vo", vo_gained),
        ("trailer-premaster", mix),
    ):
        ae.write_wav24(debug_dir / f"{stem_name}.wav", stem, seed=3000 + len(stem_name))
    # Section energy report for objective balance checks.
    section_marks = (0.0, 2.4, 4.8, 7.2, 12.0, 19.2, 24.0, 28.8, 33.6, 36.0, 40.8, 44.8)
    for a, b in zip(section_marks, section_marks[1:]):
        s, e = int(a * ae.SR), int(b * ae.SR)
        parts = []
        for stem_name, stem in (("M", music_ducked), ("S", sfx_ducked), ("V", vo_gained), ("X", mix)):
            parts.append(f"{stem_name}{ae.loudness_lufs(stem[:, s:e]):5.1f}")
        print(f"    {a:5.1f}-{b:5.1f}: " + " ".join(parts))
    # Full-mix glue, a little clarity and a touch of air.  The voice already
    # carries its own presence lift; this is a gentle master tilt, not a rescue.
    b, a = ae.bell_biquad(300.0, -0.65, 0.9)
    mix = signal.lfilter(b, a, mix, axis=-1)
    b, a = ae.bell_biquad(2700.0, 0.55, 0.9)
    mix = signal.lfilter(b, a, mix, axis=-1)
    b, a = ae.high_shelf(7800.0, 1.0, 0.8)
    mix = signal.lfilter(b, a, mix, axis=-1)
    mix = ae.bus_compress(
        mix, threshold_db=-17.0, ratio=1.55, attack_ms=22.0, release_ms=220.0,
        makeup_db=0.4, knee_db=6.0, fs=ae.SR,
    )
    mix = ae.filt(mix, "highpass", 26.0, 2)
    # Start at digital zero; close the narration/master tail cleanly at 44.8.
    mix = ae.fade_edges(mix, int(0.010 * ae.SR), int(1.0 * ae.SR))
    # The final fade should feel like air leaving, not a cut.  A second micro
    # fade guarantees the last sample is exactly zero.
    mix[:, -int(0.02 * ae.SR):] *= np.linspace(1.0, 0.0, int(0.02 * ae.SR))[None, :]
    mix = ae.ensure_stereo(mix)
    target = -14.0
    for _ in range(4):
        cur = ae.loudness_lufs(mix)
        mix *= ae.db_to_gain(target - cur)
        tp = ae.true_peak_db(mix)
        if tp > -2.0:
            mix = ae.soft_limit(mix, ceiling_db=-2.2)
    # Re-measure and, if limiting moved us materially, gently restore loudness
    # while respecting the cap.
    cur = ae.loudness_lufs(mix)
    if target - cur > 0.15:
        tentative = mix * ae.db_to_gain(target - cur)
        if ae.true_peak_db(tentative) <= -1.85:
            mix = tentative
    # Hard final true-peak guard: leave enough margin that MP3 decoding is also
    # below -1.5 dBTP.  This is a static trim, never a limiter after the fade.
    tp = ae.true_peak_db(mix)
    if tp > -2.0:
        mix *= ae.db_to_gain(-2.1 - tp)
    # Final delivery lift: the peak guard above leaves a small amount of clean
    # headroom, so use it to land closer to -14 LUFS while keeping MP3 safe.
    if ae.true_peak_db(mix) < -1.9:
        mix *= ae.db_to_gain(0.3)
    # Keep exactly 44.8 s at 48 kHz.
    mix = mix[:, :TRAILER_N]
    if mix.shape[1] < TRAILER_N:
        mix = np.pad(mix, ((0, 0), (0, TRAILER_N - mix.shape[1])))
    # Cues: add the voiceover phrase starts/ends from the processed stems.
    for item in manifests:
        arabic = item["text"]
        add_cue(cues, item["start"], "voiceover_start", f"VO {item['key']} start — «{arabic}»")
        add_cue(cues, item["end"], "voiceover_end", f"VO {item['key']} end — «{arabic}»")
    cues = sorted(cues, key=lambda c: c["t"])
    # Stable de-duplication (same time/type/label) if a cue was written twice.
    deduped = []
    seen = set()
    for c in cues:
        key = (c["t"], c["type"], c["label"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(c)
    cue_obj = {
        "duration": 44.8,
        "bpm": 100,
        "beat": 0.6,
        "bar": 2.4,
        "cues": deduped,
    }
    return mix, cue_obj, manifests


def trailer_stats(x: np.ndarray, cues: dict, manifests: Sequence[dict]) -> dict:
    dur = x.shape[1] / ae.SR
    # First 100 ms energy must be real intro material, not encoder silence.
    lead_100 = ae.rms_dbfs(x[:, : int(0.100 * ae.SR)])
    lead_10 = ae.rms_dbfs(x[:, : int(0.010 * ae.SR)])
    stats = {
        "duration": dur,
        "lufs": ae.loudness_lufs(x),
        "true_peak_dbtp": ae.true_peak_db(x),
        "peak_dbfs": ae.peak_dbfs(x),
        "rms_dbfs": ae.rms_dbfs(x),
        "dc": ae.dc_offset(x),
        "lead_100ms_rms": lead_100,
        "lead_10ms_rms": lead_10,
        "first_sample": float(x[0, 0]),
        "voices": [
            {
                "key": m["key"],
                "text": m["text"],
                "start": m["start"],
                "end": m["end"],
                "duration": m["processed_duration"],
                "lufs": m["lufs"],
            }
            for m in manifests
        ],
        "cue_count": len(cues["cues"]),
    }
    print(
        f"  trailer: {dur:.3f}s  {stats['lufs']:.2f} LUFS  TP {stats['true_peak_dbtp']:.2f} dBTP  "
        f"peak {stats['peak_dbfs']:.2f} dBFS  DC {stats['dc']:+.2e}  "
        f"first-100ms RMS {lead_100:.1f} dBFS  first sample {stats['first_sample']:+.2e}"
    )
    return stats


def write_cues(cues: dict) -> None:
    AUDIO.mkdir(parents=True, exist_ok=True)
    with (AUDIO / "trailer-cues.json").open("w", encoding="utf-8") as f:
        json.dump(cues, f, ensure_ascii=False, indent=2)
        f.write("\n")


def _fmt_times(cues: dict, types: Sequence[str]) -> list[str]:
    rows = []
    for c in cues["cues"]:
        if c["type"] in types:
            rows.append(f"- `{c['t']:.3f}s` — **{c['type']}** — {c['label']}")
    return rows


def write_notes(stats_all: dict, cues: dict) -> None:
    lines = [
        "# Meow Memory — Original Soundtrack / الموسيقى الأصلية للعبة",
        "",
        "Originally synthesized from code for the game *مياو ميموري*. No samples,",
        "stock loops, or downloaded music are used. The Arabic narration is generated",
        "with edge-tts and treated with first-party DSP.",
        "",
        "## Files",
        "- `assets/audio/menu-theme.ogg` / `.mp3` — warm menu loop, 43.636 s.",
        "- `tools/audio-src/menu-theme.wav` — 24-bit/48 kHz source master.",
        "- `assets/audio/battle-theme.ogg` / `.mp3` — action loop, 34.286 s.",
        "- `tools/audio-src/battle-theme.wav` — 24-bit/48 kHz source master.",
        "- `assets/audio/trailer-mix.wav` / `.mp3` — 44.800 s vertical-trailer master.",
        "- `assets/audio/trailer-cues.json` — frame-friendly cue map for the editor.",
        "",
        "## Rebuild",
        "```powershell",
        "cd \"D:\\لعبة سيارات\"",
        "$env:PYTHONUTF8='1'",
        "python tools/generate_audio.py",
        "```",
        "Use `--only menu|battle|trailer` for one deliverable and `--force-tts` to",
        "refresh the cached narration. All music is deterministic; seeds live in",
        "`tools/generate_audio.py`. Narration stems are cached under",
        "`tools/audio-src/voice/`, so a normal rerun does not need the network.",
        "",
        "## Music",
        "- Key: D minor / Nahawand, with Bb and C# harmonic-minor colour; occasional",
        "  E-natural melodic passing tones. The 4-note **meow motif** is A–D–F–E",
        "  (scale degrees 5–8–10–9) and recurs in all three pieces.",
        "- Menu: 88 BPM, 16 bars 4/4, 43.636 s. Oud/harp plucks, detuned warm pad,",
        "  celesta, rounded sub, brushed darbuka and shaker.",
        "- Battle: 112 BPM, 16 bars 4/4, 34.286 s. Plucked hook, maqsum-inspired",
        "  darbuka, soft kick/claps/hats, sidechained pad/bass, 4-bar stingers.",
        "- Trailer: 100 BPM, 44.800 s (beat 0.6 s, bar 2.4 s), 48 kHz stereo.",
        "",
        "## Trailer structure",
        "- 0.0 intro — dark drone, distant sparkle, heartbeat, cat-eye glint.",
        "- 2.4 title reveal — magical impact and meow motif, no heavy drums.",
        "- 4.8 logo/tagline — warm swell, soft pulse begins.",
        "- 7.2 menu showcase — light groove, plucks, bells.",
        "- 12.0 fruit/card montage & first gameplay — beat enters, darbuka, card ticks.",
        "- 19.2 duel — bigger percussion and stereo call/response.",
        "- 24.0 power montage — zap/sparkle/whoosh hits at 24.0/25.2/26.4/28.2.",
        "- 28.8 feature/documentary montage — short breakdown, steady drive, accents each 0.6 s.",
        "- 33.6 dedication — drums out, piano/pad/bells, heartbeat; riser at 35.4.",
        "- 36.0 final lift — impact and confetti, full warm theme.",
        "- 40.8 end card — motif and soft final chord, fade to silence at 44.8.",
        "",
        "## Voiceover",
        "Voice: `ar-EG-SalmaNeural`, generated per line, rate ~+6%, pitch +2 Hz.",
        "Each line is trimmed/condensed transiently, high-passed near 92 Hz, presence-",
        "lifted around 2.7–3.9 kHz, de-essed, lightly compressed, and given a whisper of",
        "short room. Listed times are actual placed starts and ends from the processed stems.",
        "",
    ]
    for v in stats_all.get("trailer", {}).get("voices", []):
        lines.append(
            f"- VO {v['key']}: **{v['start']:.3f}–{v['end']:.3f} s** — «{v['text']}»"
        )
    lines += [
        "",
        "## Measured delivery",
    ]
    for key, title in (("menu", "menu-theme"), ("battle", "battle-theme")):
        s = stats_all.get(key)
        if s:
            lines.append(
                f"- {title}: {s['duration']:.3f} s, {s['lufs']:.1f} LUFS, true peak "
                f"{s['true_peak_dbtp']:.1f} dBTP, DC {s['dc']:+.1e}."
            )
    t = stats_all.get("trailer")
    if t:
        lines.append(
            f"- trailer-mix: {t['duration']:.3f} s, {t['lufs']:.2f} LUFS, true peak "
            f"{t['true_peak_dbtp']:.1f} dBTP, peak {t['peak_dbfs']:.1f} dBFS."
        )
    lines += [
        "",
        "## Loops and practical notes",
        "- Loops are rendered from cyclic patterns; a 12 ms equal-power seam crossfade",
        "  uses a rendered continuation and introduces no gap, fade or silence.",
        "  Prefer the OGG on the web: Vorbis loops without encoder padding. The OGG",
        "  files carry no extra leading samples.",
        "- MP3 is provided for compatibility. LAME stores gapless metadata, but some",
        "  browser `HTMLAudioElement` implementations still insert a short decoder",
        "  pause when repeating MP3. Use `menu-theme.ogg` / `battle-theme.ogg` for",
        "  gapless playback where supported, and keep the MP3 as the fallback.",
        "- Voice and music are deliberately separate buses; music is ducked 6 dB under",
        "  narration (sound design ~2.8 dB) with smooth 0.10 s attack / 0.32 s release.",
        "- Compromise: the dedication line starts at 33.60 s (instead of ~33.8 s) so its",
        "  spoken end lands on the 36.0 s drop without overlapping the final lift.",
        "",
        "## Cue JSON",
        "`assets/audio/trailer-cues.json` lists every section boundary, major impact,",
        "transition/whoosh, montage accent, and VO phrase start/end. All cue times are",
        "quantised to 30 fps (1/30 s) and match the 44.8 s master.",
        "",
    ]
    (TOOLS / "AUDIO_NOTES.md").write_text("\n".join(lines), encoding="utf-8")


def master_to_lufs(
    x: np.ndarray,
    *,
    target_lufs: float,
    ceiling_db: float,
    loop_n: int | None = None,
    loop_xfade: int = 0,
) -> np.ndarray:
    """Static loudness normalisation, safety limiting, and optional loop seam."""
    y = ae.ensure_stereo(np.asarray(x, dtype=np.float64))
    y = y - np.mean(y, axis=1, keepdims=True)
    # Iterate static gain + limiter so the final integrated loudness is close.
    for _ in range(3):
        cur = ae.loudness_lufs(y)
        y *= ae.db_to_gain(target_lufs - cur)
        pk = ae.peak_dbfs(y)
        tp = ae.true_peak_db(y)
        if pk > ceiling_db or tp > ceiling_db + 0.25:
            y = ae.soft_limit(y, ceiling_db=min(ceiling_db, -1.75))
    if loop_n is not None:
        # Crossfade the beginning with the continuation.  The score was rendered
        # with a small guard tail, so this is a true continuation, not a cut.
        if y.shape[1] < loop_n + loop_xfade:
            raise ValueError("Loop buffer missing crossfade guard")
        out = y[:, :loop_n].copy()
        w = max(1, loop_xfade)
        fade_in = np.sin(np.linspace(0, math.pi / 2, w, endpoint=True))[None, :]
        fade_out = np.cos(np.linspace(0, math.pi / 2, w, endpoint=True))[None, :]
        out[:, :w] = out[:, :w] * fade_in + y[:, loop_n : loop_n + w] * fade_out
        y = out
        # Loudness is measured after the actual loop trim.  Very small trim only.
        cur = ae.loudness_lufs(y)
        y *= ae.db_to_gain(target_lufs - cur)
        if ae.peak_dbfs(y) > ceiling_db:
            # Prefer a hair under target over a clipped loop.
            y *= ae.db_to_gain(ceiling_db - ae.peak_dbfs(y))
    # For safety, guarantee the target file has no sample clipping even when the
    # TP check is still a tenth of a dB under the ceiling.
    pk = ae.peak_dbfs(y)
    if pk > ceiling_db:
        y *= ae.db_to_gain(ceiling_db - pk)
    return y


def track_stats(y: np.ndarray, loop_n: int, name: str, bpm: float) -> dict:
    y_loop = y[:, :loop_n]
    lufs = ae.loudness_lufs(y_loop)
    tp = ae.true_peak_db(y_loop)
    pk = ae.peak_dbfs(y_loop)
    dc = ae.dc_offset(y_loop)
    # Seam diagnostics: the two sides of the loop point should have comparable
    # short-term energy.  A low-frequency click would show up in the sample step.
    w = int(0.050 * ae.SR)
    start_rms = ae.rms_dbfs(y_loop[:, :w])
    end_rms = ae.rms_dbfs(y_loop[:, -w:])
    step = float(np.max(np.abs(y_loop[:, 0] - y_loop[:, -1])))
    midi = loop_n / ae.SR
    stats = {
        "name": name,
        "bpm": bpm,
        "duration": midi,
        "samples": loop_n,
        "lufs": lufs,
        "true_peak_dbtp": tp,
        "peak_dbfs": pk,
        "dc": dc,
        "seam_start_rms": start_rms,
        "seam_end_rms": end_rms,
        "seam_step": step,
        "first_50ms_rms": start_rms,
        "last_50ms_rms": end_rms,
    }
    print(
        f"  {name}: {midi:.3f}s  {lufs:.2f} LUFS  TP {tp:.2f} dBTP  "
        f"peak {pk:.2f} dBFS  DC {dc:+.2e}  seam Δ {step:.4f}"
    )
    return stats


# ---------------------------------------------------------------------------
# Writing and encoding
# ---------------------------------------------------------------------------
def write_master_wav96(x: np.ndarray, path: Path) -> None:
    """24-bit master at 48 kHz; kept for delivery compatibility."""
    ae.write_wav24(path, x, ae.SR, seed=2026)


def verify_duration(path: Path, expected: float, tolerance: float = 0.05) -> float:
    cmd = [
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ]
    out = subprocess.check_output(cmd, text=True, encoding="utf-8", errors="replace").strip()
    dur = float(out)
    if abs(dur - expected) > tolerance:
        print(f"  WARNING: {path.name} duration {dur:.4f}s vs expected {expected:.4f}s")
    return dur


def write_loop_assets(name: str, x: np.ndarray, source_path: Path, *, bpm: float, seconds: float) -> dict:
    audio_dir = AUDIO
    audio_dir.mkdir(parents=True, exist_ok=True)
    source_path.parent.mkdir(parents=True, exist_ok=True)
    write_master_wav96(x, source_path)
    ogg = audio_dir / f"{name}.ogg"
    mp3 = audio_dir / f"{name}.mp3"
    ae.encode_ogg(source_path, ogg, quality=8)
    ae.encode_mp3(source_path, mp3, quality=2)
    d_ogg = verify_duration(ogg, seconds)
    d_mp3 = verify_duration(mp3, seconds)
    print(f"  encoded {ogg.name} {d_ogg:.3f}s, {mp3.name} {d_mp3:.3f}s")
    return {"ogg": d_ogg, "mp3": d_mp3}


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------
def main(argv: Sequence[str] | None = None) -> int:
    # Windows consoles are not always UTF-8; force a predictable stream so the
    # Arabic labels and the Arabic-named workspace path never crash a rerun.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    parser = argparse.ArgumentParser(description="Generate the Meow Memory soundtrack")
    parser.add_argument("--only", choices=("all", "menu", "battle", "trailer"), default="all")
    parser.add_argument("--force-tts", action="store_true")
    parser.add_argument("--no-voice", action="store_true", help="Render the trailer without Arabic narration")
    parser.add_argument("--skip-verify", action="store_true")
    args = parser.parse_args(argv)
    SRC.mkdir(parents=True, exist_ok=True)

    stats_all = {}
    try:
        if args.only in ("all", "menu"):
            print("Rendering menu theme (88 BPM, D minor / Nahawand)...")
            menu, stats = render_menu()
            stats_all["menu"] = stats
            loops = write_loop_assets("menu-theme", menu, SRC / "menu-theme.wav", bpm=MENU_BPM, seconds=MENU_SECONDS)
            stats_all["menu"].update(loops)
        if args.only in ("all", "battle"):
            print("Rendering battle theme (112 BPM, D minor)...")
            battle, stats = render_battle()
            stats_all["battle"] = stats
            loops = write_loop_assets("battle-theme", battle, SRC / "battle-theme.wav", bpm=BATTLE_BPM, seconds=BATTLE_SECONDS)
            stats_all["battle"].update(loops)
        if args.only in ("all", "trailer"):
            if args.no_voice:
                print("Skipping Arabic narration (--no-voice)...")
                manifests = []
            else:
                print("Generating Arabic narration...")
                asyncio.run(voice.ensure_tts(voice.LINES, force=args.force_tts))
                manifests = voice.process_voice_lines()
            print("Rendering trailer score...")
            trailer, cues, manifests = render_trailer(manifests)
            stats_all["trailer"] = trailer_stats(trailer, cues, manifests)
            write_master_wav96(trailer, AUDIO / "trailer-mix.wav")
            mp3 = AUDIO / "trailer-mix.mp3"
            ae.encode_mp3(AUDIO / "trailer-mix.wav", mp3, quality=2)
            dur_wav = verify_duration(AUDIO / "trailer-mix.wav", TRAILER_SECONDS, tolerance=0.001)
            dur_mp3 = verify_duration(mp3, TRAILER_SECONDS, tolerance=0.06)
            stats_all["trailer"]["wav_duration"] = dur_wav
            stats_all["trailer"]["mp3_duration"] = dur_mp3
            write_cues(cues)
            write_notes(stats_all, cues)
            print(f"  cues: {len(cues['cues'])} entries, {cues['duration']} s")
    except Exception as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        raise
    print("\nDone.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
