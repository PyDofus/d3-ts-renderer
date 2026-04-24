import { defineConfig } from 'tsup';

export default defineConfig([
  {
    name: 'browser',
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'es2022',
    platform: 'browser',
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
  },
  {
    name: 'node',
    entry: { node: 'src/headless/export.ts' },
    format: ['esm'],
    target: 'es2022',
    platform: 'node',
    dts: true,
    sourcemap: true,
    clean: false,
    treeshake: true,
    external: ['gl', 'sharp'],
  },
]);