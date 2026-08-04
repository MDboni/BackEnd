import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Calculation and cutoff tests are pure — no database, no env required.
    env: { NODE_ENV: 'test' },
  },
});
