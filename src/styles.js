// Video styles: each one picks entrance animations per element kind, a slide-wide camera move and slide transitions.
//
//   title / body / text : { variant, words? }   entrance variant names are defined in animate.js (VARIANTS)
//   cycle               : variants rotated over cards / shapes (shapes on the same row share one)
//   picture             : entrance for pictures
//   camera              : none | push | pull | alternate | drift | focus   (+ cameraAmount, e.g. 0.06 = 6% zoom)
//   transitions         : slide-to-slide transitions, rotated per slide
//   pace / hold         : multipliers for stagger+gaps and for the time a finished slide stays on screen
//   pulse               : cards / shapes breathe once after they land
//   kenBurns            : slow push-in on pictures

export const STYLES = {
  classic: {
    label: 'Classic',
    desc: 'Balanced all-rounder: words rise, bullets slide in, cards cascade, slides alternate fade / slide / zoom.',
    title: { variant: 'up', words: true }, body: { variant: 'left' }, text: { variant: 'up' },
    cycle: ['up', 'pop', 'left', 'right', 'zoom'], picture: 'zoom',
    transitions: ['fade', 'slideLeft', 'zoomIn', 'slideUp'], camera: 'none', pace: 1, hold: 1, pulse: false, kenBurns: true,
  },
  cinematic: {
    label: 'Cinematic',
    desc: 'Slow, filmic: blur-to-sharp titles, gentle push-in camera on every slide, soft zoom transitions.',
    title: { variant: 'blur', words: true }, body: { variant: 'blur' }, text: { variant: 'blur' },
    cycle: ['zoom', 'fade'], picture: 'zoom',
    transitions: ['fade', 'zoomIn', 'blur'], camera: 'push', cameraAmount: 0.07, pace: 1.35, hold: 1.15, pulse: false, kenBurns: true,
  },
  dynamic: {
    label: 'Dynamic',
    desc: 'Fast and punchy: pops, bounces and spins, camera alternating push / pull, pulsing cards.',
    title: { variant: 'pop', words: true }, body: { variant: 'alt' }, text: { variant: 'pop' },
    cycle: ['pop', 'bounce', 'rotate', 'zoom', 'left', 'right'], picture: 'pop',
    transitions: ['slideLeft', 'zoomOut', 'wipe', 'rotate'], camera: 'alternate', cameraAmount: 0.05, pace: 0.75, hold: 0.9, pulse: true, kenBurns: true,
  },
  'zoom-in': {
    label: 'Zoom In',
    desc: 'Everything lands by zooming in from oversized; the camera pushes in across the slide.',
    title: { variant: 'zoom', words: true }, body: { variant: 'zoom' }, text: { variant: 'zoom' },
    cycle: ['zoom'], picture: 'zoom',
    transitions: ['zoomIn'], camera: 'push', cameraAmount: 0.08, pace: 1, hold: 1, pulse: false, kenBurns: true,
  },
  'zoom-out': {
    label: 'Zoom Out',
    desc: 'Elements grow in from tiny; the camera starts tight and pulls back to reveal the whole slide.',
    title: { variant: 'grow', words: true }, body: { variant: 'grow' }, text: { variant: 'grow' },
    cycle: ['grow'], picture: 'grow',
    transitions: ['zoomOut'], camera: 'pull', cameraAmount: 0.09, pace: 1, hold: 1, pulse: false, kenBurns: false,
  },
  spotlight: {
    label: 'Spotlight',
    desc: 'The camera flies in on each key element as it appears (titles, cards, pictures, charts), then pulls back out.',
    title: { variant: 'up', words: true }, body: { variant: 'up' }, text: { variant: 'up' },
    cycle: ['zoom', 'up'], picture: 'zoom',
    transitions: ['fade', 'zoomIn'], camera: 'focus', cameraAmount: 0.06, pace: 1.1, hold: 1.1, pulse: false, kenBurns: false,
  },
  slide: {
    label: 'Slide',
    desc: 'Directional motion: bullets alternate left / right, cards slide in, slides push sideways.',
    title: { variant: 'left', words: true }, body: { variant: 'alt' }, text: { variant: 'alt' },
    cycle: ['left', 'right'], picture: 'right',
    transitions: ['slideLeft', 'slideUp'], camera: 'none', pace: 0.9, hold: 1, pulse: false, kenBurns: true,
  },
  minimal: {
    label: 'Minimal',
    desc: 'Plain fades only. Calm and corporate, nothing moves that does not need to.',
    title: { variant: 'fade', words: false }, body: { variant: 'fade' }, text: { variant: 'fade' },
    cycle: ['fade'], picture: 'fade',
    transitions: ['fade'], camera: 'none', pace: 0.8, hold: 0.9, pulse: false, kenBurns: false,
  },
  typewriter: {
    label: 'Typewriter',
    desc: 'Text appears word by word in quick succession, like it is being typed; everything else fades.',
    title: { variant: 'fade', words: true, stagger: 0.13 }, body: { variant: 'fade', words: true, stagger: 0.07 }, text: { variant: 'fade', words: true, stagger: 0.07 },
    cycle: ['fade'], picture: 'fade',
    transitions: ['fade'], camera: 'none', pace: 1, hold: 1, pulse: false, kenBurns: false,
  },
  pop: {
    label: 'Pop',
    desc: 'Bouncy and playful: everything springs in with an overshoot and cards pulse once they land.',
    title: { variant: 'pop', words: true }, body: { variant: 'bounce' }, text: { variant: 'bounce' },
    cycle: ['pop', 'bounce'], picture: 'pop',
    transitions: ['zoomOut', 'rotate'], camera: 'none', pace: 0.8, hold: 0.9, pulse: true, kenBurns: false,
  },
  blur: {
    label: 'Focus Blur',
    desc: 'Elements pull into focus from a blur, with a faint camera push.',
    title: { variant: 'blur', words: true }, body: { variant: 'blur' }, text: { variant: 'blur' },
    cycle: ['blur'], picture: 'zoom',
    transitions: ['blur'], camera: 'push', cameraAmount: 0.04, pace: 1.1, hold: 1, pulse: false, kenBurns: true,
  },
  parallax: {
    label: 'Parallax',
    desc: 'Layers glide in from different sides while the camera drifts slowly across the slide.',
    title: { variant: 'left', words: true }, body: { variant: 'right' }, text: { variant: 'up' },
    cycle: ['left', 'right', 'up'], picture: 'zoom',
    transitions: ['slideLeft', 'fade'], camera: 'drift', cameraAmount: 0.07, pace: 1.1, hold: 1, pulse: false, kenBurns: false,
  },
  reveal: {
    label: 'Wipe Reveal',
    desc: 'Clean wipes: text and shapes are uncovered left to right, like a curtain pulling back.',
    title: { variant: 'wipe', words: false }, body: { variant: 'wipe' }, text: { variant: 'wipe' },
    cycle: ['wipe', 'wipeDown'], picture: 'wipe',
    transitions: ['wipe', 'fade'], camera: 'none', pace: 0.9, hold: 1, pulse: false, kenBurns: true,
  },
  swirl: {
    label: 'Swirl',
    desc: 'Elements spin and flip into place, camera sweeping in and out, spinning slide transitions.',
    title: { variant: 'rotate', words: true }, body: { variant: 'flip' }, text: { variant: 'rotate' },
    cycle: ['rotate', 'flip', 'zoom'], picture: 'rotate',
    transitions: ['rotate', 'zoomIn', 'zoomOut'], camera: 'alternate', cameraAmount: 0.06, pace: 0.9, hold: 1, pulse: false, kenBurns: false,
  },
};

