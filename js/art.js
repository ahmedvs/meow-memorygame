/* Meow Memory — shared hand-drawn artwork and game data. */
(function () {
  'use strict';

  const fruitDefs = [
    { id: 'apple',       name: 'تفاحة',      color: '#f45b68', treat: 'مقرمشة' },
    { id: 'strawberry',  name: 'فراولة',     color: '#f55567', treat: 'حلوة' },
    { id: 'banana',      name: 'موزة',       color: '#ffd45f', treat: 'مغذية' },
    { id: 'grapes',      name: 'عنب',        color: '#a173c7', treat: 'عنقود سعادة' },
    { id: 'orange',      name: 'برتقالة',    color: '#ffa94d', treat: 'منعشة' },
    { id: 'kiwi',        name: 'كيوي',       color: '#95c95a', treat: 'خفيفة' },
    { id: 'peach',       name: 'خوخة',       color: '#ffb095', treat: 'ناعمة' },
    { id: 'watermelon',  name: 'بطيخ',       color: '#f25f70', treat: 'صيفية' },
    { id: 'pineapple',   name: 'أناناس',     color: '#f6c25d', treat: 'استوائية' },
    { id: 'lemon',       name: 'ليمونة',     color: '#ffe05c', treat: 'مشمسة' },
    { id: 'cherry',      name: 'كرز',        color: '#e74358', treat: 'لؤلؤية' },
    { id: 'mango',       name: 'مانجو',      color: '#ffc150', treat: 'استوائية' },
    { id: 'pomegranate', name: 'رمان',       color: '#e14f56', treat: 'ياقوتية' },
    { id: 'pear',        name: 'كمثرى',      color: '#b9d36f', treat: 'هادئة' },
    { id: 'fig',         name: 'تين',        color: '#9365ad', treat: 'ملكية' }
  ];

  const catDefs = [
    { id: 'lulu',   name: 'لولو',   fur: '#f7dfc6', furDark: '#e8c3a4', inner: '#f5b0b3', accessory: '#a98ade', accessory2: '#7960b8', eye: '#e9a846', swatch: '#f2cfae', trait: 'القطة الحالمة', unlocked: true, need: 0 },
    { id: 'zaatar', name: 'زعتر',   fur: '#9ab5cf', furDark: '#7898b8', inner: '#d6a9bd', accessory: '#67b7d4', accessory2: '#3b8ba9', eye: '#f2c85b', swatch: '#8fb1d2', trait: 'القطة الذكية', unlocked: true, need: 0 },
    { id: 'mishmish', name: 'مشمش', fur: '#f2c38d', furDark: '#dba46b', inner: '#f3a6a0', accessory: '#ef9a75', accessory2: '#ca6c53', eye: '#80a94d', swatch: '#eab27c', trait: 'القطة المشاكسة', unlocked: false, need: 40 },
    { id: 'layl',   name: 'ليل',    fur: '#817593', furDark: '#65566e', inner: '#b28ba6', accessory: '#f5c869', accessory2: '#c99a3c', eye: '#ffd56b', swatch: '#756a87', trait: 'قطة منتصف الليل', unlocked: false, need: 90 },
    { id: 'naanaa', name: 'نعناع',  fur: '#aed9bd', furDark: '#8fc0a0', inner: '#eab8c8', accessory: '#ec8daa', accessory2: '#c46484', eye: '#7b8f4e', swatch: '#a2d3b3', trait: 'القطة المنعشة', unlocked: false, need: 150 }
  ];

  /* Exterior mascot. The SVG is injected inline so every ear, eye and paw can move. */
  const mascot = `
<svg class="mascot-svg" viewBox="0 0 440 500" role="img" aria-label="لولو، قطة مياو ميموري">
  <defs>
    <linearGradient id="m-fur" x1=".2" y1=".1" x2=".8" y2=".95">
      <stop stop-color="#fff6e9"/><stop offset=".55" stop-color="#f9e3ce"/><stop offset="1" stop-color="#f0d0b6"/>
    </linearGradient>
    <linearGradient id="m-fur-dark" x1=".2" y1=".1" x2=".8" y2=".9">
      <stop stop-color="#f6ddc4"/><stop offset="1" stop-color="#e8c1a2"/>
    </linearGradient>
    <linearGradient id="m-ear" x1=".2" y1=".05" x2=".8" y2=".9">
      <stop stop-color="#f9bdc0"/><stop offset="1" stop-color="#e999a3"/>
    </linearGradient>
    <linearGradient id="m-scarf" x1=".1" y1=".1" x2=".9" y2=".9">
      <stop stop-color="#c2a4ec"/><stop offset=".55" stop-color="#a184d6"/><stop offset="1" stop-color="#8167bd"/>
    </linearGradient>
    <linearGradient id="m-card" x1=".15" y1=".1" x2=".8" y2=".95">
      <stop stop-color="#a57ca4"/><stop offset=".5" stop-color="#8b628d"/><stop offset="1" stop-color="#6f4b76"/>
    </linearGradient>
    <radialGradient id="m-eye" cx=".4" cy=".3" r=".8">
      <stop stop-color="#ffe3a0"/><stop offset=".5" stop-color="#eeae4e"/><stop offset="1" stop-color="#c47c2f"/>
    </radialGradient>
    <linearGradient id="m-bell" x1=".2" y1=".1" x2=".8" y2=".9">
      <stop stop-color="#ffe7a3"/><stop offset=".55" stop-color="#f3c25c"/><stop offset="1" stop-color="#c9953b"/>
    </linearGradient>
    <filter id="m-soft" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#422d45" flood-opacity=".18"/>
    </filter>
    <filter id="m-paw-shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="2" dy="4" stdDeviation="3" flood-color="#402c44" flood-opacity=".25"/>
    </filter>
  </defs>

  <ellipse cx="222" cy="465" rx="128" ry="19" fill="#4b3551" opacity=".16"/>

  <g class="mascot-tail" style="transform-origin: 320px 410px">
    <path d="M316 420c58 17 92-15 88-54-3-31-31-45-47-28-13 14-3 34 14 31" fill="none" stroke="#402c44" stroke-width="54" stroke-linecap="round"/>
    <path d="M316 420c58 17 92-15 88-54-3-31-31-45-47-28-13 14-3 34 14 31" fill="none" stroke="url(#m-fur)" stroke-width="42" stroke-linecap="round"/>
    <path d="M384 392c12-3 19-11 20-21" fill="none" stroke="#e3b795" stroke-width="10" stroke-linecap="round" opacity=".85"/>
  </g>

  <g class="mascot-body" filter="url(#m-soft)">
    <path d="M220 278c-76 0-118 63-110 127 7 59 43 88 110 88s103-29 110-88c8-64-34-127-110-127Z" fill="url(#m-fur)" stroke="#402c44" stroke-width="7"/>
    <path d="M220 326c-42 0-72 32-76 80-4 44 25 72 76 72s80-28 76-72c-4-48-34-80-76-80Z" fill="#fff3e3" opacity=".65"/>
    <path d="M220 397c-7 0-12 5-12 12s5 12 12 12 12-5 12-12-5-12-12-12Z" fill="#f3c8ad" opacity=".35"/>
    <g stroke="#402c44" stroke-width="6" stroke-linecap="round">
      <path d="M166 455c15-9 38-8 52 0" fill="none"/>
      <path d="M222 455c15-9 38-8 52 0" fill="none"/>
    </g>
  </g>

  <g class="mascot-ears" filter="url(#m-soft)">
    <path d="M126 34C113 63 112 105 129 153c17-5 36-8 56-10-8-35-27-78-59-109Z" fill="url(#m-fur)" stroke="#402c44" stroke-width="7" stroke-linejoin="round"/>
    <path d="M314 34c13 29 14 71-3 119-17-5-36-8-56-10 8-35 27-78 59-109Z" fill="url(#m-fur)" stroke="#402c44" stroke-width="7" stroke-linejoin="round"/>
    <path d="M132 55c-9 27-9 56 2 84 10-17 23-31 36-41-12-20-24-34-38-43Z" fill="url(#m-ear)" opacity=".9"/>
    <path d="M308 55c9 27 9 56-2 84-10-17-23-31-36-41 12-20 24-34 38-43Z" fill="url(#m-ear)" opacity=".9"/>
  </g>

  <g class="mascot-head" filter="url(#m-soft)">
    <path d="M220 108C282 108 331 161 333 226C335 290 286 329 220 329C154 329 105 290 107 226C109 161 158 108 220 108Z" fill="url(#m-fur)" stroke="#402c44" stroke-width="7" stroke-linejoin="round"/>
    <path d="M196 122c15 6 33 6 48 0" fill="none" stroke="#e8c4a8" stroke-width="7" stroke-linecap="round" opacity=".65"/>
    <g fill="#d9ad8d" opacity=".65">
      <path d="M207 129c4 13 3 25-2 36" stroke="#d9ad8d" stroke-width="7" stroke-linecap="round"/>
      <path d="M220 126c1 14 0 27-3 39" stroke="#d9ad8d" stroke-width="7" stroke-linecap="round"/>
      <path d="M233 129c-4 13-3 25 2 36" stroke="#d9ad8d" stroke-width="7" stroke-linecap="round"/>
    </g>
    <g class="mascot-eyes">
      <ellipse cx="173" cy="218" rx="27" ry="32" fill="#fffdf5" stroke="#402c44" stroke-width="5"/>
      <ellipse cx="267" cy="218" rx="27" ry="32" fill="#fffdf5" stroke="#402c44" stroke-width="5"/>
      <ellipse cx="176" cy="221" rx="19" ry="25" fill="url(#m-eye)"/>
      <ellipse cx="264" cy="221" rx="19" ry="25" fill="url(#m-eye)"/>
      <ellipse cx="176" cy="224" rx="8" ry="16" fill="#49304a"/>
      <ellipse cx="264" cy="224" rx="8" ry="16" fill="#49304a"/>
      <circle cx="168" cy="208" r="6" fill="#fff" opacity=".95"/>
      <circle cx="256" cy="208" r="6" fill="#fff" opacity=".95"/>
      <circle cx="183" cy="235" r="3.2" fill="#fff" opacity=".75"/>
      <circle cx="271" cy="235" r="3.2" fill="#fff" opacity=".75"/>
      <g class="mascot-lids" style="transform-origin: 220px 200px">
        <path d="M145 210c15-19 41-21 57-2 6 8-2 14-10 10-15-8-26-7-39 1-7 4-13-2-8-9Z" fill="url(#m-fur)" opacity="0"/>
        <path d="M238 208c17-18 43-17 57 2 4 7-3 13-10 9-12-7-25-8-39-1-8 4-15-2-8-10Z" fill="url(#m-fur)" opacity="0"/>
      </g>
    </g>
    <ellipse cx="142" cy="265" rx="27" ry="13" fill="#f6a6a5" opacity=".48"/>
    <ellipse cx="298" cy="265" rx="27" ry="13" fill="#f6a6a5" opacity=".48"/>
    <ellipse cx="220" cy="272" rx="54" ry="35" fill="#fff7eb" opacity=".92"/>
    <path d="M210 254c3-6 17-6 20 0 1 4-3 10-10 10s-11-6-10-10Z" fill="#e78c9a" stroke="#402c44" stroke-width="3.5" stroke-linejoin="round"/>
    <path d="M220 265c-1 8-8 12-15 9M220 265c1 8 8 12 15 9" fill="none" stroke="#402c44" stroke-width="4" stroke-linecap="round"/>
    <g fill="none" stroke="#6e5667" stroke-width="3" stroke-linecap="round" opacity=".7">
      <path d="M122 247c-17-3-29-1-39 5M123 259c-17 1-28 5-36 12M132 271c-14 5-22 12-27 20"/>
      <path d="M318 247c17-3 29-1 39 5M317 259c17 1 28 5 36 12M308 271c14 5 22 12 27 20"/>
    </g>
    <path d="M155 183c8 5 18 6 27 2M258 185c10 4 20 3 28-2" fill="none" stroke="#c99a7a" stroke-width="4.5" stroke-linecap="round" opacity=".55"/>
  </g>

  <g class="mascot-scarf">
    <path d="M148 292c20 21 44 31 72 31s52-10 72-31c10 14 10 28 1 39-19 19-44 28-73 28s-54-9-73-28c-9-11-9-25 1-39Z" fill="url(#m-scarf)" stroke="#402c44" stroke-width="6.5" stroke-linejoin="round"/>
    <path d="M288 326c27 5 47 20 56 44 5 13-2 25-14 27-14 3-24-6-29-19-5-13-12-22-24-28-11-5-4-27 11-24Z" fill="url(#m-scarf)" stroke="#402c44" stroke-width="6" stroke-linejoin="round"/>
    <path d="M302 361c15 1 26 7 33 17" fill="none" stroke="#d7bef5" stroke-width="5" stroke-linecap="round" opacity=".55"/>
    <circle cx="220" cy="338" r="16" fill="url(#m-bell)" stroke="#402c44" stroke-width="5"/>
    <path d="M215 334c1 4 4 6 8 6" fill="none" stroke="#a87a2f" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="220" cy="345" r="3.4" fill="#a87a2f"/>
  </g>

  <g class="mascot-paw-wave" style="transform-origin: 155px 365px">
    <path d="M169 371c-31-4-53-28-57-61-2-19 8-31 20-30 13 1 18 13 22 31 4 17 14 28 28 33 14 5 3 29-13 27Z" fill="url(#m-fur)" stroke="#402c44" stroke-width="6.5" stroke-linejoin="round"/>
    <ellipse cx="126" cy="286" rx="27" ry="24" fill="url(#m-fur)" stroke="#402c44" stroke-width="6" transform="rotate(-16 126 286)"/>
    <g fill="#eaa4a7" opacity=".85">
      <ellipse cx="120" cy="275" rx="7.5" ry="5.5" transform="rotate(-18 120 275)"/>
      <ellipse cx="136" cy="278" rx="7.5" ry="5.5" transform="rotate(16 136 278)"/>
      <ellipse cx="145" cy="291" rx="7" ry="5.3" transform="rotate(38 145 291)"/>
      <ellipse cx="108" cy="289" rx="7" ry="5.3" transform="rotate(-38 108 289)"/>
      <ellipse cx="126" cy="300" rx="12" ry="9"/>
    </g>
  </g>

  <g class="mascot-card" transform="rotate(-8 285 385)" filter="url(#m-paw-shadow)">
    <rect x="238" y="322" width="126" height="160" rx="19" fill="url(#m-card)" stroke="#402c44" stroke-width="6.5"/>
    <rect x="248" y="333" width="106" height="138" rx="13" fill="none" stroke="#d2b4d2" stroke-width="2" opacity=".45"/>
    <ellipse cx="301" cy="393" rx="22" ry="18" fill="#c5a5c7" opacity=".38"/>
    <g fill="#c5a5c7" opacity=".48">
      <ellipse cx="285" cy="370" rx="7" ry="9" transform="rotate(-24 285 370)"/>
      <ellipse cx="300" cy="363" rx="7" ry="9" transform="rotate(-8 300 363)"/>
      <ellipse cx="316" cy="368" rx="7" ry="9" transform="rotate(12 316 368)"/>
      <ellipse cx="326" cy="381" rx="7" ry="9" transform="rotate(28 326 381)"/>
      <ellipse cx="303" cy="393" rx="19" ry="15"/>
    </g>
    <path d="M258 341c10-9 23-12 35-10" stroke="#dbc2dd" stroke-width="5" stroke-linecap="round" opacity=".45"/>
  </g>

  <g class="mascot-paw-hold" filter="url(#m-paw-shadow)">
    <ellipse cx="345" cy="427" rx="34" ry="27" fill="url(#m-fur)" stroke="#402c44" stroke-width="6" transform="rotate(18 345 427)"/>
    <g fill="#eaa4a7" opacity=".85">
      <ellipse cx="330" cy="416" rx="8" ry="6" transform="rotate(8 330 416)"/>
      <ellipse cx="349" cy="412" rx="8" ry="6" transform="rotate(35 349 412)"/>
      <ellipse cx="361" cy="426" rx="7" ry="5.5" transform="rotate(62 361 426)"/>
      <ellipse cx="345" cy="441" rx="13" ry="10"/>
    </g>
  </g>

  <g class="mascot-sparkles" fill="#f3c45d">
    <path d="M82 168c3 10 6 13 16 16-10 3-13 6-16 16-3-10-6-13-16-16 10-3 13-6 16-16Z"/>
    <path d="M355 141c2 7 4 9 11 11-7 2-9 4-11 11-2-7-4-9-11-11 7-2 9-4 11-11Z" opacity=".8"/>
    <circle cx="371" cy="236" r="3.5" opacity=".6"/>
    <circle cx="82" cy="228" r="2.5" opacity=".5"/>
  </g>
</svg>`;

  /* A tiny portrait used in HUDs, pickers, mode cards and dialogue. */
  function catAvatarSvg(cat, extraClass = '') {
    const id = cat.id;
    return `<svg class="cat-avatar cat-${id} ${extraClass}" viewBox="0 0 100 100" role="img" aria-label="${cat.name}">
  <defs>
    <linearGradient id="cf-${id}" x1=".2" y1=".1" x2=".8" y2=".95">
      <stop stop-color="${cat.fur}"/><stop offset=".62" stop-color="${cat.fur}"/><stop offset="1" stop-color="${cat.furDark}"/>
    </linearGradient>
    <linearGradient id="ce-${id}" x1=".2" y1="0" x2=".8" y2="1">
      <stop stop-color="${cat.inner}" stop-opacity=".95"/><stop offset="1" stop-color="${cat.inner}" stop-opacity=".55"/>
    </linearGradient>
    <linearGradient id="cc-${id}" x1="0" y1="0" x2="1" y2=".5">
      <stop stop-color="${cat.accessory}"/><stop offset="1" stop-color="${cat.accessory2}"/>
    </linearGradient>
  </defs>
  <ellipse cx="50" cy="93" rx="27" ry="5" fill="#423047" opacity=".1"/>
  <path d="M21 37C15 27 15 15 20 10c12 3 23 11 29 21 1 2 4 2 5 0 6-10 16-18 28-21 4 5 4 17-2 27 9 9 12 22 8 34-4 14-18 23-37 23S18 85 14 71c-4-12-1-25 7-34Z" fill="url(#cf-${id})" stroke="#402c44" stroke-width="3.4" stroke-linejoin="round"/>
  <path d="M22 32c-3-8-3-15-1-18 8 2 16 7 21 14-8 1-14 3-20 4Z" fill="url(#ce-${id})"/>
  <path d="M78 32c3-8 3-15 1-18-8 2-16 7-21 14 8 1 14 3 20 4Z" fill="url(#ce-${id})"/>
  <g>
    <ellipse cx="36" cy="54" rx="10" ry="12" fill="#fffdf5" stroke="#402c44" stroke-width="2.1"/>
    <ellipse cx="64" cy="54" rx="10" ry="12" fill="#fffdf5" stroke="#402c44" stroke-width="2.1"/>
    <ellipse cx="37" cy="55" rx="6.8" ry="9" fill="${cat.eye}"/>
    <ellipse cx="63" cy="55" rx="6.8" ry="9" fill="${cat.eye}"/>
    <ellipse cx="37" cy="56" rx="2.8" ry="6.3" fill="#372636"/>
    <ellipse cx="63" cy="56" rx="2.8" ry="6.3" fill="#372636"/>
    <circle cx="34.5" cy="50.5" r="2.4" fill="#fff" opacity=".9"/>
    <circle cx="60.5" cy="50.5" r="2.4" fill="#fff" opacity=".9"/>
  </g>
  <ellipse cx="26" cy="65" rx="7" ry="3.5" fill="#eb969b" opacity=".35"/>
  <ellipse cx="74" cy="65" rx="7" ry="3.5" fill="#eb969b" opacity=".35"/>
  <ellipse cx="50" cy="65" rx="16" ry="10" fill="#fff8ed" opacity=".76"/>
  <path d="M46.5 61.5c1.2-2.4 5.8-2.4 7 0 .5 1.5-1 3.4-3.5 3.4s-4-1.9-3.5-3.4Z" fill="#df7e8d" stroke="#402c44" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M50 65c0 2.8-2.2 4.2-4.2 3.2M50 65c0 2.8 2.2 4.2 4.2 3.2" fill="none" stroke="#402c44" stroke-width="1.5" stroke-linecap="round"/>
  <g fill="none" stroke="#6d5366" stroke-width="1.25" stroke-linecap="round" opacity=".55">
    <path d="M15 58c-5-.8-8.5.1-11 1.8M16 64c-4.5.3-7.8 1.8-10 3.8"/>
    <path d="M85 58c5-.8 8.5.1 11 1.8M84 64c4.5.3 7.8 1.8 10 3.8"/>
  </g>
  <path d="M25 82c7 6 16 9 25 9s18-3 25-9" fill="none" stroke="#402c44" stroke-width="4.2" stroke-linecap="round"/>
  <path d="M26 82c6 8 15 12 24 12s18-4 24-12" fill="none" stroke="url(#cc-${id})" stroke-width="6" stroke-linecap="round"/>
  <circle cx="50" cy="92.5" r="4.6" fill="#f2c25c" stroke="#402c44" stroke-width="2"/>
  <circle cx="50" cy="94" r="1.4" fill="#a17834"/>
  <path d="M30 44c4-4 9-5 13-3M70 44c-4-4-9-5-13-3" fill="none" stroke="#caa182" stroke-width="1.7" stroke-linecap="round" opacity=".42"/>
</svg>`;
  }

  window.MMArt = {
    fruits: fruitDefs,
    cats: catDefs,
    mascotSvg: mascot,
    catAvatarSvg,
    fruitSrc(id) { return `assets/img/fruits/${id}.svg`; },
    fruitById(id) { return fruitDefs.find((f) => f.id === id); },
    catById(id) { return catDefs.find((c) => c.id === id) || catDefs[0]; }
  };
})();
