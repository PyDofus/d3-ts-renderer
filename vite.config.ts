import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
  return {
    optimizeDeps: {
      noDiscovery: true,
      include: [],
    },
    define: {
      __DATA_STRATEGY__: JSON.stringify(env.DATA_STRATEGY ?? 'url'),
      __DATA_BASE_PATH__: JSON.stringify(env.DATA_PATH ??''),
    },
    build: {
      lib: {
        entry: 'src/index.ts',
        name: 'DofusSpriteRenderer',
        formats: ['es'],
        fileName: 'index',
      },
    },
  };
});
