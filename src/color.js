const COLOR_TAGS = new Set(['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:scrgbClr', 'a:hslClr']);

const PRESET = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00',
  gray: '808080', grey: '808080', orange: 'FFA500', purple: '800080', cyan: '00FFFF', magenta: 'FF00FF',
  darkBlue: '00008B', darkRed: '8B0000', darkGreen: '006400', lightGray: 'D3D3D3', silver: 'C0C0C0',
};

export function hexToRgb(h) {
  h = String(h).replace('#', '');
  return { r: parseInt(h.slice(0, 2), 16) || 0, g: parseInt(h.slice(2, 4), 16) || 0, b: parseInt(h.slice(4, 6), 16) || 0 };
}

function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  if (!s) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: Math.round(f(h + 1 / 3) * 255), g: Math.round(f(h) * 255), b: Math.round(f(h - 1 / 3) * 255) };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function toCss(c) {
  const a = c.a ?? 1;
  return a >= 1 ? `rgb(${c.r},${c.g},${c.b})` : `rgba(${c.r},${c.g},${c.b},${+a.toFixed(3)})`;
}

function applyMods(rgb, mods) {
  let c = { ...rgb, a: 1 };
  for (const m of mods) {
    const v = m.num('val', 100000) / 100000;
    switch (m.name) {
      case 'a:alpha': c.a = v; break;
      case 'a:lumMod': case 'a:lumOff': case 'a:satMod': case 'a:satOff': {
        let [h, s, l] = rgbToHsl(c);
        if (m.name === 'a:lumMod') l = clamp01(l * v);
        else if (m.name === 'a:lumOff') l = clamp01(l + v);
        else if (m.name === 'a:satMod') s = clamp01(s * v);
        else s = clamp01(s + v);
        c = { ...hslToRgb(h, s, l), a: c.a };
        break;
      }
      case 'a:tint':
        c = { r: Math.round(c.r * v + 255 * (1 - v)), g: Math.round(c.g * v + 255 * (1 - v)), b: Math.round(c.b * v + 255 * (1 - v)), a: c.a };
        break;
      case 'a:shade':
        c = { r: Math.round(c.r * v), g: Math.round(c.g * v), b: Math.round(c.b * v), a: c.a };
        break;
      default: break;
    }
  }
  return c;
}

/** cc = { theme: {dk1..}, clrMap: {tx1:'dk1',..} } */
function fromElement(el, cc) {
  let rgb;
  switch (el.name) {
    case 'a:srgbClr': rgb = hexToRgb(el.attr('val', '000000')); break;
    case 'a:sysClr': rgb = hexToRgb(el.attr('lastClr', el.attr('val') === 'window' ? 'FFFFFF' : '000000')); break;
    case 'a:prstClr': rgb = hexToRgb(PRESET[el.attr('val')] ?? '000000'); break;
    case 'a:scrgbClr': {
      const f = (k) => Math.round(clamp01(el.num(k, 0) / 100000) * 255);
      rgb = { r: f('r'), g: f('g'), b: f('b') };
      break;
    }
    case 'a:hslClr':
      rgb = hslToRgb(el.num('hue', 0) / 21600000, el.num('sat', 0) / 100000, el.num('lum', 0) / 100000);
      break;
    case 'a:schemeClr': {
      const name = el.attr('val');
      const mapped = cc.clrMap?.[name] ?? name;
      const hex = cc.theme?.[mapped];
      if (!hex) return null;
      rgb = hexToRgb(hex);
      break;
    }
    default: return null;
  }
  return applyMods(rgb, el.children);
}

/** Resolve the first colour child of `parent` (solidFill, gs, fontRef, ...) to {r,g,b,a}. */
export function colorOf(parent, cc) {
  if (!parent) return null;
  const c = parent.children.find((ch) => COLOR_TAGS.has(ch.name));
  return c ? fromElement(c, cc) : null;
}

export function cssColorOf(parent, cc) {
  const c = colorOf(parent, cc);
  return c ? toCss(c) : null;
}
