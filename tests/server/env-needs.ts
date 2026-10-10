// The plugin the env suite starts with amxts_load: it requires a variable
// the server has not, and reads a number that .env has as text, so the
// module refuses it until the suite writes both into .env and reloads it.
// @unlisted
console.log(`env-needs read ${env("AMXTS_TEST_NEEDED")}, ${env("AMXTS_TEST_LIMIT", 10)}`);
