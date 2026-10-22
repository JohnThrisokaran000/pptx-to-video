// Preset + custom geometry -> SVG path data, in px of the shape's own box.

const f = (n) => +n.toFixed(2);

function roundRectPath(w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
}

const ellipsePath = (w, h) =>
  `M0 ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 ${f(w)} ${f(h / 2)}A${f(w / 2)} ${f(h / 2)} 0 1 0 0 ${f(h / 2)}Z`;

const poly = (pts) => `M${pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z`;

function starPath(w, h, n, ratio) {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    const k = i % 2 ? ratio : 1;
    pts.push([w / 2 + (w / 2) * k * Math.cos(a), h / 2 + (h / 2) * k * Math.sin(a)]);
  }
  return poly(pts);
}

const STARS = { star4: [4, 0.25], star5: [5, 0.382], star6: [6, 0.577], star7: [7, 0.69], star8: [8, 0.75], star10: [10, 0.85], star12: [12, 0.85], star16: [16, 0.9], star24: [24, 0.9], star32: [32, 0.9] };

function heartPath(w, h) {
  const p = (x, y) => `${f(x * w)} ${f(y * h)}`;
  return `M${p(0.5, 0.3)}C${p(0.5, 0.2)} ${p(0.4, 0.05)} ${p(0.25, 0.05)}C${p(0.1, 0.05)} ${p(0, 0.2)} ${p(0, 0.35)}C${p(0, 0.6)} ${p(0.5, 0.85)} ${p(0.5, 1)}C${p(0.5, 0.85)} ${p(1, 0.6)} ${p(1, 0.35)}C${p(1, 0.2)} ${p(0.9, 0.05)} ${p(0.75, 0.05)}C${p(0.6, 0.05)} ${p(0.5, 0.2)} ${p(0.5, 0.3)}Z`;
}

/** Straight / elbow connector as a single open path. */
function connectorPath(prst, w, h) {
  if (prst.startsWith('bentConnector')) return `M0 0H${f(w / 2)}V${f(h)}H${f(w)}`;
  return `M0 0L${f(w)} ${f(h)}`;
}

export const isLine = (geom) => !!geom?.prst && (geom.prst === 'line' || geom.prst.endsWith('Connector1') || /^(bent|curved)Connector/.test(geom.prst));

function presetPath(prst, w, h, adj) {
  const ss = Math.min(w, h);
  const a = (name, d) => (adj[name] ?? d) / 100000;
  switch (prst) {
    case 'ellipse': case 'flowChartConnector': case 'flowChartOr': case 'flowChartSummingJunction': case 'wedgeEllipseCallout':
      return ellipsePath(w, h);
    case 'roundRect': case 'wedgeRoundRectCallout': return roundRectPath(w, h, ss * a('adj', 16667));
    case 'round1Rect': case 'round2SameRect': case 'round2DiagRect': case 'snipRoundRect':
      return roundRectPath(w, h, ss * 0.16);
    case 'flowChartTerminator': return roundRectPath(w, h, ss / 2);
    case 'triangle': case 'flowChartMerge': case 'flowChartExtract':
      return poly([[prst === 'triangle' ? w * a('adj', 50000) : w / 2, 0], [w, h], [0, h]]);
    case 'rtTriangle': return poly([[0, 0], [0, h], [w, h]]);
    case 'diamond': case 'flowChartDecision': return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram': case 'flowChartInputOutput': {
      const o = Math.min(ss * a('adj', 25000), w);
      return poly([[o, 0], [w, 0], [w - o, h], [0, h]]);
    }
    case 'trapezoid': {
      const o = ss * a('adj', 25000);
      return poly([[0, h], [o, 0], [w - o, 0], [w, h]]);
    }
    case 'hexagon': case 'flowChartPreparation': {
      const o = ss * a('adj', 25000);
      return poly([[0, h / 2], [o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h]]);
    }
    case 'octagon': {
      const o = ss * a('adj', 29289);
      return poly([[o, 0], [w - o, 0], [w, o], [w, h - o], [w - o, h], [o, h], [0, h - o], [0, o]]);
    }
    case 'pentagon': {
      const pts = [];
      for (let i = 0; i < 5; i++) {
        const t = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        pts.push([w / 2 + (w / 2) * Math.cos(t), h / 2 + (h / 2) * Math.sin(t)]);
      }
      return poly(pts);
    }
    case 'homePlate': {
      const o = ss * a('adj', 50000);
      return poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h]]);
    }
    case 'chevron': {
      const o = ss * a('adj', 50000);
      return poly([[0, 0], [w - o, 0], [w, h / 2], [w - o, h], [0, h], [o, h / 2]]);
    }
    case 'plus': {
      const o = ss * a('adj', 25000);
      return poly([[o, 0], [w - o, 0], [w - o, o], [w, o], [w, h - o], [w - o, h - o], [w - o, h], [o, h], [o, h - o], [0, h - o], [0, o], [o, o]]);
    }
    case 'rightArrow': case 'leftRightArrow': {
      const sh = h * a('adj1', 50000), hl = Math.min(ss * a('adj2', 50000), w), y1 = (h - sh) / 2;
      return poly([[0, y1], [w - hl, y1], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, y1 + sh], [0, y1 + sh]]);
    }
    case 'leftArrow': {
      const sh = h * a('adj1', 50000), hl = Math.min(ss * a('adj2', 50000), w), y1 = (h - sh) / 2;
      return poly([[w, y1], [hl, y1], [hl, 0], [0, h / 2], [hl, h], [hl, y1 + sh], [w, y1 + sh]]);
    }
    case 'upArrow': {
      const sw = w * a('adj1', 50000), hl = Math.min(ss * a('adj2', 50000), h), x1 = (w - sw) / 2;
      return poly([[x1, h], [x1, hl], [0, hl], [w / 2, 0], [w, hl], [x1 + sw, hl], [x1 + sw, h]]);
    }
    case 'downArrow': {
      const sw = w * a('adj1', 50000), hl = Math.min(ss * a('adj2', 50000), h), x1 = (w - sw) / 2;
      return poly([[x1, 0], [x1, h - hl], [0, h - hl], [w / 2, h], [w, h - hl], [x1 + sw, h - hl], [x1 + sw, 0]]);
    }
    case 'donut': {
      const t = ss * a('adj', 25000);
      const rx = w / 2 - t, ry = h / 2 - t;
      const inner = `M${f(t)} ${f(h / 2)}A${f(rx)} ${f(ry)} 0 1 0 ${f(w - t)} ${f(h / 2)}A${f(rx)} ${f(ry)} 0 1 0 ${f(t)} ${f(h / 2)}Z`;
      return ellipsePath(w, h) + inner;
    }
    case 'heart': return heartPath(w, h);
    default:
      if (STARS[prst]) return starPath(w, h, ...STARS[prst]);
      if (isLine({ prst })) return connectorPath(prst, w, h);
      return `M0 0H${f(w)}V${f(h)}H0Z`;
  }
}

