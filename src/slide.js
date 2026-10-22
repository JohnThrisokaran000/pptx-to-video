import { cssColorOf } from './color.js';
import { parseChart } from './chart.js';

// Turns one slide (+ its layout and master) into a flat list of positioned elements, all in output px.

const EMU_PT = 12700;
const IDENT = { sx: 1, sy: 1, tx: 0, ty: 0 };
const LINE_PRESET_W = [0, 6350, 12700, 19050];

const BULLETS = {
  Wingdings: { '§': '▪', 'Ø': '➢', 'ü': '✓', l: '●', q: '❑', n: '■', v: '❖', u: '◆', '¨': '◻', 'ž': '·' },
  'Wingdings 2': { 'Ï': '▪' },
  Symbol: { '·': '•', '§': '▪' },
};

// ---------------------------------------------------------------- placeholders

function phOf(node) {
  const ph = node.at('p:nvSpPr/p:nvPr/p:ph') ?? node.at('p:nvPicPr/p:nvPr/p:ph') ?? node.at('p:nvGraphicFramePr/p:nvPr/p:ph');
  return ph ? { type: ph.attr('type', 'body'), idx: ph.attr('idx') } : null;
}
const phClass = (t) => (t === 'ctrTitle' || t === 'title' ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' ? t : 'body');

function findPh(tree, ph) {
  if (!tree) return null;
  const cands = tree.children
    .filter((c) => c.name === 'p:sp' || c.name === 'p:pic' || c.name === 'p:graphicFrame')
    .map((c) => ({ c, ph: phOf(c) }))
    .filter((x) => x.ph);
  const hit = (ph.idx != null && cands.find((x) => x.ph.idx === ph.idx)) || cands.find((x) => phClass(x.ph.type) === phClass(ph.type));
  return hit?.c ?? null;
}

// ---------------------------------------------------------------- fills / lines

async function readFill(parent, env) {
  const { S } = env;
  for (const c of parent.children) {
    switch (c.name) {
      case 'a:noFill': return { type: 'none' };
      case 'a:solidFill': {
        const color = cssColorOf(c, S.cc);
        return color ? { type: 'solid', color } : undefined;
      }
      case 'a:gradFill': {
        const stops = (c.at('a:gsLst')?.all('a:gs') ?? []).map((g) => ({ pos: g.num('pos', 0) / 100000, color: cssColorOf(g, S.cc) ?? '#000' }));
        if (!stops.length) return undefined;
        const lin = c.get('a:lin');
        return { type: 'grad', stops, angle: lin ? lin.num('ang', 0) / 60000 : 90, radial: !!c.get('a:path') && c.get('a:path').attr('path') !== 'rect' };
      }
      case 'a:pattFill': {
        const color = cssColorOf(c.get('a:fgClr'), S.cc);
        return color ? { type: 'solid', color } : undefined;
      }
      case 'a:blipFill': {
        const rid = c.get('a:blip')?.attr('r:embed');
        const src = rid ? await S.deck.image(env.rels.get(rid)?.target) : null;
        return src ? { type: 'blip', src } : undefined;
      }
      default: break;
    }
  }
  return undefined;
}

/** -> undefined (unspecified) | null (explicitly none) | partial line spec */
async function readLine(ln, env) {
  if (!ln) return undefined;
  if (ln.get('a:noFill')) return null;
  const fill = await readFill(ln, env);
  const color = fill?.type === 'solid' ? fill.color : fill?.type === 'grad' ? fill.stops[0]?.color : undefined;
  return {
    w: ln.attrs.w !== undefined ? ln.num('w') * env.S.scale : undefined,
    color,
    dash: ln.get('a:prstDash')?.attr('val'),
    head: ln.get('a:headEnd')?.attr('type'),
    tail: ln.get('a:tailEnd')?.attr('type'),
  };
}

function resolveLine(spec, style, S) {
  if (spec === null) return null;
  const ref = style?.get('a:lnRef');
  const idx = ref?.num('idx', 0) ?? 0;
  const st = idx > 0 ? { color: cssColorOf(ref, S.cc), w: (LINE_PRESET_W[idx] ?? 12700) * S.scale } : null;
  const color = spec?.color ?? st?.color;
  if (!color) return null;
  return { w: Math.max(1, spec?.w ?? st?.w ?? 12700 * S.scale), color, dash: spec?.dash, head: spec?.head, tail: spec?.tail };
}

function readShadow(spPr, S) {
  const sh = spPr?.at('a:effectLst/a:outerShdw');
  if (!sh) return null;
  const dist = sh.num('dist', 0) * S.scale, dir = (sh.num('dir', 0) / 60000) * (Math.PI / 180);
  return { dx: dist * Math.cos(dir), dy: dist * Math.sin(dir), blur: sh.num('blurRad', 0) * S.scale, color: cssColorOf(sh, S.cc) ?? 'rgba(0,0,0,.35)' };
}

// ---------------------------------------------------------------- geometry

function readGeom(spPr) {
  const pg = spPr?.get('a:prstGeom');
  if (pg) {
    const adj = {};
    for (const gd of pg.at('a:avLst')?.all('a:gd') ?? []) {
      const m = /val\s+(-?\d+)/.exec(gd.attr('fmla', ''));
      if (m) adj[gd.attr('name')] = Number(m[1]);
    }
    return { prst: pg.attr('prst', 'rect'), adj };
  }
  const cg = spPr?.get('a:custGeom');
  if (cg) {
    const pt = (n) => [n?.num('x', 0) ?? 0, n?.num('y', 0) ?? 0];
    const cust = (cg.at('a:pathLst')?.all('a:path') ?? []).map((p) => {
      const cmds = [];
      for (const c of p.children) {
        if (c.name === 'a:moveTo') cmds.push({ t: 'M', pts: [pt(c.get('a:pt'))] });
        else if (c.name === 'a:lnTo') cmds.push({ t: 'L', pts: [pt(c.get('a:pt'))] });
        else if (c.name === 'a:cubicBezTo') cmds.push({ t: 'C', pts: c.all('a:pt').map(pt) });
        else if (c.name === 'a:quadBezTo') cmds.push({ t: 'Q', pts: c.all('a:pt').map(pt) });
        else if (c.name === 'a:arcTo') cmds.push({ t: 'A', wR: c.num('wR'), hR: c.num('hR'), stAng: c.num('stAng'), swAng: c.num('swAng') });
        else if (c.name === 'a:close') cmds.push({ t: 'Z' });
      }
      return { w: p.num('w', 0), h: p.num('h', 0), cmds, fill: p.attr('fill'), stroke: !['0', 'false'].includes(p.attr('stroke')) };
    });
    return { cust };
  }
  return null;
}

function place(xfrm, xf, scale) {
  const off = xfrm.get('a:off'), ext = xfrm.get('a:ext');
  return {
    x: (xf.tx + xf.sx * off.num('x')) * scale,
    y: (xf.ty + xf.sy * off.num('y')) * scale,
    w: ext.num('cx') * xf.sx * scale,
    h: ext.num('cy') * xf.sy * scale,
    rot: xfrm.num('rot', 0) / 60000,
    flipH: xfrm.bool('flipH'),
    flipV: xfrm.bool('flipV'),
  };
}

// ---------------------------------------------------------------- text

function readRPr(n, env) {
  const o = {};
  if (!n) return o;
  const a = n.attrs;
  if (a.sz) o.sz = Number(a.sz) / 100;
  if (a.b !== undefined) o.b = a.b === '1' || a.b === 'true';
  if (a.i !== undefined) o.i = a.i === '1' || a.i === 'true';
  if (a.u !== undefined) o.u = a.u !== 'none';
  if (a.strike !== undefined) o.strike = a.strike !== 'noStrike';
  if (a.baseline !== undefined) o.baseline = Number(a.baseline);
  if (a.cap !== undefined) o.cap = a.cap;
  if (a.spc !== undefined) o.spc = Number(a.spc) / 100;
  const color = cssColorOf(n.get('a:solidFill'), env.S.cc);
  if (color) o.color = color;
  const face = n.get('a:latin')?.attr('typeface');
  if (face) o.font = face;
  return o;
}

function readSpacing(n) {
  if (!n) return undefined;
  const pct = n.get('a:spcPct'), pts = n.get('a:spcPts');
  if (pct) return { pct: pct.num('val') / 100000 };
  if (pts) return { pts: pts.num('val') / 100 };
  return undefined;
}

function readPPr(n, env) {
  const o = { rPr: {} };
  if (!n) return o;
  if (n.attrs.marL !== undefined) o.marL = n.num('marL');
  if (n.attrs.indent !== undefined) o.indent = n.num('indent');
  if (n.attrs.algn) o.algn = n.attrs.algn;
  for (const k of ['lnSpc', 'spcBef', 'spcAft']) {
    const s = readSpacing(n.get(`a:${k}`));
    if (s) o[k] = s;
  }
  for (const c of n.children) {
    if (c.name === 'a:buNone') o.bu = { type: 'none' };
    else if (c.name === 'a:buChar') o.bu = { type: 'char', char: c.attr('char', '•') };
    else if (c.name === 'a:buAutoNum') o.bu = { type: 'num', scheme: c.attr('type', 'arabicPeriod'), startAt: c.num('startAt', 1) };
    else if (c.name === 'a:buFont') o.buFont = c.attr('typeface');
    else if (c.name === 'a:buClr') o.buClr = cssColorOf(c, env.S.cc);
    else if (c.name === 'a:buSzPct') o.buSz = c.num('val', 100000) / 100000;
  }
  o.rPr = readRPr(n.get('a:defRPr'), env);
  return o;
}

function mergeP(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (k === 'rPr') Object.assign(dst.rPr, v);
    else if (v !== undefined) dst[k] = v;
  }
}

