"""Objective diagnostics for the generated soundtrack (not part of the game)."""
import sys
from pathlib import Path
import numpy as np
from scipy import signal
sys.path.insert(0, str(Path(__file__).parent))
import audio_engine as ae

BANDS = [(20, 60), (60, 120), (120, 200), (200, 350), (350, 700), (700, 1500), (1500, 3000), (3000, 6000), (6000, 10000), (10000, 16000)]

def bands_pct(x):
    mono = np.mean(x, axis=0)
    f, p = signal.welch(mono, fs=ae.SR, nperseg=16384, noverlap=8192)
    total = np.trapezoid(p, f) + 1e-20
    out = []
    for lo, hi in BANDS:
        m = (f >= lo) & (f < hi)
        e = np.trapezoid(p[m], f[m]) if np.any(m) else 0.0
        out.append((lo, hi, 10*np.log10((e+1e-20)/total)))
    return out

def analyze(path):
    fs, x = ae.read_wav(path)
    l = ae.loudness_lufs(x)
    tp = ae.true_peak_db(x)
    pk = ae.peak_dbfs(x)
    rm = ae.rms_dbfs(x)
    dc = ae.dc_offset(x)
    clipped = int(np.sum(np.abs(x) >= 0.9999))
    # stereo width
    lc = x[0]; rc = x[1]
    corr = float(np.corrcoef(lc, rc)[0,1])
    side = (lc-rc)/2
    mid = (lc+rc)/2
    width = ae.rms_dbfs(side)-ae.rms_dbfs(mid)
    # short-term every 2 seconds
    win=2*fs
    levels=[]
    for i in range(0, x.shape[1], win):
        seg=x[:,i:i+win]
        if seg.shape[1]<fs: continue
        levels.append(20*np.log10(np.sqrt(np.mean(seg*seg))+1e-12))
    print(f"{Path(path).name}: duration {x.shape[1]/fs:.3f}s LUFS {l:.2f} TP {tp:.2f} peak {pk:.2f} RMS {rm:.2f} DC {dc:.2e} clip {clipped} corr {corr:.2f} width {width:.1f} dB")
    print("  bands rel dB: " + " ".join(f"{lo:g}-{hi:g}:{db:.1f}" for lo,hi,db in bands_pct(x)))
    print("  2s RMS: " + " ".join(f"{v:.1f}" for v in levels))

if __name__ == '__main__':
    for p in sys.argv[1:]:
        analyze(p)
