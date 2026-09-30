// The AMX Mod X distribution the core builds with, into amxmodx/base: the
// scripting/ folder of its base and cstrike packages - the includes the API
// is generated from and amxxpc, which compiles the host plugin and the Pawn
// suites.
//
//   bun run setup:amxmodx
//
// The build is pinned, with the sha256 of each package, for this machine's
// system: amxxpc.exe on Windows, amxxpc (32-bit, with amxxpc32.so) on Linux.
// The includes are the same in both. Nothing is fetched when amxxpc is there.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { amxxpcPath, HOST_SYSTEM } from './system';
import { unzip } from './unzip';

const CORE = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BASE = join(CORE, 'amxmodx/base');
const BUILD = '1.10.0-git5484';

const PACKAGES = {
	windows: {
		base: '40c5b62d795c381fc03657340b16b7eec2422b1aac6bfd570dbbde8585ea8848',
		cstrike: '1c322de8cda7ed0e64906d4c59cf806ca9893fcdf60fae3bb6ac4b91edf00e9e',
	},
	linux: {
		base: '479adf033874fa398c130ab7045433a33c4ec067580bf5903586fa367ea9ceab',
		cstrike: 'ce8ec3b232f8d2c57b6b854401bfda0a79f15280800f5d30e40d1cac2403a639',
	},
} as const;

const SCRIPTING = 'addons/amxmodx/scripting/';

function fail(message: string): never {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

if (existsSync(amxxpcPath()) && !process.argv.includes('--force')) {
	console.log(`amxmodx/base has AMX Mod X already (${amxxpcPath()})`);
	process.exit(0);
}

const temp = mkdtempSync(join(tmpdir(), 'amxts-amxmodx-'));
try {
	mkdirSync(BASE, { recursive: true });
	for (const [part, sha256] of Object.entries(PACKAGES[HOST_SYSTEM])) {
		const file = `amxmodx-${BUILD}-${part}-${HOST_SYSTEM}.${HOST_SYSTEM === 'windows' ? 'zip' : 'tar.gz'}`;
		const url = `https://www.amxmodx.org/amxxdrop/1.10/${file}`;
		const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
		if (!response.ok) fail(`${url} answered ${response.status}`);
		const data = new Uint8Array(await response.arrayBuffer());
		const got = createHash('sha256').update(data).digest('hex');
		if (got !== sha256) fail(`${file}: sha256 ${got}, expected ${sha256}`);

		if (HOST_SYSTEM === 'windows') {
			for (const [path, content] of unzip(data)) {
				if (!path.startsWith(SCRIPTING)) continue;
				const target = join(BASE, path.slice(SCRIPTING.length));
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, content);
			}
		} else {
			const archive = join(temp, file);
			writeFileSync(archive, data);
			const unpacked = spawnSync('tar', ['-xzf', archive, '-C', temp, SCRIPTING], { stdio: 'inherit' });
			if (unpacked.status !== 0) fail(`could not unpack ${file}`);
		}
		console.log(`${file} ✓`);
	}
	if (HOST_SYSTEM === 'linux') {
		for (const entry of readdirSync(join(temp, SCRIPTING))) {
			spawnSync('cp', ['-r', join(temp, SCRIPTING, entry), BASE]);
		}
		chmodSync(amxxpcPath(), 0o755);
	}
} finally {
	rmSync(temp, { recursive: true, force: true });
}

console.log(`✅ ${BASE}`);