function numLabel(n, scheme) {
  let core;
  if (scheme.startsWith('alphaLc') || scheme.startsWith('alphaUc')) {
    core = String.fromCharCode(97 + ((n - 1) % 26));
    if (scheme.startsWith('alphaUc')) core = core.toUpperCase();
  } else if (scheme.startsWith('romanLc') || scheme.startsWith('romanUc')) {
    const map = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let r = '', v = n;
    for (const [k, s] of map) while (v >= k) { r += s; v -= k; }
    core = scheme.startsWith('romanUc') ? r.toUpperCase() : r;
  } else core = String(n);
  if (scheme.includes('ParenBoth')) return `(${core})`;
  if (scheme.includes('ParenR')) return `${core})`;
  if (scheme.includes('Period')) return `${core}.`;
  return core;
}

/** layers: list-style containers (El) and { fontRef } pseudo layers, lowest priority first. */
function buildParas(txBody, env, layers) {
  const { S } = env;
  const px = (pt) => pt * EMU_PT * S.scale;
  const spc = (s) => (s?.pts !== undefined ? { px: px(s.pts) } : s);
  const paras = [];
  const counters = [];
  const fontFace = (f) => (f === '+mj-lt' ? S.theme.major : f === '+mn-lt' ? S.theme.minor : f);

  for (const p of txBody.all('a:p')) {
    const pPr = p.get('a:pPr');
    const lvl = Math.min(8, pPr?.num('lvl', 0) ?? 0);
    const ps = { rPr: {} };
    for (const L of layers) {
      if (L.fontRef) mergeP(ps, { rPr: L.fontRef });
      else mergeP(ps, readPPr(L.get(`a:lvl${lvl + 1}pPr`), env));
    }
    mergeP(ps, readPPr(pPr, env));

    const toRun = (rp) => {
      const r = { px: px(rp.sz ?? 18) };
      if (rp.b) r.b = true;
      if (rp.i) r.i = true;
      if (rp.u) r.u = true;
      if (rp.strike) r.strike = true;
      if (rp.baseline) r.baseline = rp.baseline;
      if (rp.cap) r.cap = rp.cap;
      if (rp.spc) r.spc = px(rp.spc);
      if (rp.color) r.color = rp.color;
      r.font = fontFace(rp.font) ?? S.theme.minor;
      return r;
    };

    const runs = [];
    let endRp;
    for (const c of p.children) {
      if (c.name === 'a:r' || c.name === 'a:fld' || c.name === 'a:br') {
        const rp = { ...ps.rPr, ...readRPr(c.get('a:rPr'), env) };
        if (c.name === 'a:br') runs.push({ br: true, ...toRun(rp) });
        else {
          let text = c.get('a:t')?.text ?? '';
          if (c.name === 'a:fld' && /slidenum/i.test(c.attr('type', ''))) text = String(S.index + 1);
          runs.push({ text, ...toRun(rp) });
        }
      } else if (c.name === 'a:endParaRPr') endRp = readRPr(c, env);
    }

    const first = runs.find((r) => !r.br && r.text) ?? null;
    const base = first ?? toRun({ ...ps.rPr, ...endRp });
    let bu = null;
    const hasText = !!first;
    if (hasText && ps.bu && ps.bu.type !== 'none') {
      let text;
      if (ps.bu.type === 'char') {
        text = BULLETS[ps.buFont]?.[ps.bu.char] ?? ps.bu.char;
        counters.length = Math.min(counters.length, lvl);
      } else {
        counters[lvl] = (counters[lvl] ?? ps.bu.startAt - 1) + 1;
        counters.length = lvl + 1;
        text = numLabel(counters[lvl], ps.bu.scheme);
      }
      bu = { text, color: ps.buClr ?? base.color, px: base.px * (ps.buSz ?? 1), font: ps.bu.type === 'char' && BULLETS[ps.buFont] ? base.font : fontFace(ps.buFont) ?? base.font };
    } else {
      counters.length = Math.min(counters.length, lvl);
    }

    paras.push({
      lvl,
      algn: ps.algn,
      marL: (ps.marL ?? 0) * S.scale,
      indent: (ps.indent ?? 0) * S.scale,
      lnSpc: ps.lnSpc?.pts !== undefined ? { px: px(ps.lnSpc.pts) } : ps.lnSpc,
      spcBef: spc(ps.spcBef),
      spcAft: spc(ps.spcAft),
      bu,
      runs,
      px: base.px,
    });
  }
  return paras;
}