/** `mix` cycles through these, one style per slide. */
export const MIX = ['cinematic', 'dynamic', 'spotlight', 'zoom-in', 'slide', 'blur', 'parallax', 'swirl', 'zoom-out', 'reveal'];

export const TRANSITION_NAMES = ['fade', 'slideLeft', 'slideUp', 'zoomIn', 'zoomOut', 'blur', 'wipe', 'rotate'];
export const CAMERA_MODES = ['none', 'push', 'pull', 'alternate', 'drift', 'focus'];

export function styleNames() {
  return [...Object.keys(STYLES), 'mix'];
}

/** Resolve a style for one slide, applying --camera / --transition overrides. */
export function resolveStyle(name = 'classic', slideIndex = 0, { camera, transition } = {}) {
  let key = name;
  if (key === 'mix') key = MIX[slideIndex % MIX.length];
  const base = STYLES[key];
  if (!base) throw new Error(`Unknown style "${name}". Available: ${styleNames().join(', ')}`);
  const s = { ...base, key };
  if (camera) {
    if (!CAMERA_MODES.includes(camera)) throw new Error(`Unknown camera "${camera}". Available: ${CAMERA_MODES.join(', ')}`);
    s.camera = camera;
    s.cameraAmount ??= 0.06;
  }
  if (transition) {
    if (transition === 'mix') s.transitions = TRANSITION_NAMES;
    else if (TRANSITION_NAMES.includes(transition)) s.transitions = [transition];
    else throw new Error(`Unknown transition "${transition}". Available: mix, ${TRANSITION_NAMES.join(', ')}`);
  }
  s.cameraAmount ??= 0.06;
  return s;
}
