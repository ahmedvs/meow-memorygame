"""Arabic trailer narration: generation, timing and vocal treatment.

The stems are generated once with edge-tts and cached in tools/audio-src/voice.
They are then trimmed, tightened, EQ'd, de-essed and given a small warm space.
Everything after the TTS itself is first-party DSP from audio_engine.
"""
from __future__ import annotations

import asyncio
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from scipy import signal

import audio_engine as ae

VOICE = "ar-EG-SalmaNeural"
ROOT = Path(__file__).resolve().parents[1]
VOICE_DIR = ROOT / "tools" / "audio-src" / "voice"


@dataclass(frozen=True)
class VoiceLine:
    key: str
    text: str
    target_start: float
    slot_end: float
    rate: str = "+6%"
    pitch: str = "+2Hz"
    max_pause: float = 0.26
    note: str = ""


LINES: tuple[VoiceLine, ...] = (
    VoiceLine("A", "في كل ذكرى… قطة صغيرة.", 2.70, 5.30, note="Intro / memory"),
    VoiceLine("B", "مياو ميموري: لعبة ذاكرة… بطعم الأكشن.", 5.40, 9.50, rate="+6%"),
    VoiceLine("C", "عالم كامل… صُنع ليُبهرك.", 9.60, 12.72),
    VoiceLine("D", "افتحي البطاقة، طابقي الفاكهة… وابقي الأسرع.", 12.80, 19.55),
    VoiceLine("E", "لاعبان… مواجهة واحدة… من ستضحك أخيرًا؟", 19.70, 24.05, max_pause=0.22),
    VoiceLine("F", "لمحة… خلطة… وبرقٌ لا يتوقف!", 24.20, 28.80, max_pause=0.22),
    VoiceLine("G", "ثلاثة أوضاع… موسيقى أصلية… وتفاصيل في كل زاوية.", 28.90, 33.52, max_pause=0.24),
    VoiceLine("H", "وهذه اللعبة… هدية لأختي.", 33.60, 36.13, max_pause=0.23),
    VoiceLine("I", "مياو ميموري… هل تتحدينني؟", 37.10, 40.72, max_pause=0.22),
)


def _decode_mp3(path: Path, fs: int = ae.SR) -> np.ndarray:
    """Decode a TTS MP3 to mono float32/64 samples using ffmpeg."""
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
            "-f", "f32le", "-acodec", "pcm_f32le", "-ar", str(fs), "-ac", "1", "pipe:1",
        ],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    mono = np.frombuffer(proc.stdout, dtype="<f4").astype(np.float64)
    if mono.size == 0:
        raise RuntimeError(f"ffmpeg decoded no samples from {path}")
    mono -= float(np.mean(mono))
    return mono


async def _tts_one(line: VoiceLine, path: Path, force: bool) -> None:
    if path.exists() and path.stat().st_size > 1000 and not force:
        return
    import edge_tts

    path.parent.mkdir(parents=True, exist_ok=True)
    com = edge_tts.Communicate(line.text, VOICE, rate=line.rate, pitch=line.pitch)
    await com.save(str(path))


async def ensure_tts(lines: tuple[VoiceLine, ...], *, force: bool = False) -> None:
    """Fetch missing narration from edge-tts (with a little concurrency)."""
    sem = asyncio.Semaphore(3)

    async def guarded(line: VoiceLine) -> None:
        async with sem:
            await _tts_one(line, VOICE_DIR / f"vo_{line.key}.mp3", force)

    # If everything is cached this function is instant; otherwise it makes a
    # few HTTP requests.  The rest of the generator remains offline-friendly.
    await asyncio.gather(*(guarded(line) for line in lines))


def _frame_db(x: np.ndarray, frame: int = 480) -> np.ndarray:
    nframes = max(1, int(math.ceil(x.size / frame)))
    padded = np.pad(x, (0, nframes * frame - x.size))
    frames = padded.reshape(nframes, frame)
    rms = np.sqrt(np.mean(frames * frames, axis=1) + 1e-20)
    return 20.0 * np.log10(rms + 1e-12)


def _find_runs(mask: np.ndarray, min_len: int = 2) -> list[tuple[int, int]]:
    """Half-open runs of True in a boolean array."""
    padded = np.concatenate(([False], mask.astype(bool), [False]))
    changes = np.flatnonzero(padded[1:] != padded[:-1])
    runs = []
    for start, end in zip(changes[0::2], changes[1::2]):
        if end - start >= min_len:
            runs.append((int(start), int(end)))
    return runs


