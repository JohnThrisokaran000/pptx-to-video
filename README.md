# pptx-to-video

Turn a `.pptx` into an animated MP4. The deck is parsed (slide XML, layouts, masters, theme, images, tables, charts),
every element is classified and given an entrance animation that fits it, then the slides are rendered frame by frame in
headless Chrome/Edge and encoded with ffmpeg (bundled via `ffmpeg-static`).

```
npm install
node node_modules/ffmpeg-static/install.js     # only if npm skipped the ffmpeg download script
node bin/cli.js deck.pptx -o deck.mp4
```

## Step by step

1. **Requirements.** Node 22.5 or newer (24 recommended; Quoro uses the built-in `node:sqlite`) and Chrome or Edge installed.
   Nothing else: no accounts, no API keys, no network at run time.
2. **Install.** `git clone https://github.com/JohnThrisokaran000/pptx-to-video.git`, `cd pptx-to-video`, `npm install`.
   If `npm` skipped the ffmpeg download script, run `node node_modules/ffmpeg-static/install.js`.
3. **Run the tests.** `npm test` generates a sample deck and runs the whole Quoro suite (datasets, model, word checker,
   database, Q&A). All of it should pass.
4. **Build Quoro AI.** `npm run quoro:build` loads the datasets into SQLite, generates the training set, trains the role
   model and ingests the sample deck. It prints the accuracy numbers and writes `quoro/quoro.db` and `quoro/model.json`.
5. **Check a deck before you render it.** `node bin/quoro.js check deck.pptx` lists placeholders, TODOs, typos and
   leaked secrets with the slide they are on.
6. **Make the video.** `node bin/cli.js deck.pptx -o deck.mp4 --quoro` (add `-s cinematic -r 4k` etc.). `--quoro` lets the
   trained model decide what each element is and prints special-word warnings while it works.
7. **Ask Quoro things.** `node bin/quoro.js ingest deck.pptx`, then
   `node bin/quoro.js ask "what is on slide 3 of deck"` or `ask "which animation should a pie chart use"`.

## Video options


| Flag | What it does |
| --- | --- |
| `-s, --style <name>` | one of 14 styles, or `mix` (a different style on every slide) - see below; `--list-styles` describes them |
| `--camera <mode>` | override the style's camera: `none`, `push`, `pull`, `alternate`, `drift`, `focus` |
| `--transition <name>` | override slide transitions: `fade`, `slideLeft`, `slideUp`, `zoomIn`, `zoomOut`, `blur`, `wipe`, `rotate`, or `mix` |
| `-r, --resolution` | `720p`, `1080p` (default), `1440p`, `4k`; `-w <px>` for an exact width |
| `--fps`, `--crf` | frame rate (default 30), x264 quality (default 17, lower = better) |
| `--slide-duration <sec>`, `--max-anim <sec>`, `--speed <x>` | pacing |
| `--slides 1,3-5` | only these slides |
| `--narrate`, `--voice`, `--rate` | read speaker notes aloud (Windows speech engine, no API key) |
| `--audio bgm.mp3`, `--audio-volume 0.25` | looped background music with a fade-out |
| `--browser <path>`, `--snapshots <dir>` | Chrome/Edge to use; PNG of each finished slide |

Programmatic: `import { pptxToVideo } from './src/index.js'` with the same options (`style`, `camera`, `transition`, `width`, ...).

## Styles

Each style is a combination of entrance animations, a slide-wide camera move and slide transitions
(defined in `src/styles.js` - adding one is a few lines).

| Style | Look | Camera |
| --- | --- | --- |
| `classic` | words rise, bullets slide in, cards cascade | none |
| `cinematic` | blur-to-sharp, slow and filmic | push-in |
| `dynamic` | pops, bounces, spins, pulsing cards | alternating push / pull |
| `zoom-in` | everything zooms in from oversized | push-in |
| `zoom-out` | elements grow from tiny | starts tight, pulls back |
| `spotlight` | camera flies in on each key element as it appears, then back out | focus |
| `slide` | directional motion, bullets alternate sides | none |
| `minimal` | plain fades | none |
| `typewriter` | text appears word by word | none |
| `pop` | springy overshoot, pulsing cards | none |
| `blur` | pulls into focus from a blur | faint push-in |
| `parallax` | layers glide from different sides | slow drift |
| `reveal` | wipes, like a curtain pulling back | none |
| `swirl` | elements spin and flip in, spinning transitions | alternating |
| `mix` | cycles through the styles above, one per slide | varies |

