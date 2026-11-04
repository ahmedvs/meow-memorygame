# -*- coding: utf-8 -*-
"""Generate the cohesive hand-drawn fruit set used by Meow Memory."""
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "img" / "fruits"
OUT.mkdir(parents=True, exist_ok=True)

INK = "#432e45"
SHADOW = '<ellipse cx="80" cy="142" rx="42" ry="7" fill="#3a293b" opacity=".13"/>'


def face(cx=80, cy=86, gap=18, my=10, blush="#ff8e9d", scale=1.0):
    """A tiny, friendly kawaii face shared by all fruits."""
    s = scale
    return f'''<g class="fruit-face" transform="translate({cx} {cy}) scale({s})" fill="none">
  <ellipse cx="{-gap/2}" cy="0" rx="3.6" ry="5.2" fill="{INK}"/>
  <ellipse cx="{-gap/2+1.1}" cy="-1.7" rx="1.15" ry="1.65" fill="#fff" opacity=".9"/>
  <ellipse cx="{gap/2}" cy="0" rx="3.6" ry="5.2" fill="{INK}"/>
  <ellipse cx="{gap/2+1.1}" cy="-1.7" rx="1.15" ry="1.65" fill="#fff" opacity=".9"/>
  <path d="M-4.5 {my} Q0 {my+5.4} 4.5 {my}" stroke="{INK}" stroke-width="2.9" stroke-linecap="round"/>
  <ellipse cx="{-gap-6}" cy="{my-1}" rx="6.5" ry="3.2" fill="{blush}" opacity=".38"/>
  <ellipse cx="{gap+6}" cy="{my-1}" rx="6.5" ry="3.2" fill="{blush}" opacity=".38"/>
</g>'''


def svg(name, inner, defs=""):
    doc = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="160" height="160" role="img" aria-label="{name}" class="fruit fruit-{name}">
