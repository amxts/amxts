import { defineConfig } from 'vitest/config';

// The core's own tests, as scripts/test.ts runs them. A compile takes longer
// with the files side by side than alone: two minutes a test or hook, not
// Vitest's seconds, which would end one that is only slow, not stuck. The
// files are imported by Node itself, through the hook the amxts command
// loads the core's TypeScript with (scripts/node-ts.mjs), not through Vite:
// they start twice as fast. Node's `gc` lets scripts/asc.ts free a compile's
// memory at once.
export default defineConfig({
	test: {
		include: ['tests/*.test.ts'],
		testTimeout: 120_000,
		hookTimeout: 120_000,
		execArgv: ['--expose-gc', '--disable-warning=ExperimentalWarning', '--import', './scripts/node-ts.mjs'],
		experimental: { viteModuleRunner: false, nodeLoader: false },
	},
});
