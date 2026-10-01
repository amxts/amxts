// A compile process of scripts/compile-pool.ts: compiles the plugins it is
// sent, one at a time, through the build's plugin cache (scripts/plugin-cache.ts),
// and answers each with what went wrong and the plugin's natives. It ends when
// the build disconnects.
import type { WorkerJob, WorkerResult } from './compile-pool';
import type { PluginNative } from './plugin-natives';
import { pluginCache } from './plugin-cache';
import { nativesBeside } from './plugin-natives';

const caches = new Map<string, ReturnType<typeof pluginCache>>();

process.on('message', async ({ plugin, dir, includes }: WorkerJob) => {
	const key = JSON.stringify([dir, includes]);
	if (!caches.has(key)) caches.set(key, pluginCache(dir, includes));
	const natives: PluginNative[] = [];
	let problem: string | null;
	try {
		problem = await caches.get(key)!.compile(plugin, natives);
	} catch (error) {
		problem = String((error as Error).stack ?? error);
	}
	process.send!({ problem, natives, beside: nativesBeside(natives) } satisfies WorkerResult);
});
