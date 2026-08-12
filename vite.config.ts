import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: '/web-image-toon-shader/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  worker: {
    format: 'es',
  },
});