<defs>{defs}</defs>
{SHADOW}
{inner}
</svg>
'''
    (OUT / f"{name}.svg").write_text(doc, encoding="utf-8")


# ---------------------------------------------------------------- apple
defs = '''<linearGradient id="appleG" x1=".2" y1=".1" x2=".8" y2=".95">
<stop stop-color="#ff9585"/><stop offset=".52" stop-color="#f45b68"/><stop offset="1" stop-color="#cf3650"/>
</linearGradient>'''
inner = f'''
<path d="M80 51C71 39 58 35 46 38 28 42 20 60 25 80c5 24 24 52 41 53 8 1 10-6 14-6s7 7 16 6c17-2 35-30 39-53 3-20-5-38-23-42-12-3-24 2-32 13Z" fill="url(#appleG)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M80 49c2-12 5-20 10-27" stroke="#68452e" stroke-width="8" stroke-linecap="round"/>
<path d="M89 29c13-16 33-12 38-2-8 15-27 18-40 9Z" fill="#68b778" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M95 23c7-3 16-2 22 3" stroke="#b8e2ae" stroke-width="3.2" stroke-linecap="round" opacity=".85"/>
<path d="M48 61c-7 11-8 25-4 37" stroke="#ffd9d3" stroke-width="8" stroke-linecap="round" opacity=".6"/>
{face(80, 88, 22, 11)}
'''
svg("apple", inner, defs)

# ---------------------------------------------------------------- banana
defs = '''<linearGradient id="bananaG" x1=".15" y1=".2" x2=".9" y2=".9">
<stop stop-color="#ffe89b"/><stop offset=".5" stop-color="#ffd45f"/><stop offset="1" stop-color="#eda72f"/>
</linearGradient>'''
inner = f'''
<path d="M34 55c4 34 30 64 67 66 21 1 35-13 31-28-2-10-15-13-21-3-9 14-31 7-39-14-6-17-20-30-38-21Z" fill="url(#bananaG)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M34 55c-5-7-3-13 1-16 5-3 10 0 12 7" fill="#e9bd4d" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M121 82c8-2 13 1 13 8 0 4-4 7-10 8" fill="#eab347" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M45 63c7 24 25 44 50 49" fill="none" stroke="#e9a82c" stroke-width="4" stroke-linecap="round" opacity=".55"/>
<path d="M41 53c2 7 8 12 14 13" fill="none" stroke="#fff3bb" stroke-width="4" stroke-linecap="round" opacity=".9"/>
{face(82, 97, 18, 8, "#ffb489", .92)}
'''
svg("banana", inner, defs)

# ---------------------------------------------------------------- strawberry
defs = '''<linearGradient id="strawG" x1=".2" y1=".1" x2=".75" y2=".95">
<stop stop-color="#ff8e84"/><stop offset=".55" stop-color="#f55567"/><stop offset="1" stop-color="#d93654"/>
</linearGradient>'''
seeds = ''.join(
    f'<ellipse cx="{x}" cy="{y}" rx="2.5" ry="4" transform="rotate({r} {x} {y})" fill="#ffe8ac" opacity=".95"/>'
    for x, y, r in [(55, 72, -20), (74, 63, -8), (97, 69, 15), (108, 86, 25), (51, 94, -30),
                    (67, 111, -15), (91, 107, 12), (106, 106, 35), (61, 126, -5), (83, 130, 3)]
)
inner = f'''
<path d="M80 133c-24-10-48-40-42-67 5-21 29-29 42-14 13-15 37-7 42 14 6 27-18 57-42 67Z" fill="url(#strawG)" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
{seeds}
<path d="M48 53c4-12 12-20 23-23l-3 16 13-15 8 18 8-16 10 19 12-13c1 10-4 17-14 22-19 9-44 5-57-8Z" fill="#67b777" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M78 37c0-10 2-17 6-23" stroke="#497a3b" stroke-width="7" stroke-linecap="round"/>
<path d="M53 79c-5 9-6 20-2 30" stroke="#ffd1c9" stroke-width="6" stroke-linecap="round" opacity=".55"/>
{face(80, 90, 21, 11)}
'''
svg("strawberry", inner, defs)

# ---------------------------------------------------------------- grapes
defs = '''<linearGradient id="grapeG" x1=".15" y1=".1" x2=".85" y2=".95">
<stop stop-color="#c69ae2"/><stop offset=".5" stop-color="#a173c7"/><stop offset="1" stop-color="#7c54a7"/>
</linearGradient>
<filter id="grapeShadow" x="-30%" y="-30%" width="170%" height="170%">
<feDropShadow dx="1" dy="3" stdDeviation="2" flood-color="#4b2e5d" flood-opacity=".25"/>
</filter>'''
inner = f'''
<path d="M85 55C103 35 132 41 137 51c-10 13-30 15-46 9" fill="#6fba79" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M84 54c-1-12 1-22 8-31" stroke="#5f7138" stroke-width="6" stroke-linecap="round"/>
<g filter="url(#grapeShadow)" stroke="{INK}" stroke-width="4.5">
 <circle cx="53" cy="77" r="22" fill="url(#grapeG)"/>
 <circle cx="81" cy="70" r="23" fill="url(#grapeG)"/>
 <circle cx="110" cy="79" r="21" fill="url(#grapeG)"/>
 <circle cx="64" cy="101" r="20" fill="url(#grapeG)"/>
 <circle cx="96" cy="101" r="20" fill="url(#grapeG)"/>
 <circle cx="80" cy="120" r="17" fill="url(#grapeG)"/>
</g>
<g fill="#ead8f4" opacity=".6">
 <ellipse cx="46" cy="68" rx="6" ry="3.4" transform="rotate(-35 46 68)"/>
 <ellipse cx="74" cy="61" rx="7" ry="3.6" transform="rotate(-35 74 61)"/>
 <ellipse cx="104" cy="70" rx="6" ry="3.2" transform="rotate(-35 104 70)"/>
