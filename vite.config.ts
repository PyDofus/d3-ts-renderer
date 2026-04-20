import { defineConfig } from 'vite';

export default defineConfig({
    optimizeDeps: {
        noDiscovery: true,
        include: [],
    },
    build: {
        lib: {
            entry: 'src/index.ts',
            name: 'DofusSpriteRenderer',
            formats: ['es'],
            fileName: 'index',
        },
        rollupOptions: {
            external: [/^node:/],
        },
    },
});