import { loadPlugin } from '@amxts/core/test-utils';
// Files as bytes and zip archives, on the fake server: tests/as/fs-bytes.ts.
// @ts-ignore - bun:test types not available during type checking
import { expect, setDefaultTimeout, test } from 'bun:test';
import { crc32, deflateRawSync } from 'node:zlib';

setDefaultTimeout(120_000);

const PLUGIN = 'tests/as/fs-bytes.ts';

/** A zip archive of these files: each deflated, or stored when `stored` names it. */
function zip(files: Record<string, Uint8Array>, stored: string[] = []): Uint8Array {
	const locals: Uint8Array[] = [];
	const entries: Uint8Array[] = [];
	let offset = 0;

	for (const [path, data] of Object.entries(files)) {
		const name = new TextEncoder().encode(path);
		const method = stored.includes(path) ? 0 : 8;
		const packed = method === 0 ? data : deflateRawSync(data);
		const local = new DataView(new ArrayBuffer(30));
		local.setUint32(0, 0x04034B50, true);
		local.setUint16(8, method, true);
		local.setUint32(14, crc32(data), true);
		local.setUint32(18, packed.length, true);
		local.setUint32(22, data.length, true);
		local.setUint16(26, name.length, true);
		locals.push(new Uint8Array(local.buffer), name, packed);

		const entry = new DataView(new ArrayBuffer(46));
		entry.setUint32(0, 0x02014B50, true);
		entry.setUint16(10, method, true);
		entry.setUint32(16, crc32(data), true);
		entry.setUint32(20, packed.length, true);
		entry.setUint32(24, data.length, true);
		entry.setUint16(28, name.length, true);
		entry.setUint32(42, offset, true);
		entries.push(new Uint8Array(entry.buffer), name);

		offset += 30 + name.length + packed.length;
	}

	const directory = Buffer.concat(entries);
	const end = new DataView(new ArrayBuffer(22));
	end.setUint32(0, 0x06054B50, true);
	end.setUint16(8, Object.keys(files).length, true);
	end.setUint16(10, Object.keys(files).length, true);
	end.setUint32(12, directory.length, true);
	end.setUint32(16, offset, true);
	return new Uint8Array(Buffer.concat([...locals, directory, new Uint8Array(end.buffer)]));
}

/** Bytes of every value, zero among them: what a text file never is. */
function binary(length: number): Uint8Array {
	return Uint8Array.from({ length }, (_, i) => (i * 7) & 0xFF);
}

test('a file is read and written as bytes, zeros and all, whole or at its end', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const map = binary(300_000);
	server.files.set('maps/kz_map.bsp', map);

	alice.command('fsb_copy maps/kz_map.bsp maps/kz_copy.bsp');

	expect(alice.console).toBe('300000 true true');
	expect(server.files.get('maps/kz_copy.bsp')).toEqual(new Uint8Array([...map, ...map]));
});

test('unzip gives the files of an archive, deflated and stored, into their folders', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const map = binary(100_000);
	const sound = new TextEncoder().encode('RIFF');
	server.files.set('maps/kz_map.zip', zip({ 'maps/kz_map.bsp': map, 'sound/kz/start.wav': sound, 'maps/kz_map.res': new Uint8Array(0) }, ['sound/kz/start.wav']));

	alice.command('fsb_unzip maps/kz_map.zip');

	expect(alice.console).toBe('maps/kz_map.bsp:100000,sound/kz/start.wav:4,maps/kz_map.res:0');
	expect(server.files.get('maps/kz_map.bsp')).toEqual(map);
	expect(server.files.get('sound/kz/start.wav')).toEqual(sound);
});

test('unzip refuses a path that leaves the folder, damaged bytes and what is not a zip', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const damaged = zip({ 'maps/a.bsp': binary(1000) }, ['maps/a.bsp']);
	damaged[40] ^= 0xFF;
	server.files.set('a.zip', zip({ '../server.cfg': binary(10) }));
	server.files.set('b.zip', damaged);
	server.files.set('c.zip', binary(100));

	for (const name of ['a', 'b', 'c']) alice.command(`fsb_unzip ${name}.zip`);

	expect(alice.console.split('\n')).toEqual([
		'unzip: "../server.cfg" would leave the folder',
		'unzip: "maps/a.bsp" is damaged',
		'unzip: this is not a zip archive',
	]);
	expect(server.files.has('server.cfg')).toBe(false);
});

test('bytes are not written or read past the game folder', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('fsb_outside');

	expect(alice.console).toBe('false true');
});
