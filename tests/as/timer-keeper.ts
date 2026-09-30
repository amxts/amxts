// Тестовый плагин tests/closures.test.ts: таймер, которого другой плагин не касается.

setTimeout(() => console.log("the keeper's timer fired"), 1000);
