"""Final technical audit of the delivered Meow Memory audio files."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import audio_engine as ae

ROOT = Path(__file__).resolve().parents[1]
AUDIO = ROOT / "assets" / "audio"


def ffprobe(path: Path) -> dict:
    props = {}
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration,size,bit_rate:stream=codec_name,sample_rate,channels",
         "-of", "json", str(path)],
        text=True,
    )
    d = json.loads(out)
    props["duration"] = float(d["format"]["duration"])
    props["size"] = int(d["format"]["size"])
    props["bit_rate"] = int(d["format"].get("bit_rate", 0))
    props["codec"] = d["streams"][0]["codec_name"]
    props["sample_rate"] = int(d["streams"][0]["sample_rate"])
    props["channels"] = int(d["streams"][0]["channels"])
    return props


def decode(path: Path) -> tuple[int, np.ndarray]:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
         "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "pipe:1"],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    # Keep the source rate (all deliverables are 48 kHz).
    x = np.frombuffer(proc.stdout, dtype="<f4").astype(np.float64).reshape(-1, 2).T
    return 48000, x


def ebur128(path: Path) -> dict:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
         "-filter_complex", "ebur128=peak=true", "-f", "null", "NUL"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        encoding="utf-8", errors="replace",
    )
    s = proc.stderr
    out = {}
    m = re.findall(r"I:\s*(-?\d+(?:\.\d+)?)\s*LUFS", s)
    if m:
        out["integrated_lufs"] = float(m[-1])
    lp = re.findall(r"LRA:\s*(-?\d+(?:\.\d+)?)\s*LU", s)
    if lp:
        out["lra"] = float(lp[-1])
    peaks = re.findall(r"Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS", s)
    if peaks:
        out["true_peak_dbfs"] = float(peaks[-1])
    return out


def startup(path: Path, x: np.ndarray) -> dict:
    n0 = min(x.shape[1], 4800)
    max_abs = np.max(np.abs(x[:, :n0]), axis=0)
    idx = np.flatnonzero(max_abs > 1e-5)
    first_audible = int(idx[0]) if idx.size else -1
    nz = np.flatnonzero(np.max(np.abs(x[:, :n0]), axis=0) > 0.0)
    first_nonzero = int(nz[0]) if nz.size else -1
    return {
        "first_nonzero_sample": first_nonzero,
        "first_above_1e-5": first_audible,
        "rms_first_10ms_dbfs": float(ae.rms_dbfs(x[:, : int(0.010 * 48000)])),
        "rms_first_50ms_dbfs": float(ae.rms_dbfs(x[:, : int(0.050 * 48000)])),
        "sample0_absmax": float(np.max(np.abs(x[:, 0]))),
    }


def loop_check(x: np.ndarray) -> dict:
    fs = 48000
    w = int(0.050 * fs)
    start = x[:, :w]
    end = x[:, -w:]
    step = np.abs(x[:, 0] - x[:, -1])
    # Typical one-step adjacent differences in the same loud end/start windows.
    d_start = np.abs(np.diff(x[:, :w], axis=1))
    d_end = np.abs(np.diff(x[:, -w:], axis=1))
    typical = np.percentile(np.concatenate([d_start.ravel(), d_end.ravel()]), 99.9)
    # Local periodic waveform before/after the seam.
    seam = np.concatenate([x[:, -int(0.025 * fs):], x[:, : int(0.025 * fs)]], axis=1)
    return {
        "first_50ms_rms_dbfs": float(ae.rms_dbfs(start)),
        "last_50ms_rms_dbfs": float(ae.rms_dbfs(end)),
        "first_50ms_peak_dbfs": float(ae.peak_dbfs(start)),
        "last_50ms_peak_dbfs": float(ae.peak_dbfs(end)),
        "seam_step_max": float(np.max(step)),
        "seam_p999_adjacent_step": float(typical),
        "seam_step_over_p999": float(np.max(step) / max(typical, 1e-12)),
        "seam_step_l_dbfs": float(ae.peak_dbfs(seam[0])),
        "dc": float(ae.dc_offset(x)),
        "clipped_samples": int(np.sum(np.abs(x) >= 0.99999)),
    }


def cue_check() -> dict:
    cues = json.loads((AUDIO / "trailer-cues.json").read_text(encoding="utf-8"))
    arrays = cues["cues"]
    starts = {c["label"].split(" start", 1)[0]: c["t"] for c in arrays if c["type"] == "voiceover_start"}
    ends = {c["label"].split(" end", 1)[0]: c["t"] for c in arrays if c["type"] == "voiceover_end"}
    overlaps = []
    ordered = sorted(arrays, key=lambda c: c["t"])
    spans = [(c["t"], c["label"]) for c in ordered if c["type"] in ("voiceover_start", "voiceover_end")]
    last_end = -1
    for c in ordered:
        if c["type"] == "voiceover_start":
            if c["t"] < last_end - 1e-6:
                overlaps.append(c["label"])
        elif c["type"] == "voiceover_end":
            last_end = c["t"]
    types = {}
    for c in arrays:
        types[c["type"]] = types.get(c["type"], 0) + 1
    sections = [c["t"] for c in arrays if c["type"] == "section"]
    return {
        "duration": cues["duration"],
        "bpm": cues["bpm"],
        "beat": cues["beat"],
        "bar": cues["bar"],
        "cue_count": len(arrays),
        "sections": sections,
        "types": types,
        "vo_openings": len(starts),
        "vo_closings": len(ends),
        "all_vo_paired": len(starts) == len(ends),
        "vo_overlaps": overlaps,
        "last_cue": ordered[-1],
        "sorted": all(ordered[i]["t"] <= ordered[i + 1]["t"] for i in range(len(ordered) - 1)),
    }


def main() -> None:
    files = [
        AUDIO / "menu-theme.ogg", AUDIO / "menu-theme.mp3",
        AUDIO / "battle-theme.ogg", AUDIO / "battle-theme.mp3",
        AUDIO / "trailer-mix.wav", AUDIO / "trailer-mix.mp3",
        ROOT / "tools" / "audio-src" / "menu-theme.wav",
        ROOT / "tools" / "audio-src" / "battle-theme.wav",
    ]
    print("FILE PROBE")
    for p in files:
        meta = ffprobe(p)
        print(p.relative_to(ROOT), meta)
    print("\nLOUDNESS (ffmpeg ebur128)")
    for p in files:
        print(p.name, ebur128(p))
    print("\nDECODED STARTUP / PEAK / LOOP")
    for p in files:
        fs, x = decode(p)
        print(p.name, "startup", startup(p, x), "peak", round(ae.peak_dbfs(x), 3),
              "tp", round(ae.true_peak_db(x), 3), "dc", f"{ae.dc_offset(x):+.2e}")
        if "menu" in p.name or "battle" in p.name:
            if p.suffix in (".wav", ".ogg", ".mp3"):
                print("   loop", loop_check(x))
    print("\nCUES")
    print(json.dumps(cue_check(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
