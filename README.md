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

Running the full renderer in Node needs three pieces:

1. **A WebGL context.** Use [`gl`](https://www.npmjs.com/package/gl)
   (headless-gl). It exposes WebGL1 only, which is why this library carries a
   WebGL1 code path (see [WebGL1 / WebGL2](#webgl1--webgl2)).
2. **A canvas shim** for `DofusSprite.create(look, canvas)`. `RendererContext`
   only uses `canvas.getContext(...)` and `gl.canvas.{width,height}`, so a
   minimal duck-typed object is enough.
3. **An image decoder** for `.png` textures — pass a `decodeImage` callback to
   the `fs` loader. [`sharp`](https://www.npmjs.com/package/sharp) and
   [`@napi-rs/canvas`](https://www.npmjs.com/package/@napi-rs/canvas) both work.

Sketch:

```ts
import createGL from 'gl';
import sharp from 'sharp';
import { configure, Look, DofusSprite } from 'd3-ts-renderer';

configure({
    strategy: 'fs',
    basePath: '/var/dofus-assets/',
    decodeImage: async (bytes) => {
        const { data, info } = await sharp(bytes)
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
        return { data: new Uint8ClampedArray(data), width: info.width, height: info.height };
    },
});

const gl = createGL(1, 1, { stencil: true, alpha: true, premultipliedAlpha: false });
const resizeExt = gl.getExtension('STACKGL_resize_drawingbuffer');
if (!resizeExt) throw new Error('STACKGL_resize_drawingbuffer extension unavailable');
const canvas = {
    _w: 1,
    _h: 1,
    get width() { return this._w; },
    set width(v: number) { this._w = v; resizeExt.resize(v, this._h); },
    get height() { return this._h; },
    set height(v: number) { this._h = v; resizeExt.resize(this._w, v); },
    getContext(type: string) { return type === 'webgl' ? gl : null; },
} as unknown as HTMLCanvasElement;

const sprite = await DofusSprite.create(Look.fromString('{1|120,2195,3042,3069,3963|1=16777215,2=15335424,3=15335424,4=16777215,5=0,6=15335424|56}'), canvas, {numberFrame:1});
await sprite.prepareAnimation('AnimStatiqueExplo0_1', 2, true);
sprite.renderFrame(0);

// Read back pixels from the GL drawing buffer and encode as PNG/WebP with sharp, etc.
const width = gl.drawingBufferWidth;
const height = gl.drawingBufferHeight;
const pixels = Buffer.alloc(width * height * 4);
gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
await sharp(pixels, {raw: { width, height, channels: 4 }}).png().flip().toFile('test.png');
```

Readback and image encoding are left to the caller — use `gl.readPixels` into a
`Uint8Array`, then hand it to `sharp` (or equivalent) to produce the final file.

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

| strategy | description                                     | runtime |
|----------|-------------------------------------------------|---------|
| `url`    | `fetch()` assets from `basePath`                | browser |
| `fs`     | `node:fs/promises` reads assets from `basePath` | node    |

The `fs` variant also accepts a `decodeImage: (bytes, path) => TextureSource`
hook for Node runtimes where `createImageBitmap` isn't available.

Advanced users can skip the singleton and build their own loader instance with
`createDataLoader(config)`, then wire it up themselves.

## Public API

- `Look` — parse, build and serialise a Dofus look string
- `DofusSprite` — the renderer entry point (bind to a `<canvas>`)
- `configure` / `getLoader` / `createDataLoader` — asset loader setup
- `Directions`, `SubEntityCategory`, color utilities

## Development

```bash
npm install
npm run dev       # vite dev server for the test harness in index.html
npm run typecheck
npm run build     # emit library bundle to dist/
```

The dev harness reads `VITE_DATA_STRATEGY` and `VITE_DATA_PATH` from `.env` and
passes them to `configure()`.

### JetBrains IDE — GLSL syntax highlighting

Shader sources in `src/renderer/shaders.ts` are plain template literals. Install
the [GLSL plugin](https://plugins.jetbrains.com/plugin/18470-glsl) to get syntax
highlighting, completion and error checking inside them — the `// language=GLSL`
comment above each string tells the IDE which injection to apply.

## Roadmap

Not yet implemented:

- **Export** — save canvas contents as PNG / WebP / animated WebM
- **Audio** — sound bank playback is not wired up
- **Flash filters** — parsed from data but not applied at render time
- **Flip** — horizontal mirroring of sprites
- **Skin / graphic rendering**
- **Partial-data API** — fetch individual body / skinslot entries instead of
  the full metadata JSON
- **`Look` serialisation** — round-trip helpers (`toString`, `toB16`, `toDict`)
