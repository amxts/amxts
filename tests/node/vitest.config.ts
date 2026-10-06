import { defineConfig } from 'vitest/config';

// The plugin's tests that run under Node with Vitest, apart from the suite `bun test` runs.
export default defineConfig({ test: { include: ['tests/node/*.vitest.ts'], testTimeout: 120_000 } });
