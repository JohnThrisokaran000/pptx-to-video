import { cssColorOf } from './color.js';

// Minimal native chart support: parses the DrawingML chart part and re-draws it as animatable SVG.

const ACCENTS = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const richText = (n) => (n ? n.all('c:tx').flatMap((t) => [...descend(t, 'a:t')]).map((t) => t.text).join('') : '');
function* descend(n, name) {
  for (const c of n.children) {
    if (c.name === name) yield c;
    yield* descend(c, name);
  }
}

function cache(ref) {
  // strRef/numRef -> [{idx, v}]
  const c =
    ref?.get('c:strRef')?.get('c:strCache') ?? ref?.get('c:numRef')?.get('c:numCache') ??
    ref?.get('c:multiLvlStrRef')?.get('c:multiLvlStrCache')?.get('c:lvl') ?? ref?.get('c:strLit') ?? ref?.get('c:numLit');
  const pts = [];
  for (const p of c?.all('c:pt') ?? []) pts[p.num('idx', pts.length)] = p.get('c:v')?.text ?? '';
  const n = Math.max(c?.get('c:ptCount')?.num('val', 0) ?? 0, pts.length);
  return Array.from({ length: n }, (_, i) => pts[i] ?? '');
}

export function parseChart(xml, cc) {
  const chart = xml?.get('c:chart');
  const plot = chart?.get('c:plotArea');
  if (!plot) return { kind: 'unsupported', series: [] };
  const typeEl = plot.children.find((c) => /^c:(bar|line|area|pie|doughnut|scatter|bar3D|line3D|pie3D|area3D)Chart$/.test(c.name));
  if (!typeEl) return { kind: 'unsupported', series: [] };
  const raw = typeEl.name.slice(2, -5).replace('3D', '');
  const kind = raw;
  const palette = (i) => {
    const hex = cc.theme?.[ACCENTS[i % 6]] ?? '4472C4';
    return `#${hex}`;
  };
  const series = typeEl.all('c:ser').map((s, i) => {
    const spPr = s.get('c:spPr');
    const color =
      cssColorOf(spPr?.get('a:solidFill'), cc) ?? cssColorOf(spPr?.at('a:ln/a:solidFill'), cc) ?? palette(i);
    const ptColors = {};
    for (const d of s.all('c:dPt')) {
      const c = cssColorOf(d.at('c:spPr/a:solidFill'), cc);
      if (c) ptColors[d.get('c:idx')?.num('val', 0)] = c;
    }
    const isXY = kind === 'scatter';
    return {
      name: cache(s.get('c:tx'))[0] ?? `Series ${i + 1}`,
      cats: cache(isXY ? s.get('c:xVal') : s.get('c:cat')),
      vals: cache(isXY ? s.get('c:yVal') : s.get('c:val')).map((v) => Number(v) || 0),
      color,
      ptColors,
      showVal: s.at('c:dLbls/c:showVal')?.bool('val') ?? typeEl.at('c:dLbls/c:showVal')?.bool('val') ?? false,
      showPercent: s.at('c:dLbls/c:showPercent')?.bool('val') ?? typeEl.at('c:dLbls/c:showPercent')?.bool('val') ?? false,
    };
  });
  const autoDeleted = chart.get('c:autoTitleDeleted')?.bool('val');
  let title = richText(chart.get('c:title'));
  if (!title && !autoDeleted && series.length === 1 && kind !== 'pie' && kind !== 'doughnut') title = '';
  return {
    kind,
    horizontal: typeEl.get('c:barDir')?.attr('val') === 'bar',
    grouping: typeEl.get('c:grouping')?.attr('val') ?? 'clustered',
    gap: typeEl.get('c:gapWidth')?.num('val', 150) / 100,
    hole: typeEl.get('c:holeSize')?.num('val', 55) / 100,
    series,
    title,
    legend: !!chart.get('c:legend'),
    legendPos: chart.at('c:legend/c:legendPos')?.attr('val', 'b') ?? 'b',
    palette: Array.from({ length: 12 }, (_, i) => palette(i)),
  };
}

