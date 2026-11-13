// Cartoon art: every person, desk and prop is drawn as inline SVG.
(function () {
  const INK = "#2b2b3a";
  const SKINS = ["#ffdcbc", "#f6c9a0", "#e4a97c", "#c58a5c", "#9c6644"];
  const HAIRS = ["#2b2230", "#5a3825", "#c46a2b", "#e9c46a", "#3d3d4e", "#7b4b94", "#8c5a3c"];
  const STYLES = ["short", "bob", "spiky", "long", "bun", "curly", "ponytail"];
  const MUGS = ["#ff7b7b", "#7bc4ff", "#ffd36e", "#9be38f", "#c3a6ff"];

  // Small deterministic hash so each seat always gets the same look.
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pick(arr, n) { return arr[n % arr.length]; }

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
    const r = c((n >> 16) & 255), g = c((n >> 8) & 255), b = c(n & 255);
    return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function lookFor(seed, role) {
    const h = hash(seed);
    return {
      skin: pick(SKINS, h),
      hair: pick(HAIRS, h >>> 3),
      hairStyle: pick(STYLES, h >>> 7),
      mug: pick(MUGS, h >>> 11),
      shirt: role.shirt,
      glasses: !!role.glasses || ((h >>> 13) % 5 === 0),
      headphones: !!role.headphones
    };
  }

  // ---------- hair (head centre 70,52 r20) ----------
  function hairBack(style, c) {
    if (style === "long") return `<path d="M47 50 C44 26 96 26 93 50 L97 90 Q70 98 43 90 Z" fill="${c}"/>`;
    if (style === "ponytail") return `<path d="M88 44 C104 46 106 70 96 84 C100 66 96 56 86 52 Z" fill="${c}"/>`;
    if (style === "bun") return `<circle cx="70" cy="28" r="9" fill="${c}"/>`;
    return "";
  }
  function hairFront(style, c) {
    const hi = shade(c, 0.12);
    switch (style) {
      case "spiky":
        return `<path d="M48 52 L49 38 L55 41 L56 29 L63 37 L70 25 L76 36 L84 29 L85 41 L91 38 L92 52 C84 42 56 42 48 52 Z" fill="${c}"/>`;
      case "bob":
        return `<path d="M47 56 C43 30 97 30 93 56 L94 70 Q88 73 86 66 L86 50 C80 42 62 40 54 50 L54 66 Q52 73 46 70 Z" fill="${c}"/>
                <path d="M60 36 Q70 32 80 36" stroke="${hi}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
      case "curly": {
        const pts = [[50,48],[52,39],[58,32],[66,29],[74,29],[82,32],[88,39],[90,48],[61,38],[70,36],[79,38]];
        return pts.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="${c}"/>`).join("");
      }
      case "long":
      case "ponytail":
      case "bun":
      case "short":
      default:
        return `<path d="M49 53 C46 33 60 28 70 28 C82 28 94 33 91 53 C87 44 80 40 72 42 C64 38 55 44 49 53 Z" fill="${c}"/>
                <path d="M60 34 Q68 31 76 33" stroke="${hi}" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    }
  }

  // ---------- desk props (right side of desk) ----------
  function prop(kind) {
    switch (kind) {
      case "plant":
        return `<g transform="translate(108 76)">
          <path d="M8 14 C2 6 4 0 9 2 C10 6 10 10 8 14 Z" fill="#46b06a"/>
          <path d="M10 14 C16 4 22 4 20 10 C17 12 14 13 10 14 Z" fill="#5cc97f"/>
          <path d="M9 14 C9 4 12 -2 14 0 C15 5 12 10 9 14 Z" fill="#3a9c5b"/>
          <path d="M2 14 H20 L18 26 H4 Z" fill="#e07a5f"/><rect x="1" y="13" width="20" height="4" rx="2" fill="#c8664c"/></g>`;
      case "pencils":
        return `<g transform="translate(110 78)">
          <line x1="5" y1="10" x2="2" y2="-2" stroke="#ff6b6b" stroke-width="3" stroke-linecap="round"/>
          <line x1="9" y1="10" x2="10" y2="-5" stroke="#4dabf7" stroke-width="3" stroke-linecap="round"/>
          <line x1="13" y1="10" x2="17" y2="-1" stroke="#ffd43b" stroke-width="3" stroke-linecap="round"/>
          <rect x="1" y="8" width="16" height="16" rx="3" fill="#8e7cc3"/><rect x="1" y="8" width="16" height="4" rx="2" fill="#a597d6"/></g>`;
      case "palette":
        return `<g transform="translate(104 88)">
          <path d="M2 8 C2 0 26 -2 28 8 C29 13 22 12 20 15 C18 19 2 17 2 8 Z" fill="#f1d3a5" stroke="#d6b07a" stroke-width="1"/>
          <circle cx="8" cy="7" r="2.6" fill="#ff6b6b"/><circle cx="14" cy="4.5" r="2.6" fill="#ffd43b"/>
          <circle cx="20" cy="5.5" r="2.6" fill="#4dabf7"/><circle cx="9" cy="13" r="2.6" fill="#51cf66"/>
          <line x1="22" y1="-8" x2="16" y2="9" stroke="#8d6e63" stroke-width="2.5" stroke-linecap="round"/>
          <circle cx="22.5" cy="-9" r="2.4" fill="#e64980"/></g>`;
      case "megaphone":
        return `<g transform="translate(104 82)">
          <path d="M4 8 L22 0 L22 22 L4 14 Z" fill="#ff8787"/><rect x="0" y="7" width="6" height="8" rx="2" fill="#ffa8a8"/>
          <rect x="21" y="-1" width="4" height="24" rx="2" fill="#fa5252"/>
          <path d="M8 14 L10 22 H14 L12 15" fill="#868e96"/></g>`;
      case "chart":
        return `<g transform="translate(104 76)">
          <rect x="0" y="0" width="26" height="22" rx="3" fill="#fff" stroke="#ced4da" stroke-width="1.5"/>
          <rect x="5" y="12" width="4" height="6" rx="1" fill="#1fb5a3"/>
          <rect x="11" y="8" width="4" height="10" rx="1" fill="#4dabf7"/>
          <rect x="17" y="4" width="4" height="14" rx="1" fill="#ffa94d"/>
          <path d="M12 22 L10 28 H16 L14 22" fill="#adb5bd"/></g>`;
      case "rocket":
        return `<g transform="translate(110 74)" class="rocket">
          <path d="M8 0 C14 6 15 16 13 24 H3 C1 16 2 6 8 0 Z" fill="#f1f3f5" stroke="#ced4da" stroke-width="1"/>
          <circle cx="8" cy="11" r="3" fill="#4dabf7"/>
          <path d="M3 18 L-2 26 H4 Z" fill="#fa5252"/><path d="M13 18 L18 26 H12 Z" fill="#fa5252"/>
          <path d="M5 25 Q8 32 11 25 Z" fill="#ffa94d"/></g>`;
      case "notes":
        return `<g class="notes">
          <text x="102" y="56" font-size="15" fill="#7a5cff" font-weight="700">♪</text>
          <text x="114" y="44" font-size="12" fill="#b197fc" font-weight="700">♫</text></g>
          <g transform="translate(106 86)"><rect x="0" y="0" width="22" height="16" rx="3" fill="#495057"/>
          <circle cx="7" cy="8" r="4" fill="#212529"/><circle cx="7" cy="8" r="1.5" fill="#868e96"/>
          <circle cx="16" cy="5" r="1.6" fill="#51cf66"/><circle cx="16" cy="11" r="1.6" fill="#ffd43b"/></g>`;
      case "magnifier":
        return `<g transform="translate(104 80)">
          <circle cx="10" cy="10" r="8" fill="#e7f5ff" stroke="#495057" stroke-width="3"/>
          <line x1="16" y1="16" x2="24" y2="24" stroke="#495057" stroke-width="4" stroke-linecap="round"/>
          <g transform="translate(5 6)"><ellipse cx="5" cy="5" rx="3.4" ry="4" fill="#51cf66"/>
          <circle cx="5" cy="1" r="2" fill="#2f9e44"/></g></g>`;
      default:
        return "";
    }
  }

  function paw(x, y, c) {
    return `<g transform="translate(${x} ${y})" fill="${c}">
      <ellipse cx="0" cy="3" rx="4.2" ry="3.4"/><circle cx="-4.5" cy="-2" r="1.8"/>
      <circle cx="-1.5" cy="-4.6" r="1.8"/><circle cx="1.8" cy="-4.6" r="1.8"/><circle cx="4.7" cy="-2" r="1.8"/></g>`;
  }

  // ---------- full seat ----------
  // opts: { look, prop, hired, boss, label }
  function seatSVG(opts) {
    const L = opts.look || {};
    const boss = !!opts.boss;
    const chair = boss ? "#c0392b" : "#5c6b8a";
    const chairHi = shade(chair, 0.1);
    const wood = boss ? "#b9774a" : "#d39a67";
    const woodDark = shade(wood, -0.14);
    const skinDark = L.skin ? shade(L.skin, -0.08) : "";

    let s = `<svg viewBox="0 0 140 150" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
    s += `<ellipse cx="70" cy="143" rx="62" ry="6" fill="rgba(60,40,20,.14)"/>`;
    // chair back
    s += `<rect x="38" y="${boss ? 30 : 42}" width="64" height="${boss ? 76 : 64}" rx="16" fill="${chair}"/>`;
    s += `<rect x="44" y="${boss ? 36 : 48}" width="52" height="${boss ? 60 : 50}" rx="12" fill="${chairHi}"/>`;

    if (opts.hired) {
      s += `<g class="person">`;
      s += hairBack(L.hairStyle, L.hair);
      // torso
      s += `<path d="M36 112 C36 86 50 78 70 78 C90 78 104 86 104 112 Z" fill="${L.shirt}"/>`;
      s += `<path d="M62 78 L70 88 L78 78 Z" fill="#fff" opacity=".85"/>`;
      if (boss) s += `<path d="M68 86 L72 86 L74 104 L70 108 L66 104 Z" fill="#2b2b3a"/>`;
      // arms (typing)
      s += `<g class="arm arm-l"><path d="M44 90 Q38 104 56 100" stroke="${L.shirt}" stroke-width="11" fill="none" stroke-linecap="round"/><circle cx="58" cy="100" r="5" fill="${L.skin}"/></g>`;
      s += `<g class="arm arm-r"><path d="M96 90 Q102 104 84 100" stroke="${L.shirt}" stroke-width="11" fill="none" stroke-linecap="round"/><circle cx="82" cy="100" r="5" fill="${L.skin}"/></g>`;
      // neck + head
      s += `<rect x="64" y="66" width="12" height="14" rx="4" fill="${skinDark}"/>`;
      s += `<g class="head">`;
      s += `<circle cx="50" cy="55" r="5" fill="${skinDark}"/><circle cx="90" cy="55" r="5" fill="${skinDark}"/>`;
      s += `<circle cx="70" cy="52" r="20" fill="${L.skin}"/>`;
      s += `<g class="eyes"><ellipse cx="63" cy="54" rx="2.5" ry="3.1" fill="${INK}"/><ellipse cx="77" cy="54" rx="2.5" ry="3.1" fill="${INK}"/>
            <circle cx="63.8" cy="52.8" r=".9" fill="#fff"/><circle cx="77.8" cy="52.8" r=".9" fill="#fff"/></g>`;
      s += `<ellipse cx="58" cy="61" rx="4" ry="2.4" fill="#ff8fa3" opacity=".55"/><ellipse cx="82" cy="61" rx="4" ry="2.4" fill="#ff8fa3" opacity=".55"/>`;
      s += `<path d="M65.5 62 Q70 66.5 74.5 62" stroke="${INK}" stroke-width="2" fill="none" stroke-linecap="round"/>`;
      s += hairFront(L.hairStyle, L.hair);
      if (L.glasses) {
        s += `<g fill="none" stroke="${INK}" stroke-width="1.6"><circle cx="63" cy="54" r="5.4"/><circle cx="77" cy="54" r="5.4"/><path d="M68.4 54 H71.6"/></g>`;
      }
      if (L.headphones) {
        s += `<path d="M48 54 C46 24 94 24 92 54" stroke="#343a40" stroke-width="4" fill="none"/>`;
        s += `<rect x="43" y="48" width="9" height="15" rx="4" fill="#7a5cff"/><rect x="88" y="48" width="9" height="15" rx="4" fill="#7a5cff"/>`;
      }
      if (boss) {
        s += `<path d="M58 30 L60 20 L66 26 L70 17 L74 26 L80 20 L82 30 Z" fill="#ffd43b" stroke="#f08c00" stroke-width="1.2" stroke-linejoin="round"/>`;
      }
      s += `</g></g>`;
    } else {
      // empty chair seat cushion visible above desk
      s += `<rect x="40" y="92" width="60" height="12" rx="6" fill="${chair}"/>`;
    }

    // desk
    s += `<rect x="4" y="102" width="132" height="11" rx="5" fill="${wood}"/>`;
    s += `<rect x="4" y="102" width="132" height="3.5" rx="2" fill="${shade(wood, 0.1)}"/>`;
    s += `<rect x="12" y="112" width="116" height="28" rx="4" fill="${woodDark}"/>`;
    s += `<rect x="98" y="118" width="24" height="16" rx="3" fill="${shade(woodDark, -0.05)}"/>`;
    s += `<rect x="105" y="124" width="10" height="3" rx="1.5" fill="${shade(woodDark, 0.18)}"/>`;

    if (opts.hired) {
      // laptop (back of lid faces us) with the studio paw
      s += `<rect x="48" y="78" width="44" height="26" rx="4" fill="#e9eef7" stroke="#c3cde0" stroke-width="1.5"/>`;
      s += paw(70, 90, "#ffa94d");
      s += `<rect x="44" y="101" width="52" height="3.5" rx="1.75" fill="#c3cde0"/>`;
      // mug
      s += `<g class="mug"><path d="M28 89 Q30 84 28 80" stroke="#cfd4da" stroke-width="1.6" fill="none" class="steam"/>
            <rect x="20" y="88" width="14" height="14" rx="3" fill="${L.mug}"/>
            <path d="M34 91 Q40 91 40 95 Q40 99 34 99" stroke="${L.mug}" stroke-width="2.6" fill="none"/></g>`;
      s += prop(opts.prop);
    } else {
      // hiring sign
      s += `<g class="sign"><path d="M44 102 L52 70 H88 L96 102" fill="none" stroke="#adb5bd" stroke-width="2"/>
            <rect x="40" y="64" width="60" height="30" rx="7" fill="#fff" stroke="#ff922b" stroke-width="2.5" stroke-dasharray="5 3"/>
            <text x="70" y="77" text-anchor="middle" font-size="9.5" font-weight="800" fill="#e8590c" font-family="inherit">ĐANG</text>
            <text x="70" y="88" text-anchor="middle" font-size="9.5" font-weight="800" fill="#e8590c" font-family="inherit">TUYỂN</text></g>`;
      s += `<g transform="translate(112 86)"><circle r="9" fill="#ff922b"/><path d="M-4 0 H4 M0 -4 V4" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></g>`;
    }

    if (boss) {
      s += `<rect x="42" y="118" width="56" height="16" rx="4" fill="#ffe8a3" stroke="#f0b429" stroke-width="1.5"/>`;
      s += `<text x="70" y="129.5" text-anchor="middle" font-size="9" font-weight="800" fill="#7a4b00" font-family="inherit">${opts.label || "CEO"}</text>`;
    }
    s += `</svg>`;
    return s;
  }

  // Orange studio cat that sits on the boss desk.
  // Black-and-white (tuxedo) studio cat, like the hero of the games.
  function catSVG() {
    const K = "#24242c", W = "#f8f9fa";
    return `<svg viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="30" cy="56" rx="20" ry="3.5" fill="rgba(60,40,20,.16)"/>
      <path d="M44 50 C58 48 58 32 50 30" stroke="${K}" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M50 30 C52 29 54 31 53 33" stroke="${W}" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M14 56 C12 38 20 30 30 30 C40 30 48 38 46 56 Z" fill="${K}"/>
      <path d="M21 56 C20 44 25 37 30 37 C35 37 40 44 39 56 Z" fill="${W}"/>
      <ellipse cx="22" cy="55" rx="4" ry="2.4" fill="${W}"/><ellipse cx="38" cy="55" rx="4" ry="2.4" fill="${W}"/>
      <path d="M15 22 L17 6 L27 15 Z" fill="${K}"/><path d="M45 22 L43 6 L33 15 Z" fill="${K}"/>
      <path d="M18 18 L19 10 L24 15 Z" fill="#ffadc2"/><path d="M42 18 L41 10 L36 15 Z" fill="#ffadc2"/>
      <ellipse cx="30" cy="22" rx="16" ry="13" fill="${K}"/>
      <path d="M30 14 C26 20 22 24 22 29 C24 34 36 34 38 29 C38 24 34 20 30 14 Z" fill="${W}"/>
      <ellipse cx="23.5" cy="21.5" rx="3.2" ry="3.6" fill="#b2f2bb"/><ellipse cx="36.5" cy="21.5" rx="3.2" ry="3.6" fill="#b2f2bb"/>
      <ellipse cx="23.8" cy="22" rx="1.4" ry="2.6" fill="${K}"/><ellipse cx="36.8" cy="22" rx="1.4" ry="2.6" fill="${K}"/>
      <path d="M28.5 26 L31.5 26 L30 27.6 Z" fill="#f06595"/>
      <path d="M30 27.6 Q28 30 26 28.6 M30 27.6 Q32 30 34 28.6" stroke="${K}" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <path d="M11 24 H19 M11 28 L19 27 M49 24 H41 M49 28 L41 27" stroke="#ced4da" stroke-width="1" stroke-linecap="round"/>
    </svg>`;
  }

  function plantSVG(variant) {
    const leaf = variant ? "#3fa66b" : "#52b788";
    return `<svg viewBox="0 0 60 90" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <ellipse cx="30" cy="86" rx="20" ry="3.5" fill="rgba(60,40,20,.15)"/>
      <path d="M30 52 C10 44 6 22 14 14 C24 22 30 36 30 52 Z" fill="${leaf}"/>
      <path d="M30 52 C50 44 54 22 46 14 C36 22 30 36 30 52 Z" fill="${shade(leaf, -0.08)}"/>
      <path d="M30 54 C22 30 28 8 30 2 C32 8 38 30 30 54 Z" fill="${shade(leaf, 0.08)}"/>
      <path d="M14 54 H46 L42 86 H18 Z" fill="${variant ? "#e07a5f" : "#6c8ebf"}"/>
      <rect x="12" y="51" width="36" height="7" rx="3.5" fill="${variant ? "#c8664c" : "#58779f"}"/></svg>`;
  }

  // Zone sign icons.
  const ICONS = {
    broom: `<svg viewBox="0 0 24 24"><path d="M15 3 L10 12" stroke="#8d6e63" stroke-width="2.4" stroke-linecap="round"/><path d="M6 12 H14 L17 21 H3 Z" fill="#ffd43b" stroke="#f08c00" stroke-width="1.2" stroke-linejoin="round"/><path d="M7 15 L6 21 M10 15 V21 M13 15 L14 21" stroke="#f08c00" stroke-width="1.1"/></svg>`,
    blaster: `<svg viewBox="0 0 24 24"><path d="M3 9 H17 L21 11 L17 13 H10 L8 19 H5 L6 13 H3 Z" fill="#748ffc" stroke="#4263eb" stroke-width="1.2" stroke-linejoin="round"/><circle cx="22" cy="11" r="1.6" fill="#ff6b6b"/></svg>`,
    parachute: `<svg viewBox="0 0 24 24"><path d="M3 11 C3 4 21 4 21 11 Z" fill="#69db7c" stroke="#2f9e44" stroke-width="1.2"/><path d="M3 11 L12 19 L21 11 M9 11 L12 19 L15 11" stroke="#2f9e44" stroke-width="1" fill="none"/><circle cx="12" cy="20" r="2.4" fill="#ffa94d"/></svg>`,
    star: `<svg viewBox="0 0 24 24"><path d="M12 2.5 L14.8 8.6 L21.4 9.3 L16.4 13.8 L17.8 20.4 L12 17 L6.2 20.4 L7.6 13.8 L2.6 9.3 L9.2 8.6 Z" fill="#ffd43b" stroke="#f08c00" stroke-width="1.2" stroke-linejoin="round"/></svg>`,
    globe: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="#91a7ff" stroke="#4c6ef5" stroke-width="1.2"/><path d="M7 7 C10 8 9 11 7 12 C5 13 6 16 8 17 M15 5 C14 8 17 9 18 11 C19 14 16 15 15 18" stroke="#2f9e44" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`
  };

  window.OfficeArt = { seatSVG, catSVG, plantSVG, lookFor, ICONS, paw };
})();
