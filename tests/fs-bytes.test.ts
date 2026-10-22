import { crc32, deflateRawSync } from 'node:zlib';
import { loadPlugin } from '@amxts/core/test-utils';
// Files as bytes and zip archives, on the fake server: tests/as/fs-bytes.ts.
import { expect, test } from 'vitest';

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

test('extractSync gives the files of a zip archive, deflated and stored, into their folders', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const map = binary(100_000);
	const sound = new TextEncoder().encode('RIFF');
	server.files.set('maps/kz_map.zip', zip({ 'maps/kz_map.bsp': map, 'sound/kz/start.wav': sound, 'maps/kz_map.res': new Uint8Array(0) }, ['sound/kz/start.wav']));

	alice.command('fsb_extract maps/kz_map.zip');

	expect(alice.console).toBe('maps/kz_map.bsp:100000,sound/kz/start.wav:4,maps/kz_map.res:0');
	expect(server.files.get('maps/kz_map.bsp')).toEqual(map);
	expect(server.files.get('sound/kz/start.wav')).toEqual(sound);
});

test('extractSync refuses a path that leaves the folder, damaged bytes, a kind it does not read and what is no archive', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	const damaged = zip({ 'maps/a.bsp': binary(1000) }, ['maps/a.bsp']);
	damaged[40] ^= 0xFF;
	server.files.set('a.zip', zip({ '../server.cfg': binary(10) }));
	server.files.set('b.zip', damaged);
	server.files.set('c.zip', binary(100));
	server.files.set('d.rar', new TextEncoder().encode('Rar!\x1A\x07\x00'));

	for (const name of ['a.zip', 'b.zip', 'c.zip', 'd.rar']) alice.command(`fsb_extract ${name}`);

	expect(alice.console.split('\n')).toEqual([
		'extract: "../server.cfg" would leave the folder',
		'extract: "maps/a.bsp" is damaged',
		'extract: this is not an archive extract reads - it reads zip',
		'extract: a rar archive is not read yet - extract reads zip',
	]);
	expect(server.files.has('server.cfg')).toBe(false);
});

/** Runs a command and lets its work on the module's worker come back; the lines it logged. */
async function run(server: Awaited<ReturnType<typeof loadPlugin>>, command: string): Promise<string[]> {
	const from = server.logLines.length;
	server.serverCommand(command);
	await server.responses();
	return server.logLines.slice(from);
}

test('extract gives the same files on the worker, and rejects a broken archive', async () => {
	const server = await loadPlugin(PLUGIN);
	const map = binary(100_000);
	const sound = new TextEncoder().encode('RIFF');
	const damaged = zip({ 'maps/a.bsp': binary(1000) });
	damaged[40] ^= 0xFF;
	server.files.set('maps/kz_map.zip', zip({ 'maps/kz_map.bsp': map, 'sound/kz/start.wav': sound, 'maps/kz_map.res': new Uint8Array(0) }, ['sound/kz/start.wav']));
	server.files.set('b.zip', damaged);
	server.files.set('d.rar', new TextEncoder().encode('Rar!\x1A\x07\x00'));

	expect(await run(server, 'fsb_extract_async maps/kz_map.zip')).toEqual(['maps/kz_map.bsp:100000,sound/kz/start.wav:4,maps/kz_map.res:0']);
	expect(server.files.get('maps/kz_map.bsp')).toEqual(map);
	expect(server.files.get('sound/kz/start.wav')).toEqual(sound);
	expect(await run(server, 'fsb_extract_async b.zip')).toEqual(['extract: "maps/a.bsp" is damaged']);
	expect(await run(server, 'fsb_extract_async d.rar')).toEqual(['extract: a rar archive is not read yet - extract reads zip']);
});

test('bytes written on the worker land in the order they were given; a path out of the game folder rejects', async () => {
	const server = await loadPlugin(PLUGIN);
	server.files.set('addons/amxmodx/data/keep.txt', new Uint8Array(0));

	expect(await run(server, 'fsb_order addons/amxmodx/data/order.bin')).toEqual(['1 2 1', 'ENOENT: no such file or directory, open \'../outside.bin\'']);
});

test('a byte read is a number: shifted, added and multiplied past 255', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');
	server.files.set('maps/kz_map.dat', new Uint8Array([0xFF, 0xFE, 0x80, 0x01, 0x00, 0x00, 0x00, 0x80]));

	alice.command('fsb_words maps/kz_map.dat');

	expect(alice.console).toBe(`${0x0180FEFF} ${0x80000000 | 0} ${0xFF + 0xFE} ${0xFF * 0xFE}`);
});

test('bytes are not written or read past the game folder', async () => {
	const server = await loadPlugin(PLUGIN);
	const alice = server.join('Alice');

	alice.command('fsb_outside');

	expect(alice.console).toBe('false true');
});
