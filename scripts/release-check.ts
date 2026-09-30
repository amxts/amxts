// What makes a release whole: both systems' files, attached, of one version
// and one commit. scripts/release.ts refuses to publish until this finds
// nothing; tests/release.test.ts checks it.
import type { System } from './system';
import { SYSTEMS } from './system';

/** One file of a release, as its manifest lists it. */
export interface ReleaseFile {
	name: string;
	size: number;
	sha256: string;
}

/** amxts-<system>.json: what one system's build attached, and what it was built from. */
export interface Manifest {
	name: 'amxts';
	version: string;
	tag: string;
	system: System;
	commit: string;
	/** Whether the working tree had changes the commit does not. */
	dirty: boolean;
	built: string;
	files: ReleaseFile[];
}

/** An asset attached to the release, as GitHub lists it. */
export interface Asset {
	name: string;
	size: number;
}

/** The manifest's own file name. */
export function manifestName(system: System): string {
	return `amxts-${system}.json`;
}

/**
 * What stands between this release and publishing it; empty when nothing does.
 * `tag` is the release's (`v0.1.0`), `manifests` the amxts-*.json attached to
 * it, `assets` everything attached.
 */
export function releaseProblems(tag: string, manifests: Manifest[], assets: Asset[]): string[] {
	const problems: string[] = [];
	const version = tag.replace(/^v/, '');

	for (const system of SYSTEMS) {
		const found = manifests.filter(one => one.system === system);
		if (found.length === 0) problems.push(`no ${system} build: ${manifestName(system)} is not attached`);
		if (found.length > 1) problems.push(`${found.length} ${system} manifests`);
	}

	for (const manifest of manifests) {
		const who = manifest.system;
		if (manifest.version !== version) problems.push(`${who}: version ${manifest.version}, the tag is ${tag}`);
		if (manifest.tag !== tag) problems.push(`${who}: built for ${manifest.tag}, the release is ${tag}`);
		if (manifest.dirty) problems.push(`${who}: built from a working tree with uncommitted changes`);
		for (const file of manifest.files) {
			const asset = assets.find(one => one.name === file.name);
			if (!asset) problems.push(`${who}: ${file.name} is not attached`);
			else if (asset.size !== file.size) problems.push(`${who}: ${file.name} is ${asset.size} bytes attached, ${file.size} built`);
		}
	}

	const commits = [...new Set(manifests.map(one => one.commit))];
	if (commits.length > 1) problems.push(`the systems were built from different commits: ${manifests.map(one => `${one.system} ${one.commit.slice(0, 10)}`).join(', ')}`);

	return problems;
}
