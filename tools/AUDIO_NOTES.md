# Meow Memory — Original Soundtrack / الموسيقى الأصلية للعبة

Originally synthesized from code for the game *مياو ميموري*. No samples,
stock loops, or downloaded music are used. The Arabic narration is generated
with edge-tts and treated with first-party DSP.

## Files
- `assets/audio/menu-theme.ogg` / `.mp3` — warm menu loop, 43.636 s.
- `tools/audio-src/menu-theme.wav` — 24-bit/48 kHz source master.
- `assets/audio/battle-theme.ogg` / `.mp3` — action loop, 34.286 s.
- `tools/audio-src/battle-theme.wav` — 24-bit/48 kHz source master.
- `assets/audio/trailer-mix.wav` / `.mp3` — 44.800 s vertical-trailer master.
- `assets/audio/trailer-cues.json` — frame-friendly cue map for the editor.

## Rebuild
```powershell
cd "D:\لعبة سيارات"
$env:PYTHONUTF8='1'
python tools/generate_audio.py
```
Use `--only menu|battle|trailer` for one deliverable and `--force-tts` to
refresh the cached narration. All music is deterministic; seeds live in
`tools/generate_audio.py`. Narration stems are cached under
`tools/audio-src/voice/`, so a normal rerun does not need the network.

## Music
- Key: D minor / Nahawand, with Bb and C# harmonic-minor colour; occasional
  E-natural melodic passing tones. The 4-note **meow motif** is A–D–F–E
  (scale degrees 5–8–10–9) and recurs in all three pieces.
- Menu: 88 BPM, 16 bars 4/4, 43.636 s. Oud/harp plucks, detuned warm pad,
  celesta, rounded sub, brushed darbuka and shaker.
- Battle: 112 BPM, 16 bars 4/4, 34.286 s. Plucked hook, maqsum-inspired
  darbuka, soft kick/claps/hats, sidechained pad/bass, 4-bar stingers.
- Trailer: 100 BPM, 44.800 s (beat 0.6 s, bar 2.4 s), 48 kHz stereo.

## Trailer structure
- 0.0 intro — dark drone, distant sparkle, heartbeat, cat-eye glint.
- 2.4 title reveal — magical impact and meow motif, no heavy drums.
- 4.8 logo/tagline — warm swell, soft pulse begins.
- 7.2 menu showcase — light groove, plucks, bells.
- 12.0 fruit/card montage & first gameplay — beat enters, darbuka, card ticks.
- 19.2 duel — bigger percussion and stereo call/response.
- 24.0 power montage — zap/sparkle/whoosh hits at 24.0/25.2/26.4/28.2.
- 28.8 feature/documentary montage — short breakdown, steady drive, accents each 0.6 s.
- 33.6 dedication — drums out, piano/pad/bells, heartbeat; riser at 35.4.
- 36.0 final lift — impact and confetti, full warm theme.
- 40.8 end card — motif and soft final chord, fade to silence at 44.8.

## Voiceover
Voice: `ar-EG-SalmaNeural`, generated per line, rate ~+6%, pitch +2 Hz.
Each line is trimmed/condensed transiently, high-passed near 92 Hz, presence-
lifted around 2.7–3.9 kHz, de-essed, lightly compressed, and given a whisper of
short room. Listed times are actual placed starts and ends from the processed stems.


## Measured delivery
- trailer-mix: 44.800 s, -14.19 LUFS, true peak -1.8 dBTP, peak -2.3 dBFS.

## Loops and practical notes
- Loops are rendered from cyclic patterns; a 12 ms equal-power seam crossfade
  uses a rendered continuation and introduces no gap, fade or silence.
  Prefer the OGG on the web: Vorbis loops without encoder padding. The OGG
  files carry no extra leading samples.
- MP3 is provided for compatibility. LAME stores gapless metadata, but some
  browser `HTMLAudioElement` implementations still insert a short decoder
  pause when repeating MP3. Use `menu-theme.ogg` / `battle-theme.ogg` for
  gapless playback where supported, and keep the MP3 as the fallback.
- Voice and music are deliberately separate buses; music is ducked 6 dB under
  narration (sound design ~2.8 dB) with smooth 0.10 s attack / 0.32 s release.
- Compromise: the dedication line starts at 33.60 s (instead of ~33.8 s) so its
  spoken end lands on the 36.0 s drop without overlapping the final lift.

## Cue JSON
`assets/audio/trailer-cues.json` lists every section boundary, major impact,
transition/whoosh, montage accent, and VO phrase start/end. All cue times are
quantised to 30 fps (1/30 s) and match the 44.8 s master.
