import { geometryPaths, isLine } from './geometry.js';
import { renderChart } from './chart.js';

// Element model -> absolutely positioned HTML/SVG. Class names here are the animation hooks used by animate.js:
//   .pos > .el[data-eid]  whole element      .tin > .para   paragraphs      .w   words (when split)
//   tr.trow   table rows                      .cbar/.cline/.cpt/.cslice/.cfade/.carea   chart parts
//   .kb       picture inner layer (Ken Burns)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n2 = (n) => +Number(n).toFixed(2);
const fontStack = (f) => `'${String(f).replace(/['"<>\\]/g, '')}',Calibri,'Segoe UI',Arial,sans-serif`;

const DASH = { dash: [4, 3], sysDash: [3, 1], dot: [1, 3], sysDot: [1, 1], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], sysDashDot: [3, 1, 1, 1] };

const tokens = (text) => text.split(/(\s+)/);
export function countWords(paras) {
  let n = 0;
  for (const p of paras) for (const r of p.runs) if (!r.br) n += tokens(r.text ?? '').filter((t) => t && !/^\s+$/.test(t)).length;
  return n;
}

export function cssFill(fill) {
  if (!fill) return 'none';
  switch (fill.type) {
    case 'solid': return fill.color;
    case 'grad': {
      const stops = fill.stops.map((s) => `${s.color} ${n2(s.pos * 100)}%`).join(',');
      return fill.radial ? `radial-gradient(circle,${stops})` : `linear-gradient(${n2(fill.angle + 90)}deg,${stops})`;
    }
    case 'blip': return `url("${fill.src}") center/cover no-repeat`;
    default: return 'none';
  }
}

// ---------------------------------------------------------------- text

function runHtml(r, split) {
  if (r.br) return '<br>';
  let s = `font-size:calc(var(--fit,1)*${n2(r.px)}px);font-family:${fontStack(r.font)};`;
  if (r.color) s += `color:${r.color};`;
  if (r.b) s += 'font-weight:700;';
  if (r.i) s += 'font-style:italic;';
  if (r.u || r.strike) s += `text-decoration:${[r.u && 'underline', r.strike && 'line-through'].filter(Boolean).join(' ')};`;
  if (r.baseline) s += `vertical-align:${r.baseline > 0 ? 'super' : 'sub'};font-size:calc(var(--fit,1)*${n2(r.px * 0.65)}px);`;
  if (r.cap === 'all') s += 'text-transform:uppercase;';
  else if (r.cap === 'small') s += 'font-variant:small-caps;';
  if (r.spc) s += `letter-spacing:${n2(r.spc)}px;`;
  const body = split
    ? tokens(r.text ?? '').map((t) => (!t ? '' : /^\s+$/.test(t) ? esc(t) : `<span class="w">${esc(t)}</span>`)).join('')
    : esc(r.text ?? '');
  return `<span style="${s}">${body}</span>`;
}

const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', dist: 'justify' };

function parasHtml(paras, { split = false, wrap = true } = {}) {
  return paras
    .map((p, i) => {
      const fs = p.px;
      const gap = (s) => (!s ? 0 : s.px !== undefined ? s.px : s.pct * fs * 1.2);
      const lh = p.lnSpc ? (p.lnSpc.px !== undefined ? `${n2(p.lnSpc.px)}px` : n2(p.lnSpc.pct * 1.2)) : '1.2';
      let style = `margin-top:${i ? n2(gap(p.spcBef)) : 0}px;margin-bottom:${i < paras.length - 1 ? n2(gap(p.spcAft)) : 0}px;`;
      let bullet = '';
      let textIndent = '';
      if (p.bu) {
        const box = p.indent < 0 ? -p.indent : p.bu.px * 1.1;
        const start = p.indent < 0 ? Math.max(0, p.marL + p.indent) : p.marL;
        style += `padding-left:${n2(start)}px;`;
        bullet = `<span class="bu" style="width:${n2(box)}px;font-size:calc(var(--fit,1)*${n2(p.bu.px)}px);font-family:${fontStack(p.bu.font)};${p.bu.color ? `color:${p.bu.color};` : ''}line-height:${lh}">${esc(p.bu.text)}</span>`;
      } else {
        style += `padding-left:${n2(Math.max(0, p.marL))}px;`;
        if (p.indent) textIndent = `text-indent:${n2(p.indent)}px;`;
      }
      const inner = p.runs.length && p.runs.some((r) => r.br || r.text)
        ? p.runs.map((r) => runHtml(r, split)).join('')
        : `<span style="font-size:calc(var(--fit,1)*${n2(p.px)}px)">&#8203;</span>`;
      const ta = `text-align:${ALIGN[p.algn] ?? 'left'};`;
      return `<div class="para" style="${style}">${bullet}<div class="pt" style="${ta}line-height:${lh};white-space:${wrap ? 'pre-wrap' : 'pre'};${textIndent}">${inner}</div></div>`;
    })
    .join('');
}

