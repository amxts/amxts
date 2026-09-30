// Тестовый плагин tests/closures.test.ts: таймер, который этот плагин сам
// останавливает, - таймер другого плагина от этого не останавливается.

const handle = setTimeout(() => console.log("the clearer's timer fired"), 1000);

export function clear_own() {
	clearTimeout(handle);
}