</g>
{face(81, 76, 14, 8, "#d59cba", .72)}
'''
svg("grapes", inner, defs)

# ---------------------------------------------------------------- orange
defs = '''<radialGradient id="orangeG" cx=".35" cy=".25" r=".8">
<stop stop-color="#ffcf72"/><stop offset=".62" stop-color="#ffa94d"/><stop offset="1" stop-color="#ed7d2f"/>
</radialGradient>'''
inner = f'''
<circle cx="80" cy="87" r="49" fill="url(#orangeG)" stroke="{INK}" stroke-width="6"/>
<path d="M81 39c3-10 7-17 14-24" stroke="#5f6b37" stroke-width="6" stroke-linecap="round"/>
<path d="M92 28c14-12 30-6 34 3-9 12-24 12-36 5Z" fill="#6fbb78" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<g fill="#d77b2d" opacity=".5">
 <circle cx="54" cy="62" r="1.7"/><circle cx="106" cy="63" r="1.7"/><circle cx="112" cy="96" r="1.7"/>
 <circle cx="48" cy="99" r="1.7"/><circle cx="85" cy="127" r="1.7"/><circle cx="63" cy="121" r="1.7"/>
</g>
<path d="M46 61c-7 12-8 26-4 38" stroke="#ffe6ad" stroke-width="7" stroke-linecap="round" opacity=".58"/>
{face(80, 90, 22, 11)}
'''
svg("orange", inner, defs)

# ---------------------------------------------------------------- kiwi
defs = '''<radialGradient id="kiwiG" cx=".45" cy=".4" r=".7">
<stop stop-color="#c5e884"/><stop offset=".6" stop-color="#95c95a"/><stop offset="1" stop-color="#6ca845"/>
</radialGradient>'''
seeds = ''.join(
    f'<ellipse cx="{80 + 29 * __import__("math").cos(__import__("math").radians(a)):.1f}" cy="{86 + 29 * __import__("math").sin(__import__("math").radians(a)):.1f}" rx="2.1" ry="4" transform="rotate({a+90} {80 + 29 * __import__("math").cos(__import__("math").radians(a)):.1f} {86 + 29 * __import__("math").sin(__import__("math").radians(a)):.1f})" fill="#3d2f2a"/>'
    for a in range(10, 360, 30)
)
inner = f'''
<circle cx="80" cy="86" r="50" fill="#a77a4f" stroke="{INK}" stroke-width="6"/>
<circle cx="80" cy="86" r="43" fill="url(#kiwiG)" stroke="{INK}" stroke-width="4"/>
<circle cx="80" cy="86" r="18" fill="#f2f5cf" opacity=".96"/>
{seeds}
<g stroke="#e2efb3" stroke-width="2" opacity=".55">
 <path d="M57 60c9 6 14 15 16 26"/><path d="M103 60c-9 6-14 15-16 26"/>
 <path d="M56 111c10-5 16-13 18-25"/><path d="M104 111c-10-5-16-13-18-25"/>