def _tighten_silences(x: np.ndarray, fs: int, *, max_pause: float = 0.26) -> tuple[np.ndarray, list[tuple[float, float]]]:
    """Trim TTS head/tail silence and shorten over-long dramatic pauses.

    Returns the tightened signal and the keep-segments in seconds (relative to
    the original trimmed source), useful for debugging / diagnostics.
    """
    frame = int(0.010 * fs)
    db = _frame_db(x, frame)
    peak_db = float(np.max(db))
    threshold = max(-43.0, peak_db - 36.0)
    active = db > threshold
    # Close small dropouts (<80 ms) so a breath does not split a phrase.
    active = signal.medfilt(active.astype(float), kernel_size=5) > 0.5
    active = np.convolve(active.astype(int), np.ones(9, dtype=int), mode="same") >= 4
    runs = _find_runs(active, min_len=2)
    if not runs:
        return x, [(0.0, x.size / fs)]
    first = max(0, runs[0][0] - 2) * frame
    last = min(x.size, (runs[-1][1] + 12) * frame)
    bounds = [(s * frame, e * frame) for s, e in runs]
    # If there are huge gaps, remove their middle.  This keeps every syllable
    # (and the natural sound just before/after it) untouched.
    cuts: list[tuple[int, int]] = []
    for (s0, e0), (s1, e1) in zip(bounds, bounds[1:]):
        gap = s1 - e0
        if gap > int(max_pause * fs):
            keep_each = int(max_pause * fs / 2)
            cut_start = e0 + keep_each
            cut_end = s1 - keep_each
            if cut_end - cut_start > int(0.035 * fs):
                cuts.append((cut_start, cut_end))
    # Also trim the head/tail.
    head = max(0, first - int(0.015 * fs))
    tail = min(x.size, last + int(0.010 * fs))
    kept = []
    cursor = head
    for a, b in cuts:
        if a > cursor:
            kept.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < tail:
        kept.append((cursor, tail))
    pieces = []
    crossfade = int(0.004 * fs)
    for i, (a, b) in enumerate(kept):
        piece = x[a:b].copy()
        if i > 0:
            # Very short fade after a silence splice avoids a DC step.
            n = min(crossfade, piece.size)
            piece[:n] *= np.linspace(0.0, 1.0, n)
        if i < len(kept) - 1:
            n = min(crossfade, piece.size)
            piece[-n:] *= np.linspace(1.0, 0.0, n)
        pieces.append(piece)
    out = np.concatenate(pieces) if pieces else x[head:tail].copy()
    # Remove any residual DC and apply gentle boundary fades.
    out -= float(np.mean(out))
    out = ae.fade_edges(out, int(0.008 * fs), int(0.035 * fs))
    return out, [(a / fs, b / fs) for a, b in kept]


def _deess(x: np.ndarray, fs: int = ae.SR) -> np.ndarray:
    """Light split-band de-esser for Salma's sibilants."""
    sos = signal.butter(2, [5200, 9800], btype="bandpass", fs=fs, output="sos")
    band = signal.sosfilt(sos, x)
    env = np.abs(band)
    # 1 ms attack / 25 ms release envelope, then a soft ratio.
    env = signal.sosfilt(signal.butter(2, 45, btype="lowpass", fs=fs, output="sos"), env)
    threshold = float(np.percentile(env[env > 1e-6], 92)) * 0.55 if np.any(env > 1e-6) else 0.01
    over = np.clip((env - threshold) / (threshold * 2.2 + 1e-9), 0.0, 1.0)
    reduction = ae._smoothstep(over) * 0.55
    band2 = band * (1.0 - reduction)
    return x - band + band2