const textOf = (paras) => paras.map((p) => p.runs.map((r) => (r.br ? '\n' : r.text ?? '')).join('')).join('\n');

// ---------------------------------------------------------------- shape builders

function baseStyle(S, ph) {
  if (!ph) return S.deck.defaultTextStyle;
  const tx = S.masterXml?.get('p:txStyles');
  const c = phClass(ph.type);
  return c === 'title' ? tx?.get('p:titleStyle') : c === 'body' ? tx?.get('p:bodyStyle') : tx?.get('p:otherStyle');
}

function push(out, env, el) {
  el.id = env.S.nextId();
  el.group = env.group ?? null;
  el.decor = env.source !== 'slide';
  out.push(el);
}

async function buildSp(sp, env, out) {
  const { S } = env;
  const ph = phOf(sp);
  if (ph && env.source !== 'slide') return; // layout / master placeholders are templates only
  const chain = [sp];
  if (ph) {
    const l = findPh(S.layoutTree, ph);
    if (l) chain.push(l);
    const m = findPh(S.masterTree, ph);
    if (m) chain.push(m);
  }
  const xfrm = chain.map((s) => s.at('p:spPr/a:xfrm')).find((x) => x?.get('a:off') && x?.get('a:ext'));
  if (!xfrm) return;
  const box = place(xfrm, env.xf, S.scale);
  const style = sp.get('p:style');
  const spPrs = chain.map((s) => s.get('p:spPr')).filter(Boolean);

  let geom = null;
  for (const pr of spPrs) if ((geom = readGeom(pr))) break;
  geom ??= { prst: 'rect', adj: {} };

  let fill;
  for (const pr of spPrs) if ((fill = await readFill(pr, env)) !== undefined) break;
  if (fill === undefined) {
    const fr = style?.get('a:fillRef');
    const c = fr && fr.num('idx') > 0 ? cssColorOf(fr, S.cc) : null;
    fill = c ? { type: 'solid', color: c } : { type: 'none' };
  }

  let lnSpec;
  for (const pr of spPrs) if ((lnSpec = await readLine(pr.get('a:ln'), env)) !== undefined) break;
  const line = resolveLine(lnSpec, style, S);

  let text = null;
  const txBody = sp.get('p:txBody');
  if (txBody) {
    const fr = style?.get('a:fontRef');
    const fontRef = {};
    if (fr) {
      const c = cssColorOf(fr, S.cc);
      if (c) fontRef.color = c;
    }
    const lst = chain.slice().reverse().map((s) => s.at('p:txBody/a:lstStyle')).filter(Boolean);
    const layers = [baseStyle(S, ph), ...(fr && fontRef.color ? [{ fontRef }] : []), ...lst].filter(Boolean);
    const paras = buildParas(txBody, env, layers);
    const bps = chain.slice().reverse().map((s) => s.at('p:txBody/a:bodyPr')).filter(Boolean);
    const at = Object.assign({}, ...bps.map((b) => b.attrs));
    const fit = bps.slice().reverse().map((b) => (b.get('a:normAutofit') ? 'norm' : b.get('a:spAutoFit') ? 'sp' : b.get('a:noAutofit') ? 'none' : null)).find(Boolean);
    const num = (k, d) => (at[k] !== undefined ? Number(at[k]) : d) * S.scale;
    text = {
      paras,
      anchor: at.anchor ?? 't',
      ins: { l: num('lIns', 91440), t: num('tIns', 45720), r: num('rIns', 91440), b: num('bIns', 45720) },
      wrap: at.wrap !== 'none',
      vert: at.vert && at.vert !== 'horz' ? at.vert : null,
      fit: fit === 'norm',
      plain: textOf(paras),
    };
  }
  const hasText = !!text?.plain.trim();
  if (!hasText && fill.type === 'none' && !line) return;
  if (!hasText) text = null;

  push(out, env, {
    type: 'shape', ...box, geom, fill, line, shadow: readShadow(spPrs[0], S), text, ph: ph?.type ?? null,
    isTextBox: !!sp.at('p:nvSpPr/p:cNvSpPr')?.bool('txBox'), name: sp.at('p:nvSpPr/p:cNvPr')?.attr('name') ?? '',
  });
}

