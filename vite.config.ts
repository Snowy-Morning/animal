import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => {
          const extension = assetInfo.name?.split('.').pop()?.toLowerCase();
          if (extension === 'css') return 'assets/css/[name]-[hash][extname]';
          if (extension && ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(extension)) {
            return 'assets/images/[name]-[hash][extname]';
          }
          return 'assets/[name]-[hash][extname]';
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