function niceScale(min, max, ticks = 5) {
  if (min === max) max = min + 1;
  const range = max - min;
  const rough = range / ticks;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? 10 * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

const fmt = (v) => (Math.abs(v) >= 10000 ? `${+(v / 1000).toPrecision(3)}k` : String(+v.toPrecision(4)));

/** px = pixels per typographic point at the output resolution. */
export function renderChart(m, w, h, pt) {
  const FS = 11 * pt, TXT = '#595959', GRID = '#d9d9d9';
  const out = [];
  const text = (x, y, s, o = {}) =>
    `<text class="${o.cls ?? 'cfade'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="${(o.size ?? FS).toFixed(1)}" fill="${o.fill ?? TXT}" text-anchor="${o.anchor ?? 'middle'}" dominant-baseline="${o.base ?? 'middle'}" ${o.weight ? `font-weight="${o.weight}"` : ''}>${esc(s)}</text>`;

  if (m.kind === 'unsupported' || !m.series.length) {
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f2f2f2" rx="${6 * pt}"/>${text(w / 2, h / 2, 'Chart', { size: 18 * pt })}</svg>`;
  }

  const pad = 10 * pt;
  let top = pad, bottom = h - pad, left = pad, right = w - pad;
  if (m.title) {
    out.push(text(w / 2, pad + 10 * pt, m.title, { size: 15 * pt, weight: 600 }));
    top += 28 * pt;
  }
  const pie = m.kind === 'pie' || m.kind === 'doughnut';
  const names = pie ? m.series[0].cats : m.series.map((s) => s.name);
  if (m.legend && names.length) {
    const colorFor = (i) => (pie ? m.series[0].ptColors[i] ?? m.palette[i] : m.series[i].color);
    if (m.legendPos === 'r' || m.legendPos === 'l') {
      const lw = 110 * pt;
      const x0 = m.legendPos === 'r' ? right - lw + 6 * pt : left;
      names.forEach((n, i) => {
        const y = top + (bottom - top) / 2 - (names.length * 18 * pt) / 2 + i * 18 * pt + 9 * pt;
        out.push(`<rect class="cfade" x="${x0}" y="${y - 5 * pt}" width="${10 * pt}" height="${10 * pt}" fill="${colorFor(i)}"/>` + text(x0 + 15 * pt, y, n, { anchor: 'start' }));
      });
      if (m.legendPos === 'r') right -= lw; else left += lw;
    } else {
      const widths = names.map((n) => 24 * pt + String(n).length * FS * 0.55);
      let x = w / 2 - widths.reduce((a, b) => a + b, 0) / 2;
      const y = bottom - 8 * pt;
      names.forEach((n, i) => {
        out.push(`<rect class="cfade" x="${x}" y="${y - 5 * pt}" width="${10 * pt}" height="${10 * pt}" fill="${colorFor(i)}"/>` + text(x + 15 * pt, y, n, { anchor: 'start' }));
        x += widths[i];
      });
      bottom -= 24 * pt;
    }
  }

  if (pie) {
    const s = m.series[0];
    const total = s.vals.reduce((a, b) => a + Math.max(0, b), 0) || 1;
    const cx = (left + right) / 2, cy = (top + bottom) / 2, r = Math.min(right - left, bottom - top) / 2 * 0.92;
    const r0 = m.kind === 'doughnut' ? r * m.hole : 0;
    let a0 = -Math.PI / 2;
    s.vals.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const P = (rad, a) => `${(cx + rad * Math.cos(a)).toFixed(2)} ${(cy + rad * Math.sin(a)).toFixed(2)}`;
      const d = r0
        ? `M${P(r, a0)}A${r} ${r} 0 ${big} 1 ${P(r, a1)}L${P(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${P(r0, a0)}Z`
        : `M${cx} ${cy}L${P(r, a0)}A${r} ${r} 0 ${big} 1 ${P(r, a1)}Z`;
      out.push(`<path class="cslice" d="${d}" fill="${s.ptColors[i] ?? m.palette[i]}" stroke="#fff" stroke-width="${1.5 * pt}" style="transform-origin:${cx}px ${cy}px"/>`);
      if ((s.showVal || s.showPercent) && v > 0) {
        const am = (a0 + a1) / 2, rl = r0 ? (r + r0) / 2 : r * 0.65;
        const label = s.showPercent ? `${Math.round((v / total) * 100)}%` : fmt(v);
        out.push(text(cx + rl * Math.cos(am), cy + rl * Math.sin(am), label, { fill: '#fff', weight: 600 }));
      }
      a0 = a1;
    });
    return svgWrap(w, h, out);
  }

  // ---- cartesian ----
  const ns = m.series.length;
  const nc = Math.max(...m.series.map((s) => s.vals.length));
  const stacked = m.grouping === 'stacked' || m.grouping === 'percentStacked';
  const pct = m.grouping === 'percentStacked';
  const isBar = m.kind === 'bar';
  const scatter = m.kind === 'scatter';
  const catTot = Array.from({ length: nc }, (_, c) => m.series.reduce((a, s) => a + Math.abs(s.vals[c] ?? 0), 0) || 1);
  const val = (s, c) => (pct ? ((s.vals[c] ?? 0) / catTot[c]) * 100 : s.vals[c] ?? 0);

  let vmin = 0, vmax = 0;
  if (scatter) {
    vmin = Math.min(...m.series.flatMap((s) => s.vals));
    vmax = Math.max(...m.series.flatMap((s) => s.vals));
  } else if (stacked) {
    for (let c = 0; c < nc; c++) {
      let pos = 0, neg = 0;
      for (const s of m.series) (val(s, c) >= 0 ? (pos += val(s, c)) : (neg += val(s, c)));
      vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg);
    }
  } else {
    for (const s of m.series) for (let c = 0; c < nc; c++) { vmax = Math.max(vmax, val(s, c)); vmin = Math.min(vmin, val(s, c)); }
  }
  const ticks = niceScale(vmin, vmax);
  const lo = ticks[0], hi = ticks[ticks.length - 1];

  const horizontal = isBar && m.horizontal;
  const axisL = (horizontal ? 70 : 42) * pt, axisB = 26 * pt;
  const px0 = left + axisL, px1 = right - 4 * pt, py0 = top + 6 * pt, py1 = bottom - axisB;
  const pw = px1 - px0, ph = py1 - py0;
  const V = (v) => (horizontal ? px0 + ((v - lo) / (hi - lo)) * pw : py1 - ((v - lo) / (hi - lo)) * ph);

  // gridlines + value labels
  for (const t of ticks) {
    const p = V(t);
    out.push(
      horizontal
        ? `<line class="cfade" x1="${p}" y1="${py0}" x2="${p}" y2="${py1}" stroke="${GRID}" stroke-width="${pt}"/>` + text(p, py1 + 14 * pt, fmt(t))
        : `<line class="cfade" x1="${px0}" y1="${p}" x2="${px1}" y2="${p}" stroke="${GRID}" stroke-width="${pt}"/>` + text(px0 - 6 * pt, p, fmt(t), { anchor: 'end' }),
    );
  }
  const cats = m.series[0].cats;
  const band = (horizontal ? ph : pw) / nc;
  const cpos = (c) => (horizontal ? py1 - (c + 0.5) * band : px0 + (c + 0.5) * band);
  if (!scatter) {
    for (let c = 0; c < nc; c++) {
      const label = cats[c] ?? String(c + 1);
      out.push(horizontal ? text(px0 - 6 * pt, cpos(c), label, { anchor: 'end' }) : text(cpos(c), py1 + 14 * pt, label));
    }
  }
  const axis = horizontal ? `<line class="cfade" x1="${V(0)}" y1="${py0}" x2="${V(0)}" y2="${py1}" stroke="#a6a6a6" stroke-width="${pt}"/>` : `<line class="cfade" x1="${px0}" y1="${V(0)}" x2="${px1}" y2="${V(0)}" stroke="#a6a6a6" stroke-width="${pt}"/>`;
  out.push(axis);

  if (isBar) {
    const bw = band / ((stacked ? 1 : ns) + m.gap);
    const origin = horizontal ? '0% 50%' : '50% 100%';
    const grow = horizontal ? 'x' : 'y';
    for (let c = 0; c < nc; c++) {
      let posAcc = 0, negAcc = 0;
      m.series.forEach((s, si) => {
        const v = val(s, c);
        let a, b;
        if (stacked) { if (v >= 0) { a = posAcc; b = posAcc += v; } else { a = negAcc; b = negAcc += v; } } else { a = 0; b = v; }
        const along = (stacked ? 0 : si - (ns - 1) / 2) * bw;
        const c0 = cpos(c) + along - bw / 2;
        const [p0, p1] = [V(a), V(b)];
        const rect = horizontal
          ? { x: Math.min(p0, p1), y: c0, w: Math.abs(p1 - p0), h: bw }
          : { x: c0, y: Math.min(p0, p1), w: bw, h: Math.abs(p1 - p0) };
        const fill = m.series[si].ptColors[c] ?? s.color;
        out.push(`<rect class="cbar" data-grow="${grow}" x="${rect.x.toFixed(2)}" y="${rect.y.toFixed(2)}" width="${Math.max(rect.w, 0).toFixed(2)}" height="${Math.max(rect.h, 0).toFixed(2)}" fill="${fill}" style="transform-box:fill-box;transform-origin:${origin}"/>`);
        if (s.showVal) {
          out.push(horizontal ? text(rect.x + rect.w + 4 * pt, rect.y + rect.h / 2, fmt(v), { anchor: 'start' }) : text(rect.x + rect.w / 2, rect.y - 8 * pt, fmt(v)));
        }
      });
    }
  } else if (scatter) {
    const xs = m.series.flatMap((s) => s.cats.map(Number));
    const xt = niceScale(Math.min(...xs), Math.max(...xs));
    const X = (x) => px0 + ((x - xt[0]) / (xt[xt.length - 1] - xt[0])) * pw;
    xt.forEach((t) => out.push(text(X(t), py1 + 14 * pt, fmt(t))));
    for (const s of m.series) s.vals.forEach((v, i) => out.push(`<circle class="cpt" cx="${X(Number(s.cats[i]))}" cy="${V(v)}" r="${4 * pt}" fill="${s.color}" style="transform-box:fill-box;transform-origin:center"/>`));
  } else {
    // line / area
    m.series.forEach((s, si) => {
      const pts = s.vals.map((v, c) => [px0 + (c + 0.5) * band, V(val(s, c))]);
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('');
      if (m.kind === 'area') {
        out.push(`<path class="carea" d="${d}L${pts.at(-1)[0]} ${V(0)}L${pts[0][0]} ${V(0)}Z" fill="${s.color}" fill-opacity="0.75"/>`);
      } else {
        out.push(`<path class="cline" pathLength="1" d="${d}" fill="none" stroke="${s.color}" stroke-width="${2.6 * pt}" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="1" stroke-dashoffset="0"/>`);
        pts.forEach(([x, y], i) => {
          out.push(`<circle class="cpt" cx="${x}" cy="${y}" r="${3.6 * pt}" fill="${s.color}" style="transform-box:fill-box;transform-origin:center"/>`);
          if (s.showVal) out.push(text(x, y - 10 * pt, fmt(s.vals[i])));
        });
      }
    });
  }
  return svgWrap(w, h, out);
}

function svgWrap(w, h, parts) {
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible;font-family:Calibri,'Segoe UI',Arial,sans-serif">${parts.join('')}</svg>`;
}
