import { defineConfig } from 'vitest/config';
import { swPlugin } from './tools/swPlugin.ts';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2020' },
  plugins: [swPlugin()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
