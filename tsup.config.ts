import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', node: 'src/headless/index.ts' },
  format: ['esm'],
  target: 'es2022',
  splitting: true,
  platform: 'neutral',
  external: ['gl', 'sharp'],
  dts: true,
  sourcemap: true,
  clean: false,
  treeshake: true,
  esbuildOptions(options) {
    options.chunkNames = 'shared';
  },
});