</g>
<path d="M48 70c-4 7-6 15-6 23" stroke="#e4f6b7" stroke-width="5" stroke-linecap="round" opacity=".6"/>
{face(80, 86, 17, 9, "#d79a9a", .85)}
'''
svg("kiwi", inner, defs)

# ---------------------------------------------------------------- peach
defs = '''<linearGradient id="peachG" x1=".2" y1=".1" x2=".8" y2=".95">
<stop stop-color="#ffd6b8"/><stop offset=".45" stop-color="#ffb095"/><stop offset=".8" stop-color="#f48d89"/><stop offset="1" stop-color="#e97583"/>
</linearGradient>'''
inner = f'''
<path d="M80 49c21-18 48-7 55 17 8 28-16 59-55 67-39-8-63-39-55-67 7-24 34-35 55-17Z" fill="url(#peachG)" stroke="{INK}" stroke-width="6"/>
<path d="M80 49c-8 11-9 25-2 36" stroke="#dd7780" stroke-width="4" stroke-linecap="round" opacity=".6"/>
<path d="M82 48c2-12 7-20 15-26" stroke="#6e5730" stroke-width="5" stroke-linecap="round"/>
<path d="M94 28c14-13 31-6 35 4-10 12-27 12-38 4Z" fill="#6eb97a" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M47 61c-7 10-9 23-7 34" stroke="#ffe9dc" stroke-width="7" stroke-linecap="round" opacity=".6"/>
{face(80, 91, 22, 11)}
'''
svg("peach", inner, defs)

# ---------------------------------------------------------------- watermelon
defs = '''<linearGradient id="melonG" x1=".2" y1=".1" x2=".7" y2=".95">
<stop stop-color="#ff8991"/><stop offset=".6" stop-color="#f25f70"/><stop offset="1" stop-color="#dc435b"/>
</linearGradient>'''
inner = f'''
<path d="M24 82a56 56 0 0 1 112 0L80 143Z" fill="#4eaa63" stroke="{INK}" stroke-width="6" stroke-linejoin="round"/>
<path d="M33 82a47 47 0 0 1 94 0L80 134Z" fill="#f8f4dd"/>
<path d="M39 82a41 41 0 0 1 82 0L80 126Z" fill="url(#melonG)"/>
<path d="M28 82a52 52 0 0 1 104 0" fill="none" stroke="#88cf88" stroke-width="4" opacity=".8"/>
<g fill="#4b3033">
 <ellipse cx="57" cy="83" rx="2.6" ry="4.4" transform="rotate(-18 57 83)"/>
 <ellipse cx="104" cy="83" rx="2.6" ry="4.4" transform="rotate(18 104 83)"/>
 <ellipse cx="46" cy="102" rx="2.5" ry="4.3" transform="rotate(-24 46 102)"/>
 <ellipse cx="114" cy="102" rx="2.5" ry="4.3" transform="rotate(24 114 102)"/>
</g>
<path d="M45 69c4 4 7 8 9 13" stroke="#ffd6d5" stroke-width="4" stroke-linecap="round" opacity=".55"/>
{face(80, 92, 20, 10, "#c64f64", .9)}
'''
svg("watermelon", inner, defs)

# ---------------------------------------------------------------- pineapple
defs = '''<linearGradient id="pineG" x1=".2" y1=".1" x2=".8" y2=".9">
<stop stop-color="#ffe392"/><stop offset=".55" stop-color="#f6c25d"/><stop offset="1" stop-color="#db9e32"/>
</linearGradient>'''
inner = f'''
<path d="M80 65C69 50 67 34 78 18c3 11 7 19 12 24 0-13 4-24 13-35 4 17 4 30-1 42Z" fill="#68b97a" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M76 30c-8-9-17-13-28-14 2 11 8 20 18 27" fill="#82c98a" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M97 31c8-7 17-10 27-10-3 10-8 17-17 23" fill="#82c98a" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M80 50c-27 0-38 15-38 41 0 28 16 46 38 46s38-18 38-46c0-26-11-41-38-41Z" fill="url(#pineG)" stroke="{INK}" stroke-width="6"/>
<g stroke="#c98827" stroke-width="2.6" opacity=".7">
 <path d="M46 68 111 125"/><path d="M56 56 123 99"/><path d="M113 68 49 125"/><path d="M104 56 38 99"/>
</g>
<g fill="#a96f1f" opacity=".55">
 <circle cx="70" cy="72" r="2"/><circle cx="94" cy="77" r="2"/><circle cx="58" cy="92" r="2"/>
 <circle cx="105" cy="98" r="2"/><circle cx="76" cy="112" r="2"/>
</g>
<path d="M51 71c-6 13-6 29-1 43" stroke="#fff0b6" stroke-width="5.5" stroke-linecap="round" opacity=".55"/>
{face(80, 94, 20, 10, "#e0a067", .95)}
'''
svg("pineapple", inner, defs)

# ---------------------------------------------------------------- lemon
defs = '''<linearGradient id="lemonG" x1=".2" y1=".15" x2=".8" y2=".9">
<stop stop-color="#fff3a1"/><stop offset=".52" stop-color="#ffe05c"/><stop offset="1" stop-color="#e8b933"/>
</linearGradient>'''
inner = f'''
<path d="M32 72c6-22 29-37 55-34 24 3 44 23 42 43-2 21-25 37-51 36-29-1-52-22-46-45Z" fill="url(#lemonG)" stroke="{INK}" stroke-width="6"/>
<path d="M32 72c-5-5-8-11-7-17 7 1 12 5 16 10" fill="#efc63d" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M128 75c6 3 9 8 10 14-8 1-14-2-19-7" fill="#efc63d" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M91 41c7-11 16-16 28-18-2 12-8 20-18 26Z" fill="#71ba7a" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<g fill="#d3a525" opacity=".4">
 <circle cx="59" cy="59" r="1.6"/><circle cx="77" cy="52" r="1.6"/><circle cx="112" cy="99" r="1.6"/>
