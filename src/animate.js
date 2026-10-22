import { countWords } from './html.js';
import { resolveStyle } from './styles.js';

// Decides, for every element on a slide, which entrance animation fits it and when it plays, driven by a style
// (see styles.js). Output is a flat list of effects the browser runtime turns into Web Animations:
//   { sel, kf, delay, dur, ease, stagger, fill }   (seconds; `sel` may match many nodes -> stagger per node)

const EASE = {
  out: 'cubic-bezier(.22,.8,.3,1)',
  back: 'cubic-bezier(.34,1.45,.64,1)',
  inOut: 'cubic-bezier(.45,0,.2,1)',
  lin: 'linear',
};

const T0 = 0.45; // slide transition runs first
const ENTER = 0.5;
const EXIT = 0.35;
const WIPE_FROM = 'inset(-24px 100% -24px -24px)';
const WIPE_FROM_DOWN = 'inset(-24px -24px 100% -24px)';
const WIPE_TO = 'inset(-24px -24px -24px -24px)';

/** Entrance keyframes; `u` scales travel distances (px per 1280-wide unit). */
const variants = (u) => ({
  fade: [{ opacity: 0 }, { opacity: 1 }],
  up: [{ opacity: 0, transform: `translateY(${46 * u}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
  down: [{ opacity: 0, transform: `translateY(${-46 * u}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
  left: [{ opacity: 0, transform: `translateX(${-80 * u}px)` }, { opacity: 1, transform: 'translateX(0px)' }],
  right: [{ opacity: 0, transform: `translateX(${80 * u}px)` }, { opacity: 1, transform: 'translateX(0px)' }],
  pop: [{ opacity: 0, transform: 'scale(.55)' }, { opacity: 1, transform: 'scale(1)' }],
  grow: [{ opacity: 0, transform: 'scale(.15)' }, { opacity: 1, transform: 'scale(1)' }],
  zoom: [{ opacity: 0, transform: 'scale(1.35)' }, { opacity: 1, transform: 'scale(1)' }],
  blur: [{ opacity: 0, filter: 'blur(18px)', transform: 'scale(1.06)' }, { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }],
  rotate: [{ opacity: 0, transform: 'rotate(-12deg) scale(.7)' }, { opacity: 1, transform: 'rotate(0deg) scale(1)' }],
  bounce: [{ opacity: 0, transform: `translateY(${-110 * u}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
  flip: [{ opacity: 0, transform: 'perspective(900px) rotateX(75deg) translateY(30px)' }, { opacity: 1, transform: 'perspective(900px) rotateX(0deg) translateY(0px)' }],
  wipe: [{ opacity: 1, clipPath: WIPE_FROM }, { opacity: 1, clipPath: WIPE_TO }],
  wipeDown: [{ opacity: 1, clipPath: WIPE_FROM_DOWN }, { opacity: 1, clipPath: WIPE_TO }],
});
const VEASE = { pop: EASE.back, grow: EASE.back, bounce: EASE.back, rotate: EASE.back, flip: EASE.out, wipe: EASE.inOut, wipeDown: EASE.inOut };
const ALT = ['left', 'right'];

/** Slide-level transitions: how a slide comes in and goes out. */
const transitions = (u) => ({
  fade: { in: [{ opacity: 0 }, { opacity: 1 }], out: [{ opacity: 1 }, { opacity: 0 }] },
  slideLeft: {
    in: [{ opacity: 0, transform: `translateX(${90 * u}px)` }, { opacity: 1, transform: 'translateX(0px)' }],
    out: [{ opacity: 1, transform: 'translateX(0px)' }, { opacity: 0, transform: `translateX(${-90 * u}px)` }],
  },
  slideUp: {
    in: [{ opacity: 0, transform: `translateY(${60 * u}px)` }, { opacity: 1, transform: 'translateY(0px)' }],
    out: [{ opacity: 1, transform: 'translateY(0px)' }, { opacity: 0, transform: `translateY(${-60 * u}px)` }],
  },
  zoomIn: {
    in: [{ opacity: 0, transform: 'scale(1.12)' }, { opacity: 1, transform: 'scale(1)' }],
    out: [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.1)' }],
  },
  zoomOut: {
    in: [{ opacity: 0, transform: 'scale(.88)' }, { opacity: 1, transform: 'scale(1)' }],
    out: [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)' }],
  },
  blur: {
    in: [{ opacity: 0, filter: 'blur(26px)' }, { opacity: 1, filter: 'blur(0px)' }],
    out: [{ opacity: 1, filter: 'blur(0px)' }, { opacity: 0, filter: 'blur(26px)' }],
  },
  wipe: {
    in: [{ opacity: 1, clipPath: 'inset(0 100% 0 0)' }, { opacity: 1, clipPath: 'inset(0 0 0 0)' }],
    out: [{ opacity: 1 }, { opacity: 0 }],
  },
  rotate: {
    in: [{ opacity: 0, transform: 'rotate(-4deg) scale(1.15)' }, { opacity: 1, transform: 'rotate(0deg) scale(1)' }],
    out: [{ opacity: 1, transform: 'rotate(0deg) scale(1)' }, { opacity: 0, transform: 'rotate(4deg) scale(.88)' }],
  },
});

const FOOTERS = new Set(['dt', 'ftr', 'sldNum']);
const POP_GEOMS = /^(ellipse|donut|heart|star\d+|flowChartConnector|pentagon|hexagon|octagon)$/;
const FOCUSABLE = new Set(['title', 'label', 'picture', 'chart', 'table', 'shape']);

export function roleOf(el, m) {
  const area = (el.w * el.h) / (m.width * m.height);
  if (el.type === 'pic') return area > 0.85 ? 'backdrop' : 'picture';
  if (el.type === 'table') return 'table';
  if (el.type === 'chart') return 'chart';
  if (el.geom?.prst && (el.geom.prst === 'line' || /Connector/.test(el.geom.prst))) return 'rule';
  const visible = el.fill.type !== 'none' || !!el.line;
  if (el.text) {
    if (el.ph === 'title' || el.ph === 'ctrTitle') return 'title';
    if (el.ph === 'subTitle') return 'subtitle';
    if (FOOTERS.has(el.ph)) return 'footer';
    if (visible) return area > 0.6 ? 'backdropLabel' : 'label';
    return el.ph ? 'body' : 'text';
  }
  if (area > 0.6) return 'backdrop';
  const aspect = el.w / Math.max(el.h, 1);
  if (aspect > 8 || aspect < 1 / 8) return 'rule';
  return 'shape';
}

const sel = (e, rest = '') => `[data-eid="${e.id}"]${rest ? ` ${rest}` : ''}`;
const wordsIn = (p) => countWords([p]);

/** Camera move for the whole slide as one animation on #cam (transform-origin 0 0, so translate+scale pairs). */
function cameraEffect(m, style, beats, D) {
  const W = m.width, H = m.height;
  const T = (s, cx, cy) => {
    const tx = Math.min(0, Math.max(W - W * s, W / 2 - cx * s));
    const ty = Math.min(0, Math.max(H - H * s, H / 2 - cy * s));
    return `translate(${tx.toFixed(1)}px,${ty.toFixed(1)}px) scale(${s.toFixed(4)})`;
  };
  const amt = style.cameraAmount;
  const fx = (kf, ease = EASE.lin) => ({ sel: '#cam', kf, delay: 0, dur: D, ease, stagger: 0, fill: 'both' });
  const mid = [W / 2, H / 2];
  let mode = style.camera;
  if (mode === 'alternate') mode = m.index % 2 === 0 ? 'push' : 'pull';
  if (mode === 'push') return fx([{ transform: T(1, ...mid) }, { transform: T(1 + amt, ...mid) }]);
  if (mode === 'pull') return fx([{ transform: T(1 + amt, ...mid) }, { transform: T(1, ...mid) }]);
  if (mode === 'drift') {
    const s = 1 + amt;
    return fx([{ transform: T(s, W * 0.38, H * 0.45) }, { transform: T(s, W * 0.62, H * 0.55) }]);
  }
  if (mode === 'focus') {
    const kf = [{ offset: 0, transform: T(1, ...mid), easing: EASE.inOut }];
    let lastEnd = 0.6, picked = 0;
    for (const b of beats) {
      if (!FOCUSABLE.has(b.role) || picked >= 4) continue;
      const e = b.e;
      const s = Math.min(1.4, Math.min((W * 0.8) / Math.max(e.w, 1), (H * 0.8) / Math.max(e.h, 1)));
      if (s < 1.12 || b.t < lastEnd || b.t + 2.3 > D - 0.5) continue;
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      kf.push({ offset: b.t / D, transform: T(1, ...mid), easing: EASE.inOut });
      kf.push({ offset: (b.t + 0.9) / D, transform: T(s, cx, cy), easing: EASE.inOut });
      kf.push({ offset: (b.t + 2.2) / D, transform: T(1, ...mid), easing: EASE.inOut });
      lastEnd = b.t + 2.8;
      picked++;
    }
    if (!picked) return fx([{ transform: T(1, ...mid) }, { transform: T(1 + amt, ...mid) }]);
    kf.push({ offset: 1, transform: T(1, ...mid) });
    return fx(kf, EASE.inOut);
  }
  return null;
}

export function planSlide(m, opts = {}) {
  const { maxAnim = 7, minDuration = 3.5, slideDuration = null, narrationDur = 0, speed = 1, style: styleName = 'classic', camera, transition, roleOf: roleFn = roleOf } = opts;
  const style = resolveStyle(styleName, m.index, { camera, transition });
  const u = m.width / 1280;
  const V = variants(u), VP = variants(u * 0.6), VW = variants(u * 0.5);
  const els = m.elements.filter((e) => !e.decor);
  const roles = new Map(els.map((e) => [e, roleFn(e, m)]));

  const modeOf = (e, role) => {
    if (e.type !== 'shape' || !e.text) return null;
    if (role === 'title') return style.title;
    if (role === 'subtitle') return { variant: style.text.variant === 'alt' ? 'up' : style.text.variant, words: style.title.words, stagger: (style.title.stagger ?? 0.08) * 0.65 };
    if (role === 'body') return style.body;
    if (role === 'text') return style.text;
    return null;
  };
  for (const e of els) e.split = modeOf(e, roles.get(e))?.words ? 'words' : null;

  // beats: one per element, group members animate together
  const beatList = [];
  const seen = new Map();
  for (const e of els) {
    const r = roles.get(e);
    if (r === 'backdrop' || r === 'footer') continue;
    if (e.group && seen.has(e.group)) { seen.get(e.group).push(e); continue; }
    const b = [e];
    if (e.group) seen.set(e.group, b);
    beatList.push(b);
  }

  const totalWords = els.reduce((n, e) => {
    if (e.text) return n + countWords(e.text.paras);
    if (e.type === 'table') return n + e.rows.reduce((a, r) => a + r.cells.reduce((b, c) => b + countWords(c.paras), 0), 0);
    if (e.type === 'chart') return n + 6;
    return n;
  }, 0);

  const build = (f) => {
    const fx = [];
    const beats = [];
    let end = 0;
    const add = (selector, kf, o) => {
      const e = { sel: selector, kf, delay: o.delay, dur: o.dur, ease: o.ease ?? EASE.out, stagger: o.stagger ?? 0, fill: o.fill ?? 'both' };
      fx.push(e);
      const done = e.delay + e.dur + e.stagger * ((o.n ?? 1) - 1);
      end = Math.max(end, done);
      return done;
    };
    const fade = V.fade;
    const enter = (selector, variant, table, o) => add(selector, table[variant], { ease: VEASE[variant] ?? EASE.out, ...o });

    const CYCLE = style.cycle;
    let cycle = 0, lastVariant = CYCLE[0], lastRowY = -1e9;
    const variantFor = (e, prefer) => {
      const row = e.y + e.h / 2;
      if (lastRowY > -1e8 && Math.abs(row - lastRowY) < e.h * 0.4) return lastVariant;
      lastRowY = row;
      lastVariant = prefer ?? CYCLE[cycle++ % CYCLE.length];
      return lastVariant;
    };
    const pulse = (e, from) => {
      if (style.pulse) add(sel(e), [{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], { delay: from + 0.05, dur: 0.55, ease: EASE.inOut, fill: 'none' });
    };

    // backdrops + footers: ambient, not part of the narrative
    for (const e of els) {
      const r = roles.get(e);
      if (r === 'backdrop') add(sel(e), fade, { delay: 0.1, dur: 0.8 });
      if (r === 'footer') add(sel(e), fade, { delay: 0.9, dur: 0.6 });
    }

    const emit = (e, t) => {
      const r = roles.get(e);
      switch (r) {
        case 'title': case 'subtitle': case 'body': case 'text': {
          const mode = modeOf(e, r);
          const variant = mode.variant;
          const boxed = e.fill.type !== 'none' || !!e.line;
          if (boxed && mode.words) add(sel(e, '> .geo'), fade, { delay: t, dur: 0.45 });
          if (mode.words) {
            const n = Math.max(1, countWords(e.text.paras));
            const st = (mode.stagger ?? (r === 'title' ? 0.08 : 0.05)) * f;
            const big = r === 'title' ? 1 : 0.7;
            const done = enter(sel(e, '.w'), variant, big === 1 ? VW : variants(u * 0.35), { delay: t + (r === 'subtitle' ? 0.1 : 0), dur: r === 'title' ? 0.6 : 0.45, stagger: st, n });
            return { adv: (done - t) * (r === 'title' || r === 'subtitle' ? 0.7 : 0.9) + 0.1 };
          }
          if (r === 'title' || r === 'subtitle') {
            const done = enter(sel(e), variant === 'alt' ? 'left' : variant, V, { delay: t, dur: 0.75 });
            return { adv: (done - t) * 0.7 + 0.1 };
          }
          const dense = e.text.paras.length > 8;
          let cursor = t, k2 = 0;
          e.text.paras.forEach((p, k) => {
            const w = wordsIn(p);
            const v = variant === 'alt' ? ALT[k2 % 2] : variant;
            enter(sel(e, `.tin > .para:nth-child(${k + 1})`), v, VP, { delay: cursor, dur: 0.55 });
            if (w) { cursor += Math.min(1.0, 0.3 + w * 0.045) * f * (dense ? 0.6 : 1); k2++; }
          });
          return { adv: (cursor - t) * 0.85 + 0.15 };
        }
        case 'label': case 'backdropLabel': {
          if (r === 'backdropLabel') { add(sel(e), fade, { delay: t, dur: 0.7 }); return { adv: 0.3 }; }
          const v = variantFor(e);
          const done = enter(sel(e), v, V, { delay: t, dur: v === 'pop' || v === 'grow' ? 0.6 : 0.65 });
          pulse(e, done);
          return { adv: 0.32 };
        }
        case 'shape': {
          const pop = POP_GEOMS.test(e.geom?.prst ?? '');
          const v = pop ? (CYCLE.includes('grow') ? 'grow' : CYCLE.includes('pop') ? 'pop' : variantFor(e)) : variantFor(e, CYCLE[0] === 'fade' ? 'fade' : 'zoom');
          if (pop) { lastVariant = v; lastRowY = e.y + e.h / 2; }
          const done = enter(sel(e), v, V, { delay: t, dur: 0.55 });
          pulse(e, done);
          return { adv: 0.28 };
        }
        case 'rule': {
          const vertical = e.h > e.w * 1.5;
          add(sel(e), vertical ? V.wipeDown : V.wipe, { delay: t, dur: 0.6, ease: EASE.inOut });
          return { adv: 0.25 };
        }
        case 'picture': {
          const pv = style.picture === 'blur' ? 'zoom' : style.picture; // blur would replace the picture's drop shadow
          enter(sel(e), pv, V, { delay: t, dur: 0.9 });
          e.kbStart = t;
          return { adv: 0.55 };
        }
        case 'table': {
          const n = e.rows.length;
          const rowV = ['wipe', 'wipeDown'].includes(style.body.variant) ? 'wipe' : ['fade'].includes(style.body.variant) ? 'fade' : 'up';
          const done = enter(sel(e, 'tr.trow'), rowV, VP, { delay: t + 0.1, dur: 0.5, stagger: 0.2 * f, n });
          return { adv: (done - t) * 0.6 + 0.2 };
        }
        case 'chart': {
          const c = e.chart;
          const done0 = add(sel(e, '.cfade'), fade, { delay: t, dur: 0.5 });
          const nb = c.series.reduce((a, s) => a + s.vals.length, 0);
          let done = done0;
          const grow = c.horizontal ? 'scaleX' : 'scaleY';
          done = Math.max(done, add(sel(e, '.cbar'), [{ transform: `${grow}(0)` }, { transform: `${grow}(1)` }], { delay: t + 0.3, dur: 0.7, stagger: Math.min(0.1, 1.2 / Math.max(nb, 1)) * f, n: nb }));
          done = Math.max(done, add(sel(e, '.cline'), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { delay: t + 0.3, dur: 1.4, ease: EASE.inOut }));
          done = Math.max(done, add(sel(e, '.carea'), fade, { delay: t + 0.3, dur: 1.0 }));
          done = Math.max(done, add(sel(e, '.cpt'), [{ opacity: 0, transform: 'scale(0)' }, { opacity: 1, transform: 'scale(1)' }], { delay: t + 0.6, dur: 0.4, stagger: 0.08 * f, n: nb, ease: EASE.back }));
          const ns = c.series[0]?.vals.length ?? 1;
          done = Math.max(done, add(sel(e, '.cslice'), [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1)' }], { delay: t + 0.2, dur: 0.6, stagger: 0.18 * f, n: ns, ease: EASE.back }));
          return { adv: (done - t) * 0.55 + 0.2 };
        }
        default: return { adv: 0.2 };
      }
    };

    let t = T0 + 0.1;
    for (const beat of beatList) {
      let adv = 0;
      beat.forEach((e, k) => {
        const at = t + k * 0.08 * f;
        if (k === 0) beats.push({ t: at, e, role: roles.get(e) });
        adv = Math.max(adv, emit(e, at).adv);
      });
      t += Math.max(0.12, adv * f);
    }
    return { fx, end, beats };
  };

  const base = slideDuration ? Math.max(1.5, slideDuration - 1.0) : maxAnim;
  let result;
  for (const f of [1, 0.8, 0.65, 0.5, 0.4, 0.3, 0.22]) {
    result = build((f * style.pace) / speed);
    if (result.end <= base) break;
  }
  const { fx, end, beats } = result;

  const hold = (Math.min(5, Math.max(1.4, 0.9 + totalWords / 8)) * style.hold) / speed;
  let duration = slideDuration ?? Math.max(minDuration, end + hold);
  if (narrationDur) duration = Math.max(duration, narrationDur + 0.8);
  duration = Math.max(duration, end + 0.4);

  // slide-level transition in / out
  const tr = transitions(u)[style.transitions[m.index % style.transitions.length]];
  fx.unshift({ sel: '#slide', kf: tr.in, delay: 0, dur: ENTER, ease: EASE.out, stagger: 0, fill: 'both' });
  fx.push({ sel: '#slide', kf: tr.out, delay: duration - EXIT, dur: EXIT, ease: EASE.lin, stagger: 0, fill: 'forwards' });

  // camera: slide-wide zoom / drift / fly-to-element
  const cam = cameraEffect(m, style, beats, duration);
  if (cam) fx.push(cam);

  // slow push-in on pictures for the whole time they are on screen
  if (style.kenBurns) {
    let kbIndex = 0;
    for (const e of els) {
      const r = roles.get(e);
      if (r !== 'picture' && !(r === 'backdrop' && e.type === 'pic')) continue;
      const start = r === 'picture' ? (e.kbStart ?? 0.5) : 0;
      const inward = kbIndex++ % 2 === 0;
      fx.push({
        sel: sel(e, '.kb'),
        kf: inward ? [{ transform: 'scale(1)' }, { transform: 'scale(1.07)' }] : [{ transform: 'scale(1.07)' }, { transform: 'scale(1)' }],
        delay: start, dur: duration - start, ease: EASE.lin, stagger: 0, fill: 'both',
      });
    }
  }

  return { fx, duration, animEnd: end, words: totalWords, style: style.key };
}
