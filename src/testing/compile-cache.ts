// What the testing library compiled, kept on disk between test runs
// (scripts/compile-cache.ts): a second run takes a compile again only while
// every file it read is the same.
//
// The cache is node_modules/.cache/amxts in the folder the tests run from.
// AMXTS_TEST_CACHE=0 turns it off; AMXTS_TEST_CACHE=<folder> moves it.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeIdentity, diskCache } from '../../scripts/compile-cache';

const setting = process.env.AMXTS_TEST_CACHE;
const HERE = dirname(fileURLToPath(import.meta.url));

const cache = diskCache(
	setting === '0' ? null : resolve(setting || 'node_modules/.cache/amxts', 'compile'),
	() => codeIdentity([join(HERE, 'compile.ts'), join(HERE, 'compile-cache.ts')]),
);

/** Whether results are kept on disk: not with AMXTS_TEST_CACHE=0. */
export const cacheOn = cache.on;

/** How often this process took a result from the disk, and made one. */
export const cacheCounts = cache.counts;

/**
 * `run`'s value, from the disk when an earlier run made it from the same
 * sources, or made now and kept. `parts` is what it depends on besides the
 * files it reads: the entry, the flags. `keep` says whether a failure is
 * worth keeping - a compile error is, a file that could not be opened is not.
 */
export const cached = cache.cached;