</g>
<path d="M45 69c-3 8-2 17 2 24" stroke="#fff8c9" stroke-width="6" stroke-linecap="round" opacity=".65"/>
{face(82, 80, 22, 11)}
'''
svg("lemon", inner, defs)

# ---------------------------------------------------------------- cherry
defs = '''<radialGradient id="cherryG" cx=".33" cy=".25" r=".8">
<stop stop-color="#ff8d92"/><stop offset=".55" stop-color="#e74358"/><stop offset="1" stop-color="#b62d47"/>
</radialGradient>'''
inner = f'''
<path d="M58 96c5-25 17-41 36-52" fill="none" stroke="#50743a" stroke-width="6" stroke-linecap="round"/>
<path d="M103 106c1-26-2-43-9-52" fill="none" stroke="#50743a" stroke-width="6" stroke-linecap="round"/>
<path d="M92 40c9-10 22-13 34-9-5 12-16 19-30 17Z" fill="#72bd79" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<circle cx="58" cy="108" r="25" fill="url(#cherryG)" stroke="{INK}" stroke-width="5.5"/>
<circle cx="105" cy="119" r="22" fill="url(#cherryG)" stroke="{INK}" stroke-width="5.5"/>
<ellipse cx="50" cy="99" rx="5" ry="2.8" transform="rotate(-40 50 99)" fill="#ffd3d3" opacity=".6"/>
<ellipse cx="98" cy="111" rx="4.5" ry="2.5" transform="rotate(-40 98 111)" fill="#ffd3d3" opacity=".6"/>
{face(58, 110, 15, 8, "#ff9cab", .76)}
'''
svg("cherry", inner, defs)

# ---------------------------------------------------------------- mango
defs = '''<radialGradient id="mangoG" cx=".35" cy=".25" r=".9">
<stop stop-color="#ffe07a"/><stop offset=".5" stop-color="#ffc150"/><stop offset=".8" stop-color="#f8a144"/><stop offset="1" stop-color="#eb7a54"/>
</radialGradient>'''
inner = f'''
<path d="M41 61c13-25 48-31 69-11 21 20 17 54-7 70-25 17-56 7-67-15-7-15-3-31 5-44Z" fill="url(#mangoG)" stroke="{INK}" stroke-width="6"/>
<path d="M54 53c10-9 22-13 35-11" fill="none" stroke="#ffe8a1" stroke-width="6" stroke-linecap="round" opacity=".5"/>
<path d="M98 49c5-10 13-17 24-20 0 12-4 21-13 28Z" fill="#6eb976" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M99 43c-1-8 1-14 5-20" stroke="#58763b" stroke-width="4.5" stroke-linecap="round"/>
<path d="M111 106c-7 11-20 18-34 18" fill="none" stroke="#e97554" stroke-width="6" stroke-linecap="round" opacity=".4"/>
{face(78, 82, 21, 10)}
'''
svg("mango", inner, defs)

# ---------------------------------------------------------------- pomegranate
defs = '''<radialGradient id="pomG" cx=".35" cy=".25" r=".8">
<stop stop-color="#ff8b78"/><stop offset=".5" stop-color="#e14f56"/><stop offset="1" stop-color="#b72f49"/>
</radialGradient>'''
inner = f'''
<path d="M80 53c-27 0-48 21-48 47 0 25 21 40 48 40s48-15 48-40c0-26-21-47-48-47Z" fill="url(#pomG)" stroke="{INK}" stroke-width="6"/>
<path d="M65 50l4-17 11 11 5-18 7 18 9-12 4 20Z" fill="#d84d50" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>
<path d="M87 48c10-9 22-10 32-4-6 10-18 14-31 10" fill="#6bb775" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M78 108c-12-14-10-32 8-39 15 8 18 25 5 39-4 4-9 4-13 0Z" fill="#8d263c" opacity=".65"/>
<g fill="#ffd0d1">
 <circle cx="79" cy="84" r="2.4"/><circle cx="88" cy="92" r="2.2"/><circle cx="79" cy="99" r="2.1"/><circle cx="88" cy="105" r="1.8"/>