def _voice_chain(x: np.ndarray, fs: int = ae.SR) -> np.ndarray:
    """EQ, de-ess, soft compression and a touch of short space. Mono in/out."""
    # HPF at 92 Hz and a small low-mid tidy-up keeps the narration out of the
    # music's 150–350 Hz build-up while retaining a warm chest tone.
    x = ae.filt(x, "highpass", 92.0, 2)
    x = ae.filt(x, "highpass", 78.0, 1)
    b, a = ae.low_shelf(260.0, -1.3, 0.8)
    x = signal.lfilter(b, a, x)
    b, a = ae.bell_biquad(2680.0, 2.1, 0.75)
    x = signal.lfilter(b, a, x)
    b, a = ae.bell_biquad(3900.0, 1.2, 1.1)
    x = signal.lfilter(b, a, x)
    b, a = ae.high_shelf(8800.0, 1.2, 0.8)
    x = signal.lfilter(b, a, x)
    x = _deess(x, fs)
    # A transparent 2:1 leveller; voice line consistency also comes from the
    # per-line LUFS normalisation after this chain.
    stereo = ae.bus_compress(
        np.stack([x, x]),
        threshold_db=-18.0,
        ratio=2.2,
        attack_ms=7.0,
        release_ms=130.0,
        makeup_db=0.8,
        knee_db=5.0,
        fs=fs,
    )
    x = stereo[0]
    # Short warm room, mostly centred.  The reverb is only 8% RMS.
    ir = ae.make_impulse_response(0.62, decay=0.19, predelay_ms=11.0, seed=603, brightness=5200)
    wet = ae.fft_convolve_stereo(np.stack([x, x]), ir)[:, : x.size]
    want = math.sqrt(float(np.mean(x * x))) * 0.085
    have = math.sqrt(float(np.mean(wet * wet)))
    if have > 1e-9:
        wet *= want / have
    wet = ae.filt(wet, "highpass", 180.0, 2)
    mix = np.stack([x, x]) + wet
    return mix


def process_voice_lines(lines: tuple[VoiceLine, ...] = LINES, *, fs: int = ae.SR) -> list[dict]:
    """Process all narration stems and return a manifest with exact timing."""
    out = []
    for line in lines:
        raw_path = VOICE_DIR / f"vo_{line.key}.mp3"
        raw = _decode_mp3(raw_path, fs)
        # Level the raw TTS before detection so thresholds are consistent.
        raw = ae.normalize_peak(raw, 0.82)
        tight, keeps = _tighten_silences(raw, fs, max_pause=line.max_pause)
        # Work at a sane level through the nonlinear stages.
        tight = ae.normalize_peak(tight, 0.62)
        processed = _voice_chain(tight, fs)  # (2, n)
        processed = processed / max(1.0, float(np.max(np.abs(processed))) / 0.93)
        # Per-line loudness consistency.  Keep peaks under control.
        lufs = ae.loudness_lufs(processed, fs)
        target = -17.6
        gain = ae.db_to_gain(target - lufs)
        processed *= gain
        pk = ae.peak_dbfs(processed)
        if pk > -3.0:
            processed *= ae.db_to_gain(-3.0 - pk)
        # Quantise the cue endpoints to a 30 fps frame so the visual editor can
        # cut cleanly without losing the actual spoken word.
        duration = processed.shape[1] / fs
        start = round(line.target_start * 30.0) / 30.0
        end_raw = start + duration
        end = round(end_raw * 30.0) / 30.0
        # If the line would cross its slot, warn but do not fake the voice.
        overflow = end - line.slot_end
        # Save a processed stem for auditing / remixing.
        stem = VOICE_DIR / f"vo_{line.key}_processed.wav"
        ae.write_wav24(stem, processed, fs, seed=900 + ord(line.key))
        manifest = {
            "key": line.key,
            "text": line.text,
            "start": start,
            "end": end,
            "raw_duration": raw.size / fs,
            "tight_duration": tight.size / fs,
            "processed_duration": duration,
            "slot_end": line.slot_end,
            "overflow": overflow,
            "lufs": ae.loudness_lufs(processed, fs),
            "peak_dbfs": ae.peak_dbfs(processed),
            "keeps": keeps,
        }
        out.append(manifest)
        print(
            f"  VO {line.key}: {duration:5.2f}s  ({start:.3f} → {end:.3f})  "
            f"LUFS {manifest['lufs']:.1f}  peak {manifest['peak_dbfs']:.1f}"
            + ("  OVERFLOW!" if overflow > 0.011 else "")
        )
    return out


def voice_bus_from_manifest(manifest: list[dict], fs: int = ae.SR) -> np.ndarray:
    """Load processed stems into one stereo VO bus (centred, no overlaps)."""
    duration = 44.8
    bus = np.zeros((2, int(duration * fs)))
    for item in manifest:
        fs_i, stem = ae.read_wav(VOICE_DIR / f"vo_{item['key']}_processed.wav")
        if fs_i != fs:
            raise ValueError("Unexpected processed VO sample rate")
        # The stem is exactly as long as the processed cue duration; placement
        # starts at the frame-quantised cue time.
        start = int(round(item["start"] * fs))
        # If frame rounding made the stem slightly longer, trim the quiet tail.
        max_len = int(round((item["end"] - item["start"]) * fs))
        stem = stem[:, :max_len]
        bus[:, start : start + stem.shape[1]] += stem
    return bus


if __name__ == "__main__":
    asyncio.run(ensure_tts(LINES))
    process_voice_lines()