Styles with a camera move re-render every frame (no frame reuse), so they take longer than static ones.
Rough cost: about 2-4 s of render time per second of 1080p video, more at 4K.

## What gets which animation (classic style)

| Element | Animation |
| --- | --- |
| Title / subtitle placeholder | words rise and fade in one by one |
| Body placeholder | paragraphs (with their bullets) slide in from the left, one after another |
| Other text boxes | paragraphs fade up |
| Shapes with text (cards, buttons) | up / pop / slide / zoom, cycled; shapes on the same row share a style so rows cascade |
| Plain shapes | pop (circles, stars...) or zoom; thin shapes and connectors are wiped in like a drawn line |
| Pictures | scale-in with fade, then a slow push-in for as long as they are on screen |
| Tables | rows drop in one by one |
| Charts | bars grow, lines draw, points and pie slices pop; axes and legend fade in first |
| Grouped shapes | animate together as one beat |
| Master/layout decoration | static |
| Slide change | alternating fade / slide / zoom, fading out at the end |

Timing is derived from content: build-in is sequenced in z-order (reading order), compressed to `--max-anim`
if there are many elements, then held for a time proportional to the amount of text. `--slide-duration` overrides it,
and narration lengthens a slide so the speech always fits.

## Known limits

- PowerPoint's own animation timeline (`p:timing`) and slide transitions are ignored; animations are chosen automatically.
- Charts: bar/column, line, area, pie/doughnut and scatter are redrawn natively; other chart types render a placeholder.
- Table styles are approximated (header row + banding); explicit cell fills and borders are honoured.
- SmartArt, WordArt effects, 3D, EMF/WMF images, embedded video/audio are skipped (a warning is printed for pictures/objects).
- Fonts come from the machine doing the rendering; missing fonts fall back to Calibri/Segoe UI/Arial.
- `--narrate` is Windows only (System.Speech).

## Quoro AI

Quoro is a small assistant that lives entirely on your machine: no network calls, no API keys, no downloaded weights.
It has three parts, all in `quoro/`.

**Datasets (hand-written, in `quoro/data/`)**

| File | Contents |
| --- | --- |
| `roles.json` | the 13 roles an element can have (title, body, label, rule, picture, backdrop, chart, ...) with rules for what each looks like |
| `elements.json` | 38 element kinds grouped like a design tool's element browser (text, shapes, lines, graphics, photos, frames, charts, tables, backgrounds, audio, video): what each is, when to use it, which entrance animation suits it |
| `special-words.json` | 100+ words and patterns to look for in a deck: placeholders, unfinished markers, typos, filler, jargon, confidential markers, secret-looking tokens, formatting slips |

These were written from scratch for this project. They were **not** taken from Canva or any plugin.

**Database (`quoro/quoro.db`, SQLite, rebuilt by `quoro build`)** holds the datasets, the generated training samples,
the model summary, and every ingested deck: slides, speaker notes, each element with its role, and the special-word findings.
It is git-ignored because it contains the text of the decks you ingest.

**Model (`quoro/model.json`)** is a decision tree that maps an element's features (shape or picture, placeholder type,
has text, visible box, line geometry, share of the slide, aspect ratio, word count) to one of the 13 roles. The training
set is generated from `roles.json`, including every categorical combination and the exact boundary values, and the tree
is grown until it makes no training error. `quoro build` also scores it on 4,500 independently generated samples and
with 5-fold cross-validation. The video exporter's `--quoro` flag uses this model instead of its built-in rules; on the
sample deck and on a real 10-slide, 242-element deck the two agree on every element.

**What "zero error" means here.** The model has zero error on its training data and on the held-out sets the tests use
(see `npm test`), and Q&A only answers from stored data, saying "I don't know" otherwise. It is not a promise about any deck you
throw at it: the roles are defined by `roles.json`, and an element that falls outside those definitions can be mislabelled.
If you find one, add a spec or an example to `roles.json`, run `npm run quoro:build`, and the tests will tell you
whether anything else moved.

### Quoro commands

| Command | What it does |
| --- | --- |
| `quoro build [decks...]` | create the database, train, evaluate, ingest (default: the sample deck) |
| `quoro ingest <decks...>` | add decks to the database |
| `quoro check <deck> [--min warn] [--json]` | special-word scan of slides, tables and notes; exit code 1 if any error-level finding |
| `quoro classify [deck]` | the role of every ingested element, and where the built-in rules disagree |
| `quoro ask <question>` | answer from the datasets and ingested decks |
| `quoro stats` | sizes and model scores |

Run them as `node bin/quoro.js <command>` or `npm run quoro -- <command>`.