async function buildPic(pic, env, out) {
  const { S } = env;
  const ph = phOf(pic);
  const chain = [pic];
  if (ph) {
    const l = findPh(S.layoutTree, ph);
    if (l) chain.push(l);
  }
  const xfrm = chain.map((s) => s.at('p:spPr/a:xfrm')).find((x) => x?.get('a:off') && x?.get('a:ext'));
  if (!xfrm) return;
  const bf = pic.get('p:blipFill');
  const rid = bf?.get('a:blip')?.attr('r:embed');
  const src = rid ? await S.deck.image(env.rels.get(rid)?.target) : null;
  if (!src) {
    S.warnings.push(`slide ${S.index + 1}: picture skipped (missing or unsupported image format)`);
    return;
  }
  const sr = bf.get('a:srcRect');
  const crop = sr ? { l: sr.num('l') / 100000, t: sr.num('t') / 100000, r: sr.num('r') / 100000, b: sr.num('b') / 100000 } : null;
  const spPr = pic.get('p:spPr');
  const lnSpec = await readLine(spPr?.get('a:ln'), env);
  push(out, env, {
    type: 'pic', ...place(xfrm, env.xf, S.scale), src, crop, geom: readGeom(spPr),
    line: lnSpec ? resolveLine(lnSpec, null, S) : null, shadow: readShadow(spPr, S),
    name: pic.at('p:nvPicPr/p:cNvPr')?.attr('name') ?? '', alt: pic.at('p:nvPicPr/p:cNvPr')?.attr('descr') ?? '',
  });
}