function textHtml(t, split) {
  const justify = { t: 'flex-start', ctr: 'center', b: 'flex-end' }[t.anchor] ?? 'flex-start';
  let extra = '';
  if (t.vert) extra = `writing-mode:vertical-rl;${t.vert === 'vert270' ? 'transform:rotate(180deg);' : ''}`;
  return `<div class="txt"${t.fit ? ' data-fit="1"' : ''} style="padding:${n2(t.ins.t)}px ${n2(t.ins.r)}px ${n2(t.ins.b)}px ${n2(t.ins.l)}px;justify-content:${justify};${extra}"><div class="tin">${parasHtml(t.paras, { split, wrap: t.wrap })}</div></div>`;
}

// ---------------------------------------------------------------- shapes

function markerDef(id, type, color, lw) {
  const size = Math.max(8, lw * 4);
  const shape = type === 'oval' ? '<circle cx="5" cy="5" r="4"/>' : type === 'arrow' ? '<path d="M1 1L9 5L1 9" fill="none" stroke="context-stroke" stroke-width="1.6"/>' : '<path d="M0 0L10 5L0 10Z"/>';
  return `<marker id="${id}" viewBox="0 0 10 10" refX="${type === 'oval' ? 5 : 8}" refY="5" markerWidth="${n2(size)}" markerHeight="${n2(size)}" markerUnits="userSpaceOnUse" orient="auto-start-reverse" fill="${color}" stroke="${type === 'arrow' ? color : 'none'}">${shape}</marker>`;
}