function arcPoint(cx, cy, wR, hR, ang) {
  const t = Math.atan2(wR * Math.sin(ang), hR * Math.cos(ang));
  return [cx + wR * Math.cos(t), cy + hR * Math.sin(t)];
}

function custPath(p, w, h) {
  const sx = w / (p.w || w), sy = h / (p.h || h);
  const X = (v) => f(v * sx), Y = (v) => f(v * sy);
  let d = '';
  let cur = [0, 0];
  for (const c of p.cmds) {
    switch (c.t) {
      case 'M': d += `M${X(c.pts[0][0])} ${Y(c.pts[0][1])}`; cur = c.pts[0]; break;
      case 'L': d += `L${X(c.pts[0][0])} ${Y(c.pts[0][1])}`; cur = c.pts[0]; break;
      case 'C': d += `C${c.pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join(' ')}`; cur = c.pts[2]; break;
      case 'Q': d += `Q${c.pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join(' ')}`; cur = c.pts[1]; break;
      case 'Z': d += 'Z'; break;
      case 'A': {
        const st = (c.stAng / 60000) * (Math.PI / 180), sw = (c.swAng / 60000) * (Math.PI / 180);
        const t0 = Math.atan2(c.wR * Math.sin(st), c.hR * Math.cos(st));
        const cx = cur[0] - c.wR * Math.cos(t0), cy = cur[1] - c.hR * Math.sin(t0);
        const [ex, ey] = arcPoint(cx, cy, c.wR, c.hR, st + sw);
        d += `A${f(c.wR * sx)} ${f(c.hR * sy)} 0 ${Math.abs(sw) > Math.PI ? 1 : 0} ${sw > 0 ? 1 : 0} ${X(ex)} ${Y(ey)}`;
        cur = [ex, ey];
        break;
      }
      default: break;
    }
  }
  return d;
}

/** -> [{ d, fill: bool, stroke: bool }] */
export function geometryPaths(geom, w, h) {
  if (geom?.cust) return geom.cust.map((p) => ({ d: custPath(p, w, h), fill: p.fill !== 'none', stroke: p.stroke !== false }));
  const prst = geom?.prst ?? 'rect';
  const line = isLine(geom);
  return [{ d: presetPath(prst, w, h, geom?.adj ?? {}), fill: !line, stroke: true }];
}
