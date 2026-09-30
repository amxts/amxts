// Тестовый плагин tests/access.test.ts: права из букв users.ini.

export function access_of(letters: string) {
	return accessOf(letters).join(",");
}