function shapeSvg(el, pad) {
  const { w, h, id } = el;
  const defs = [];
  let fill = 'none';
  const f = el.fill;
  if (f?.type === 'solid') fill = f.color;
  else if (f?.type === 'grad') {
    const stops = f.stops.map((s) => `<stop offset="${n2(s.pos * 100)}%" stop-color="${s.color}"/>`).join('');
    if (f.radial) defs.push(`<radialGradient id="g${id}" cx=".5" cy=".5" r=".5">${stops}</radialGradient>`);
    else {
      const a = (f.angle * Math.PI) / 180, dx = Math.cos(a) / 2, dy = Math.sin(a) / 2;
      defs.push(`<linearGradient id="g${id}" x1="${n2(0.5 - dx)}" y1="${n2(0.5 - dy)}" x2="${n2(0.5 + dx)}" y2="${n2(0.5 + dy)}">${stops}</linearGradient>`);
    }
    fill = `url(#g${id})`;
  } else if (f?.type === 'blip') {
    defs.push(`<pattern id="p${id}" patternUnits="userSpaceOnUse" width="${n2(w)}" height="${n2(h)}"><image href="${f.src}" width="${n2(w)}" height="${n2(h)}" preserveAspectRatio="xMidYMid slice"/></pattern>`);
    fill = `url(#p${id})`;
  }

  let stroke = 'stroke="none"';
  let markers = '';
  const ln = el.line;
  if (ln) {
    const dash = DASH[ln.dash];
    stroke = `stroke="${ln.color}" stroke-width="${n2(ln.w)}" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash.map((d) => n2(d * ln.w)).join(' ')}"` : ''}`;
    if (ln.head && ln.head !== 'none') { defs.push(markerDef(`mh${id}`, ln.head, ln.color, ln.w)); markers += ` marker-start="url(#mh${id})"`; }
    if (ln.tail && ln.tail !== 'none') { defs.push(markerDef(`mt${id}`, ln.tail, ln.color, ln.w)); markers += ` marker-end="url(#mt${id})"`; }
  }
  const sh = el.shadow;
  const filter = sh ? `filter:drop-shadow(${n2(sh.dx)}px ${n2(sh.dy)}px ${n2(sh.blur / 2)}px ${sh.color});` : '';
  // the svg box includes the padding so zero-height lines still have a renderable area
  const flip = ` transform="translate(${n2(pad + (el.flipH ? w : 0))} ${n2(pad + (el.flipV ? h : 0))}) scale(${el.flipH ? -1 : 1} ${el.flipV ? -1 : 1})"`;
  const paths = geometryPaths(el.geom, w, h)
    .map((p) => `<path d="${p.d}" fill="${p.fill ? fill : 'none'}" fill-rule="evenodd" ${p.stroke ? stroke : 'stroke="none"'}${markers}/>`)
    .join('');
  const bw = n2(w + pad * 2), bh = n2(h + pad * 2);
  return `<svg class="geo" width="${bw}" height="${bh}" viewBox="0 0 ${bw} ${bh}" style="left:0;top:0;${filter}">${defs.length ? `<defs>${defs.join('')}</defs>` : ''}<g${flip}>${paths}</g></svg>`;
}

function pos(el, pad = 0) {
  return `left:${n2(el.x - pad)}px;top:${n2(el.y - pad)}px;width:${n2(el.w + pad * 2)}px;height:${n2(el.h + pad * 2)}px;${el.rot ? `transform:rotate(${n2(el.rot)}deg);` : ''}`;
}
const attrs = (el, cls) => `class="el ${cls}"${el.decor ? '' : ` data-eid="${el.id}"`}`;

function shapeHtml(el) {
  const line = isLine(el.geom);
  const pad = line ? Math.ceil(Math.max(8, (el.line?.w ?? 1) * 3)) : 0;
  const svg = el.fill.type !== 'none' || el.line ? shapeSvg(el, pad) : '';
  const text = el.text ? textHtml(el.text, el.split === 'words') : '';
  return `<div class="pos" style="${pos(el, pad)}"><div ${attrs(el, line ? 'line' : 'shape')}>${svg}${text}</div></div>`;
}

function picHtml(el) {
  const c = el.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const vw = 1 - c.l - c.r || 1, vh = 1 - c.t - c.b || 1;
  const ss = Math.min(el.w, el.h);
  const prst = el.geom?.prst;
  const radius = prst === 'ellipse' ? '50%' : prst === 'roundRect' ? `${n2(ss * (el.geom.adj.adj ?? 16667) / 100000)}px` : '0';
  const flip = el.flipH || el.flipV ? `transform:scale(${el.flipH ? -1 : 1},${el.flipV ? -1 : 1});` : '';
  const img = `<img src="${el.src}" alt="" style="position:absolute;left:${n2((-c.l / vw) * el.w)}px;top:${n2((-c.t / vh) * el.h)}px;width:${n2(el.w / vw)}px;height:${n2(el.h / vh)}px;${flip}">`;
  const border = el.line ? `<div style="position:absolute;inset:0;box-sizing:border-box;border:${n2(el.line.w)}px solid ${el.line.color};border-radius:${radius}"></div>` : '';
  const sh = el.shadow ? `filter:drop-shadow(${n2(el.shadow.dx)}px ${n2(el.shadow.dy)}px ${n2(el.shadow.blur / 2)}px ${el.shadow.color});` : '';
  return `<div class="pos" style="${pos(el)}"><div ${attrs(el, 'pic')} style="${sh}"><div style="position:absolute;inset:0;overflow:hidden;border-radius:${radius}"><div class="kb">${img}</div></div>${border}</div></div>`;
}

function mix(hex, k) {
  // blend a #rrggbb colour towards white; k = share of the original colour
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.round(((n >> s) & 255) * k + 255 * (1 - k));
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function tableHtml(el) {
  const sum = el.cols.reduce((a, b) => a + b, 0) || el.w;
  const k = el.w / sum;
  const colgroup = el.cols.map((w) => `<col style="width:${n2(w * k)}px">`).join('');
  const hair = Math.max(1, el.w / 900);
  const rows = el.rows
    .map((row, ri) => {
      const header = el.firstRow && ri === 0;
      const band = el.bandRow ? ((ri - (el.firstRow ? 1 : 0)) % 2 === 0 ? mix(el.accent, 0.4) : mix(el.accent, 0.2)) : null;
      const tds = row.cells
        .map((c) => {
          if (c.skip) return '';
          let bg = header ? el.accent : band ?? 'transparent';
          if (c.fill?.type === 'solid') bg = c.fill.color;
          else if (c.fill?.type === 'none') bg = 'transparent';
          const b = (side) => {
            const l = c.borders[side];
            if (l === null) return 'none';
            if (l) return `${n2(l.w)}px solid ${l.color}`;
            return `${n2(hair)}px solid #fff`;
          };
          const style = `background:${bg};padding:${n2(c.ins.t)}px ${n2(c.ins.r)}px ${n2(c.ins.b)}px ${n2(c.ins.l)}px;vertical-align:${{ ctr: 'middle', b: 'bottom' }[c.anchor] ?? 'top'};border-left:${b('L')};border-right:${b('R')};border-top:${b('T')};border-bottom:${b('B')};${header ? 'color:#fff;font-weight:700;' : ''}`;
          return `<td colspan="${c.colSpan}" rowspan="${c.rowSpan}" style="${style}">${parasHtml(c.paras)}</td>`;
        })
        .join('');
      return `<tr class="trow" style="height:${n2(row.h)}px">${tds}</tr>`;
    })
    .join('');
  return `<div class="pos" style="${pos(el)}"><div ${attrs(el, 'table')}><table style="width:100%;border-collapse:collapse;table-layout:fixed;color:#000"><colgroup>${colgroup}</colgroup>${rows}</table></div></div>`;
}