async function buildTable(tbl, box, env, out) {
  const { S } = env;
  const grid = tbl.at('a:tblGrid')?.all('a:gridCol').map((g) => g.num('w') * S.scale) ?? [];
  const layers = [S.deck.defaultTextStyle].filter(Boolean);
  const rows = [];
  for (const tr of tbl.all('a:tr')) {
    const cells = [];
    for (const tc of tr.all('a:tc')) {
      const tcPr = tc.get('a:tcPr');
      const txBody = tc.get('p:txBody') ?? tc.get('a:txBody');
      const borders = {};
      for (const k of ['L', 'R', 'T', 'B']) {
        const spec = await readLine(tcPr?.get(`a:ln${k}`), env);
        if (spec !== undefined) borders[k] = spec ? resolveLine(spec, null, S) : null;
      }
      cells.push({
        paras: txBody ? buildParas(txBody, env, layers) : [],
        fill: tcPr ? await readFill(tcPr, env) : undefined,
        borders,
        colSpan: tc.num('gridSpan', 1),
        rowSpan: tc.num('rowSpan', 1),
        skip: tc.bool('hMerge') || tc.bool('vMerge'),
        anchor: tcPr?.attr('anchor') ?? 't',
        ins: {
          l: (tcPr?.num('marL', 91440) ?? 91440) * S.scale, r: (tcPr?.num('marR', 91440) ?? 91440) * S.scale,
          t: (tcPr?.num('marT', 45720) ?? 45720) * S.scale, b: (tcPr?.num('marB', 45720) ?? 45720) * S.scale,
        },
      });
    }
    rows.push({ h: tr.num('h') * S.scale, cells });
  }
  const pr = tbl.get('a:tblPr');
  push(out, env, {
    type: 'table', ...box, cols: grid, rows,
    firstRow: pr?.bool('firstRow') ?? false, bandRow: pr?.bool('bandRow') ?? false,
    accent: `#${S.theme.colors.accent1 ?? '4472C4'}`,
  });
}