</g>
<path d="M48 70c-6 11-7 24-4 35" stroke="#ffccc5" stroke-width="6" stroke-linecap="round" opacity=".55"/>
{face(80, 88, 22, 11)}
'''
svg("pomegranate", inner, defs)

# ---------------------------------------------------------------- pear
defs = '''<linearGradient id="pearG" x1=".2" y1=".1" x2=".8" y2=".95">
<stop stop-color="#d9eb91"/><stop offset=".5" stop-color="#b9d36f"/><stop offset="1" stop-color="#8db450"/>
</linearGradient>'''
inner = f'''
<path d="M80 49c13 0 19 14 14 27 15 10 23 28 16 43-7 16-53 16-60 0-7-15 1-33 16-43-5-13 1-27 14-27Z" fill="url(#pearG)" stroke="{INK}" stroke-width="6"/>
<path d="M80 48c1-9 3-15 7-21" stroke="#6d5431" stroke-width="6" stroke-linecap="round"/>
<path d="M87 32c11-11 26-9 32-1-7 11-21 13-32 7Z" fill="#6db777" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M52 82c-4 13-3 25 2 34" stroke="#f1f8c9" stroke-width="6" stroke-linecap="round" opacity=".6"/>
<g fill="#6d8b42" opacity=".4">
 <circle cx="68" cy="107" r="1.4"/><circle cx="95" cy="91" r="1.4"/><circle cx="102" cy="114" r="1.4"/>
</g>
{face(80, 86, 22, 11)}
'''
svg("pear", inner, defs)

# ---------------------------------------------------------------- fig
defs = '''<linearGradient id="figG" x1=".2" y1=".1" x2=".8" y2=".95">
<stop stop-color="#b98ac8"/><stop offset=".45" stop-color="#9365ad"/><stop offset="1" stop-color="#71478d"/>
</linearGradient>
<radialGradient id="figCutG" cx=".55" cy=".35" r=".8">
<stop stop-color="#ffc8b9"/><stop offset=".6" stop-color="#e99792"/><stop offset="1" stop-color="#c77179"/>
</radialGradient>'''
inner = f'''
<path d="M80 42c17 0 28 16 29 36 2 26-12 52-29 58-17-6-31-32-29-58 1-20 12-36 29-36Z" fill="url(#figG)" stroke="{INK}" stroke-width="6"/>
<path d="M81 43c0-9 2-15 6-21" stroke="#5f713c" stroke-width="6" stroke-linecap="round"/>
<path d="M88 31c13-11 28-6 33 3-9 10-23 11-34 4Z" fill="#70b77a" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>
<path d="M86 68c14-9 28-2 31 11 3 14-8 26-22 24-12-2-17-12-14-23 1-5 2-9 5-12Z" fill="url(#figCutG)" stroke="{INK}" stroke-width="3.5"/>
<g fill="#ecc1a1">
 <circle cx="98" cy="78" r="2.1"/><circle cx="108" cy="84" r="2"/><circle cx="95" cy="90" r="2"/>
 <circle cx="104" cy="96" r="1.8"/><circle cx="112" cy="72" r="1.7"/>
</g>
<path d="M58 68c-5 16-3 32 5 45" stroke="#e3c8ec" stroke-width="5" stroke-linecap="round" opacity=".45"/>
{face(68, 98, 18, 9, "#dba0b2", .88)}
'''
svg("fig", inner, defs)

print(f"Wrote {len(list(OUT.glob('*.svg')))} fruit SVGs to {OUT}")
