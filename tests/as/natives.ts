// Проверка на сервере: свои нативы плагина с настоящими типами и fs.
//
// Каждая `export function` этого файла - натив AMX Mod X с тем же именем;
// сборка кладёт рядом `api_natives.inc` для Pawn. Нативы вызывает Pawn-плагин
// runtime/test/natives_caller.sma и сам пишет в лог ok/FAIL. Здесь - fs:
// `say /fs` в чате.
import { Checks } from "~/lib/check";
import * as fs from "~/fs";

plugin({ name: "api-natives", version: "1.0.0", author: "amxts", description: "Свои нативы и fs" });

const SETTINGS = "addons/amxmodx/data/amxts-natives.ini";

// Файл, из которого читает xn_lookup: пишется при загрузке плагина.
fs.writeFileSync(SETTINGS, "greeting=привет\nround_time=2.5\n");

/** Три строки через `|`: строки на входе, строка в out[] на выходе. */
export function xn_join(a: string, b: string, c: string) {
	return `${a}|${b}|${c}`;
}

/** Длина строки в символах: строка любой длины на входе. */
export function xn_length(text: string) {
	return text.length;
}

/** Число из текста или запасное значение: параметр со значением по умолчанию. */
export function xn_parse_int(text: string, fallback = -1) {
	const value = parseInt(text);
	if (isNaN(value)) return fallback;
	return value;
}

/** Половина: Float на входе и на выходе. */
export function xn_half(value: Float): Float {
	return value / 2;
}

/** Сумма массива: массив и его размер на входе. */
export function xn_sum(values: number[]) {
	let total = 0;
	for (let i = 0; i < values.length; i++) total += values[i];
	return total;
}

/** Каждое значение, умноженное на коэффициент: Float-массив в out[], число записанных - результат. */
export function xn_scale(values: Float[], factor: Float): Float[] {
	const scaled: number[] = [];
	for (let i = 0; i < values.length; i++) scaled.push(values[i] * factor);
	return scaled;
}

/** Числа от 0 до count - 1: массив целых в out[]. */
export function xn_range(count: number) {
	const list: number[] = [];
	for (let i = 0; i < count; i++) list.push(i);
	return list;
}

/** Длина вектора: `Float:v[3]` на входе. */
export function xn_magnitude(v: Vector): Float {
	return v.magnitude();
}

/** Логическое «не»: bool на входе и на выходе. */
export function xn_not(flag: boolean) {
	return !flag;
}

/** Значение по ключу из файла настроек или false: `string | null` - это bool и текст в out[]. */
export function xn_lookup(key: string) {
	const text = fs.readFileSync(SETTINGS);
	if (text == null) return null;

	const lines = text.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.startsWith(`${key}=`)) return line.substring(key.length + 1);
	}
	return null;
}

/** Записать текст в файл - fs из натива. */
export function xn_save(path: string, text: string) {
	return fs.writeFileSync(path, text);
}

/** Есть ли файл или папка. */
export function xn_exists(path: string) {
	return fs.existsSync(path);
}

/** Имена в папке через запятую или false, если папки нет. */
export function xn_list(path: string) {
	const names = fs.readdirSync(path);
	if (names == null) return null;
	return names.join(",");
}

/** Имя игрока: Player на входе - для Pawn это id, не игрок - и натив отвечает "". */
export function xn_player_name(player: Player) {
	return player.name;
}

/** Номер игрока или -1 для 0: `Player | null` - 0 это null. */
export function xn_player_or_none(player?: Player) {
	if (player == null) return -1;
	return player.id;
}

/** Приветствие: имя необязательно - Pawn без него передаёт "", и это тоже «нет». */
export function xn_greet(name?: string) {
	return name ? `привет, ${name}` : "никого";
}

/** Два игрока и число после них: дошло ли всё по местам. */
export function xn_player_pair(first: Player, second: Player, extra: number) {
	return first.id * 100 + second.id * 10 + extra;
}

/** Прочитать файл целиком - текст любой длины в out[]. */
export function xn_load(path: string) {
	return fs.readFileSync(path) || "";
}

server.addCommand("/fs", checkFs);

async function checkFs(player: Player) {
	const check = new Checks("api-natives", player);
	const path = "addons/amxmodx/data/amxts-fs-check.txt";

	// Длинный текст с кириллицей: больше 255 символов и больше одного блока чтения.
	let long = "";
	for (let i = 0; i < 200; i++) long += `строка ${i};`;

	check.expect(fs.writeFileSync(path, long), "writeFileSync").toBe(true);
	check.expect(fs.existsSync(path), "existsSync после записи").toBe(true);

	const back = fs.readFileSync(path);
	check.expect(back == null ? -1 : back.length, "readFileSync: длина").toBe(long.length);
	check.expect(back == long, "readFileSync: тот же текст").toBe(true);

	check.expect(fs.appendFileSync(path, "!конец"), "appendFileSync").toBe(true);
	const appended = fs.readFileSync(path);
	check.expect(appended != null && appended.endsWith("!конец"), "appendFileSync дописал в конец").toBe(true);

	check.expect(fs.readFileSync("addons/amxmodx/data/нет-такого.txt") == null, "readFileSync: нет файла - null").toBe(true);
	check.expect(fs.existsSync("addons/amxmodx/data/нет-такого.txt"), "existsSync: нет файла").toBe(false);
	check.expect(fs.existsSync("addons/amxmodx"), "existsSync: папка").toBe(true);

	const names = fs.readdirSync("addons/amxmodx/data");
	check.expect(names != null && names.includes("amxts-fs-check.txt"), "readdirSync видит файл").toBe(true);
	check.expect(names != null && !names.includes("."), "readdirSync без . и ..").toBe(true);
	check.expect(fs.readdirSync("addons/нет-такой-папки") == null, "readdirSync: нет папки - null").toBe(true);

	await fs.writeFile(path, "из промиса");
	const text = await fs.readFile(path);
	check.expect(text, "writeFile + readFile через await").toBe("из промиса");
	check.expect(await fs.exists(path), "exists через await").toBe(true);

	const missing = await fs.readFile("addons/amxmodx/data/нет-такого.txt").catch(error => `отказ: ${error.message}`);
	check.expect(missing.startsWith("отказ: ENOENT"), "readFile: нет файла - отказ ENOENT").toBe(true);

	check.expect(xn_lookup("greeting"), "файл настроек записан при загрузке").toBe("привет");
	check.done();
}