async function buildFrame(gf, env, out) {
  const { S } = env;
  const ph = phOf(gf);
  const chain = [gf];
  if (ph) {
    const l = findPh(S.layoutTree, ph);
    if (l) chain.push(l);
  }
  const xfrm = chain.map((s) => s.get('p:xfrm') ?? s.at('p:spPr/a:xfrm')).find((x) => x?.get('a:off') && x?.get('a:ext'));
  if (!xfrm) return;
  const box = place(xfrm, env.xf, S.scale);
  const gd = gf.at('a:graphic/a:graphicData');
  const tbl = gd?.get('a:tbl');
  const chart = gd?.get('c:chart');
  if (tbl) await buildTable(tbl, box, env, out);
  else if (chart) {
    const target = env.rels.get(chart.attr('r:id'))?.target;
    const xml = target ? await S.deck.xml(target) : null;
    push(out, env, { type: 'chart', ...box, chart: parseChart(xml, S.cc) });
  } else {
    S.warnings.push(`slide ${S.index + 1}: unsupported object (${gd?.attr('uri', 'graphicFrame')}) skipped`);
  }
}

async function walk(tree, env, out) {
  if (!tree) return;
  for (const c of tree.children) {
    switch (c.name) {
      case 'p:sp': case 'p:cxnSp': await buildSp(c, env, out); break;
      case 'p:pic': await buildPic(c, env, out); break;
      case 'p:graphicFrame': await buildFrame(c, env, out); break;
      case 'p:grpSp': {
        const gx = c.at('p:grpSpPr/a:xfrm');
        let xf = env.xf;
        const off = gx?.get('a:off'), ext = gx?.get('a:ext'), cho = gx?.get('a:chOff'), che = gx?.get('a:chExt');
        if (off && ext && cho && che) {
          const kx = che.num('cx') ? ext.num('cx') / che.num('cx') : 1;
          const ky = che.num('cy') ? ext.num('cy') / che.num('cy') : 1;
          xf = {
            sx: env.xf.sx * kx, sy: env.xf.sy * ky,
            tx: env.xf.tx + env.xf.sx * (off.num('x') - cho.num('x') * kx),
            ty: env.xf.ty + env.xf.sy * (off.num('y') - cho.num('y') * ky),
          };
        }
        await walk(c, { ...env, xf, group: env.group ?? `g${env.S.nextId()}` }, out);
        break;
      }
      case 'mc:AlternateContent': {
        const fb = c.get('mc:Fallback');
        await walk(fb?.children.length ? fb : c.get('mc:Choice'), env, out);
        break;
      }
      default: break;
    }
  }
}

async function readBackground(S, parts) {
  for (const part of parts) {
    const bg = part.xml?.at('p:cSld/p:bg');
    if (!bg) continue;
    const bgPr = bg.get('p:bgPr');
    if (bgPr) {
      const f = await readFill(bgPr, { S, rels: part.rels });
      if (f) return f;
    }
    const color = cssColorOf(bg.get('p:bgRef'), S.cc);
    if (color) return { type: 'solid', color };
  }
  return { type: 'solid', color: '#ffffff' };
}

/** -> { index, width, height, scale, bg, elements, notes, warnings } */
export async function extractSlide(deck, index, { width }) {
  const { slide, layout, master, theme, clrMap, notes } = await deck.slide(index);
  const scale = width / deck.size.cx;
  let id = 1;
  const S = {
    deck, scale, theme, index, warnings: [],
    cc: { theme: theme.colors, clrMap },
    layoutTree: layout.xml?.at('p:cSld/p:spTree'),
    masterTree: master.xml?.at('p:cSld/p:spTree'),
    masterXml: master.xml,
    nextId: () => id++,
  };
  const out = [];
  const showMaster = slide.xml?.attr('showMasterSp') !== '0';
  const layoutShowsMaster = layout.xml?.attr('showMasterSp') !== '0';
  if (showMaster && layoutShowsMaster) await walk(S.masterTree, { S, rels: master.rels, source: 'master', xf: IDENT }, out);
  if (showMaster) await walk(S.layoutTree, { S, rels: layout.rels, source: 'layout', xf: IDENT }, out);
  await walk(slide.xml?.at('p:cSld/p:spTree'), { S, rels: slide.rels, source: 'slide', xf: IDENT }, out);

  return {
    index, width, height: deck.size.cy * scale, scale, notes,
    bg: await readBackground(S, [slide, layout, master]),
    elements: out,
    warnings: S.warnings,
  };
}