function chartHtml(el, pt) {
  return `<div class="pos" style="${pos(el)}"><div ${attrs(el, 'chart')}>${renderChart(el.chart, n2(el.w), n2(el.h), pt)}</div></div>`;
}

const CSS = `
html,body{margin:0;padding:0;background:#000;overflow:hidden}
#slide{position:absolute;left:0;top:0;overflow:hidden}
#cam{position:absolute;inset:0;transform-origin:0 0}
.pos{position:absolute}
.el{position:absolute;inset:0}
.geo{position:absolute;overflow:visible}
.txt{position:absolute;inset:0;box-sizing:border-box;display:flex;flex-direction:column;font-size:0}
.tin{width:100%}
.para{display:flex;align-items:baseline}
.pt{flex:1;min-width:0;overflow-wrap:break-word}
.bu{flex:none;white-space:pre}
.w{display:inline-block}
.kb{position:absolute;inset:0}
table{font-size:0}
td{box-sizing:border-box;font-size:0;overflow:hidden}
img{display:block;max-width:none}
`;

export function slideHtml(model) {
  const pt = model.scale * 12700;
  const body = model.elements
    .map((el) => {
      switch (el.type) {
        case 'shape': return shapeHtml(el);
        case 'pic': return picHtml(el);
        case 'table': return tableHtml(el);
        case 'chart': return chartHtml(el, pt);
        default: return '';
      }
    })
    .join('\n');
  const bgStyle = `background:${cssFill(model.bg)}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div id="slide" style="width:${model.width}px;height:${model.height}px;${bgStyle}"><div id="cam">${body}</div></div></body></html>`;
}
