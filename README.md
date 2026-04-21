# d3-ts-renderer

A TypeScript/WebGL renderer for [Dofus](https://www.dofus.com) game sprites.

This library is a TypeScript rewrite of the Python renderer that powers
[skin.souff.fr](https://skin.souff.fr), bringing native browser rendering (no
server-side image generation) and a reusable API for embedding Dofus sprites in
web apps.

## Installation

```bash
npm install d3-ts-renderer
```

## Getting started

The renderer needs to know where to fetch sprite assets (bone bundles, skins,
body/slot metadata). Call `configure()` once at startup before creating any
sprite.

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

The default entry is browser-only and has no native dependencies. For headless
Node rendering, install [`gl`](https://www.npmjs.com/package/gl) and
[`sharp`](https://www.npmjs.com/package/sharp) alongside this package — they
are declared as optional peer dependencies, so browser consumers won't pull
them in:

```bash
npm install d3-ts-renderer gl sharp
```

The `d3-ts-renderer/node` subpath bundles ready-made helpers for the three
pieces Node needs: a headless WebGL1 context, a canvas shim, and a `sharp`-
based image decoder.

```ts
import { configure, Look, DofusSprite } from 'd3-ts-renderer';
import { decodeImage, createCanvas, saveToPng } from 'd3-ts-renderer/node';

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
`gl.canvas.{width,height}`. [`@napi-rs/canvas`](https://www.npmjs.com/package/@napi-rs/canvas)
is a drop-in alternative to `sharp` for decoding.

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

| strategy | description                                     | runtime       |
|----------|-------------------------------------------------|---------------|
| `url`    | `fetch()` assets from `basePath`                | browser, node |
| `fs`     | `node:fs/promises` reads assets from `basePath` | node          |

config accepts a `decodeImage: (bytes, path) => TextureSource`
hook for Node runtimes where `createImageBitmap` isn't available.

Advanced users can skip the singleton and build their own loader instance with
`createDataLoader(config)`, then wire it up themselves.

## Public API

- `Look` — parse, build and serialise a Dofus look string
- `DofusSprite` — the renderer entry point (bind to a `<canvas>`)
- `configure` / `getLoader` / `createDataLoader` — asset loader setup

## Development

```bash
npm install
npm run dev       # vite dev server for the test harness in example/index.html
npm run typecheck
```


### JetBrains IDE — GLSL syntax highlighting

Shader sources in `src/renderer/shaders.ts` are plain template literals. Install
the [GLSL plugin](https://plugins.jetbrains.com/plugin/18470-glsl) to get syntax
highlighting, completion and error checking inside them — the `// language=GLSL`
comment above each string tells the IDE which injection to apply.

## Roadmap

Not yet implemented:

- **Export** — save canvas contents as PNG / WebP / animated WebM
- **Audio** — sound bank playback is not wired up
- **Flip** — horizontal mirroring of sprites
- **Skin / graphic rendering**
- **Flash filters** — parsed from data but not applied at render time
- **Partial-data API** — fetch individual body / skinslot entries instead of
  the full metadata JSON
