import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // The main process, and the backend process it starts (see
    // src/backend-process.mts). Forge builds only the entry forge.config.ts
    // names, unless the build names its own: the same options, two entries.
    lib: {
      entry: {
        main: 'src/main.mts',
        'backend-process': 'src/backend-process.mts',
      },
      fileName: () => '[name].js',
      formats: ['cjs'],
    },
  },
});
