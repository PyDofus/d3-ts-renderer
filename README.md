# d3-ts-renderer

A TypeScript/WebGL renderer for [Dofus](https://www.dofus.com) game sprites.

This library is a TypeScript rewrite of the Python renderer that powers
[skin.souff.fr](https://skin.souff.fr), bringing native browser rendering (no
server-side image generation) and a reusable API for embedding Dofus sprites in
web apps. It also runs headless under Node for batch image/animation export.

## Installation

```bash
npm install d3-ts-renderer
```

## Getting started

The renderer needs to know where to fetch sprite assets (bone bundles, skins,
body/slot data, audio banks). Call `configure()` once at startup before
creating any sprite.

### Browser

```ts
import { configure, Look, DofusSprite } from 'd3-ts-renderer';

configure({
    strategy: 'url',
    basePath: 'https://your-cdn.example.com/assets/',
});

const canvas = document.querySelector('canvas')!;
const look = Look.fromString('{1|120,2195,3042,3069,3963|1=16777215,...|56}');
const sprite = await DofusSprite.create(look, canvas);

await sprite.prepareAnimation('AnimStatique', 2, true);
sprite.renderFrame(0);
```

### Node — headless rendering

For headless Node rendering, install [`gl`](https://www.npmjs.com/package/gl) and
[`sharp`](https://www.npmjs.com/package/sharp) alongside this package — they
are declared as optional peer dependencies, so browser consumers won't pull
them in:

```bash
npm install d3-ts-renderer gl sharp
```

The `d3-ts-renderer/node` subpath bundles ready-made helpers for the three
pieces Node needs: a headless WebGL1 context, a canvas shim, and a `sharp`-
based image decoder. It also re-exports everything from the main entry, plus
`saveAnimation` for ffmpeg-driven video/image export.

```ts
import { configure, Look, DofusSprite } from 'd3-ts-renderer';
import { decodeImage, createCanvas, saveToPng, saveAnimation } from 'd3-ts-renderer/node';

configure({
    strategy: 'fs',
    basePath: '/var/dofus-assets/',
    decodeImage,
});

const canvas = createCanvas();
const sprite = await DofusSprite.create(
    Look.fromString('{1|120,2195,3042,3069,3963|1=16777215,2=15335424,3=15335424,4=16777215,5=0,6=15335424|56}'),
    canvas,
    { numberFrame: 1 },
);
await sprite.prepareAnimation('AnimStatiqueExplo0_1', 2, true);
sprite.renderFrame(0);
await saveToPng(canvas, 'test.png');
```

If you need different encoding or a different GL/decoder stack, skip the
subpath and wire up your own `decodeImage` callback plus a duck-typed canvas —
`RendererContext` only uses `canvas.getContext(...)` and
`gl.canvas.{width,height}`.

## Animation playback (browser)

`SpritePlayback` drives a sprite on a `requestAnimationFrame` loop locked to
the animation's native frame rate, and (optionally) schedules its sound events
through Web Audio.

```ts
import { SpritePlayback } from 'd3-ts-renderer';

const playback = new SpritePlayback();
await playback.play(sprite, 'AnimMarche_2', {
    scale: 2,
    audio: true,
    onFrame: i => console.log('rendered frame', i),
});

// later
playback.pause();
playback.resume();
playback.stop();
```

`play()` returns the frame count. Audio loops in step with the animation:
sound events whose frame interval divides the current frame index are
re-triggered.

## Exporting frames and animations

### Browser

| function                       | output                   | notes                                                                                                              |
|--------------------------------|--------------------------|--------------------------------------------------------------------------------------------------------------------|
| `saveToPng(canvas, filename?)` | PNG `Blob`               | snapshots the current canvas                                                                                       |
| `saveToWebp(sprite, opts)`     | animated WebP `Blob`     | encodes each frame in parallel via `OffscreenCanvas`, muxes a RIFF/WEBP container                                  |
| `saveToWebm(sprite, opts)`     | WebM `Blob` (with audio) | uses WebCodecs + [`mediabunny`](https://www.npmjs.com/package/mediabunny) when available, falls back to `MediaRecorder` |

Passing a `filename` triggers a browser download in addition to returning the
blob. `saveToWebm` mixes the sprite's sound events into the recording by
default; pass `audio: false` to disable, or `audioPlayer` to share a decoded-
buffer cache with an existing `SpritePlayback`.

```ts
import { saveToWebp, saveToWebm } from 'd3-ts-renderer';

await saveToWebp(sprite, { animName: 'AnimMarche_2', scale: 2, filename: 'walk.webp' });
await saveToWebm(sprite, { animName: 'AnimMarche_2', scale: 2, filename: 'walk.webm' });
```

### Node — `saveAnimation`

Pipes raw RGBA frames (and decoded sound events on extra fds) into `ffmpeg`.
Requires `ffmpeg` on the host PATH.

```ts
import { saveAnimation } from 'd3-ts-renderer/node';

await saveAnimation(sprite, {
    animName: 'AnimMarche_2',
    extension: 'mp4',          // 'webm' | 'mp4' | 'webp' | 'gif' — default 'webp'
    outputFolder: 'out',
    scale: 2,
    audio: true,               // mixed via adelay+amix when format supports audio
});
```

| extension | codec        | alpha | audio |
|-----------|--------------|-------|-------|
| `webm`    | libvpx       | yes   | yes   |
| `mp4`     | libx264      | no    | yes   |
| `webp`    | libwebp      | yes   | no    |
| `gif`     | gif          | no    | no    |

## Audio

Sprite sound events are resolved from the FMOD-derived audio bank.

```ts
const events = await sprite.currentSoundEvents();
//   [{ soundPath, startTime, frameCount, timestamp }, ...]
```

In the browser, `SpriteAudioPlayer` decodes and schedules them; `SpritePlayback`
already wires it up. In Node, `saveAnimation` resolves the bytes through the
configured loader and hands them to ffmpeg.

## Skin-asset rendering

Render an individual graphic or named symbol from skin assets

```ts
sprite.renderSkinAsset(0);                    // by graphic index
sprite.renderSkinAsset(-1, 'symbol_name');    // by symbol name
```

## Map animations

Pass `isMapAnimation: true` to load animated map props (sourced from
`Content/Animations/Props/` rather than `Content/Characters/Bones/`):

```ts
const sprite = await DofusSprite.create(look, canvas, { isMapAnimation: true });
```

## Sub-entities

Looks can carry nested sub-entities (mounts, pets, auras…). The look-string
syntax `{...|N@cat={subLook}}` is parsed by `Look.fromString` and the renderer
preloads each sub-entity sprite, sharing the parent's WebGL context. Their
sub-animations are picked automatically from the parent's current animation
name and played in lockstep on a separate buffer.

## WebGL1 / WebGL2

`RendererContext` prefers WebGL2 and falls back to WebGL1 + extensions when it
isn't available:

| feature                      | WebGL2      | WebGL1 fallback                        |
|------------------------------|-------------|----------------------------------------|
| VAO                          | core        | `OES_vertex_array_object` (optional)   |
| 32-bit element indices       | core        | `OES_element_index_uint` (optional)    |
| `MIN` / `MAX` blend equation | core        | `EXT_blend_minmax` (falls back to ADD) |

Missing extensions degrade gracefully: without VAOs, attribute pointers are
re-bound every draw; without `OES_element_index_uint`, indices are uploaded as
`Uint16Array`; without `EXT_blend_minmax`, `Lighten`/`Darken` collapse to
`ADD`. Shaders are written in GLSL ES 1.00 so the same source compiles under
both contexts.

## Configuration

`configure(config)` accepts a discriminated union:

| strategy | description                                                                                              | runtime       |
|----------|----------------------------------------------------------------------------------------------------------|---------------|
| `url`    | `fetch()` assets from `basePath`                                                                         | browser, node |
| `fs`     | `node:fs/promises` reads assets from `basePath`                                                          | node          |
| `LE`     | live extract — fetch from the local FastAPI dev server, which extracts bones/skins on demand (dev only)  | browser, node |

Config accepts a `decodeImage: (bytes, path) => TextureSource` hook for Node
runtimes where `createImageBitmap` isn't available.

The `url` loader looks for an optional `Content/Characters/table.json`
manifest at startup and uses it to append cache-busting `?t=` query strings to
bone/skin/audio asset URLs (so a CDN can serve them with long max-age headers
and still invalidate per asset).

The `LE` loader subclasses `url` — it points at the FastAPI server shipped in
`live_extract.py`, which extracts the requested bone/skin from a local Dofus
install on the fly. See [Live extract](#live-extract-on-the-fly-dev-only)
below. Audio is not supported in this mode.

Advanced users can skip the singleton and build their own loader instance with
`createDataLoader(config)`, then wire it up themselves.

## Public API

Asset loading

- `configure(config)` / `getLoader()` / `createDataLoader(config)`
- types: `DataLoader`, `DataConfig`, `ImageDecoder`, `TextureSource`,
  `RawImageData`

Look

- `Look` — parse, build and serialise a Dofus look string
- `SubEntityCategory` enum
- `intToRgb`, `indexedColorsToDict`, `RGB` color helpers

Sprite

- `DofusSprite` — renderer entry point bound to a `<canvas>`. Notable methods:
  `prepareAnimation`, `renderFrame`, `renderSkinAsset`, `getMaxFrame`,
  `getAnimName`, `getSubEntity`, `currentSoundEvents`.
- `Directions`, `oppositeDirection`, `getAnimName` direction/anim helpers

Playback & export (browser)

- `SpritePlayback`, `SpritePlayOptions`
- `saveToPng`, `saveToWebp`, `saveToWebm`,
  `SaveWebpBrowserOptions`, `SaveWebmBrowserOptions`

Audio

- `SpriteAudioPlayer` (browser)
- `getAudioManager`, `AudioManager`, `SoundEvent`

Node subpath (`d3-ts-renderer/node`)

- `decodeImage`, `createCanvas`, `saveToPng`
- `saveAnimation`, `SaveAnimationOptions`, `ExportFormat`
- everything from the main entry, re-exported

## Development

```bash
npm install
npm run dev       # vite dev server for the test harness in example/index.html
npm run typecheck
npm run build     # tsup → dist/index.js + dist/node.js
```

The test harness (`example/index.html`) reads `VITE_DATA_STRATEGY` and
`VITE_DATA_PATH` to point the loader at your asset bundle.

### JetBrains IDE — GLSL syntax highlighting

Shader sources in `src/renderer/shaders.ts` are plain template literals. Install
the [GLSL plugin](https://plugins.jetbrains.com/plugin/18470-glsl) to get syntax
highlighting, completion and error checking inside them — the `// language=GLSL`
comment above each string tells the IDE which injection to apply.


## Roadmap

Not prioritized:
- **Flash filters** — parsed from data but not applied at render time
- **Partial-data API** — fetch individual body / skinslot entries instead of the full JSON
- **snap shader**
- **webm export** - saveToWebmWithMediaRecorder add [fix webm duration](https://github.com/yusitnikov/fix-webm-duration) or something similar to debug webm missing duration + seek.
  (saveToWebmWithMediaRecorder is only use when webcodec isn't supported)
- **live extract** - add audio support
  
## Data extraction

The renderer expects assets laid out the way [`pydofus3`](https://github.com/PyDofus/pydofus3)
writes them. Two helpers are documented below:

- **pydofus3** — extracts everything to disk; pair with the `url` or `fs` loader.
- **Live extract** — a small FastAPI server that extracts on demand from a
  local Dofus install; pair with the `LE` loader. Dev-only.

If you'd rather extract bundles by hand, two gotchas to keep in mind:

- textures: keep them as they are in the bundle (vertically flipped); do not
  flip them on export
- datacenter data: process `objectsById`

Both helpers below need [`uv`](https://docs.astral.sh/uv/) (no other Python
setup required). Install it first if you don't already have it:

```bash
# macOS / Linux
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

### pydofus3

Install the CLI globally:

```bash
uv tool install git+ssh://git@github.com/PyDofus/pydofus3.git
```

Or with the optional `fpng` extra to speed up PNG export (see the fpng section
of the pydofus3 README for the C++ toolchain requirements):

```bash
uv tool install "git+ssh://git@github.com/PyDofus/pydofus3.git[fpng]"
```

Always reuse the same `OUTPUT_PATH` for every command — pydofus3 writes each
catalog into the correct subfolder.

Bones and skins (textures default to PNG; pass `--skin-webp` to emit WebP):

```bash
pydofus3 data --no-big-int catalog Bones [DOFUS_PATH] --output [OUTPUT_PATH]
pydofus3 data --no-big-int catalog Skins [DOFUS_PATH] --output [OUTPUT_PATH]
```

As a rough order of magnitude (machine dependent): PNG export ≈ 25 minutes,
WebP export ≈ 2 hours 10.

Datacenter data (bodies, skin slots, sound bones, …):

```bash
pydofus3 data --no-big-int --process-datacenter catalog Data [DOFUS_PATH] --output [OUTPUT_PATH]
```

Audio (optional — needs both the bank events and the `aa` catalog):

```bash
pydofus3 audio [DOFUS_PATH] [OUTPUT_PATH]
pydofus3 data --no-big-int catalog aa [DOFUS_PATH] --output [OUTPUT_PATH]
```

For incremental extracts (only re-process files that changed) see the
`pydofus3 data json` subcommand in the [pydofus3 README](https://github.com/PyDofus/pydofus3)
or `pydofus3 --help`.

### Live extract (on-the-fly, dev only)

`live_extract.py` is a small FastAPI app that extracts bones and skins on
demand from a local Dofus install. Combined with the `LE` loader strategy it
removes the upfront extract step — useful during development.

Start the server (point `game_path` at your Dofus install root) You can pass it inline or use a .env file if you prefer:

```bash
game_path=/path/to/dofus_unity npm run liveExtract
```


Any FastAPI flag can be forwarded after `--`:

```bash
npm run liveExtract -- --help
npm run liveExtract -- --port 9000
```

Then point the renderer at it:

```ts
configure({
    strategy: 'LE',
    basePath: 'http://127.0.0.1:8000',
});
```

Extracted files are cached under `tpm/` (override with `tpm_path=...`). Audio
is **not** supported in this mode.

## Projects using the lib

These projects use the lib — contact me to be added to the list.

- [skin.souff.fr](https://skin.souff.fr) — skinator (not on the lib yet, migration in progress)

## Usage

Please do not use this lib to build another "skinator", and do not use it on
Dofus fan sites that put features behind a paywall.

Aside from those two restrictions, use it however you want.


## Acknowledgements

This project stands on the shoulders of several open-source projects. See [ACKNOWLEDGEMENTS.md](https://github.com/PyDofus/pydofus3/blob/master/ACKNOWLEDGEMENTS.md) for the full list.
