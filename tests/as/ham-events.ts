// A fixture for tests/ham-events.test.ts: game events Ham Sandwich delivers -
// on a class a listener names, filtered before the plugin - and one event with
// both backends, reapi's for a player and Ham Sandwich's for another class;
// an entity's actions, with the listeners and without.

game.addEventListener("primaryAttack", onSlash, { classname: "weapon_knife" });
game.addEventListener("secondaryAttack", afterStab, { classname: "weapon_knife", post: true });
game.addEventListener("takeDamage", onBoxHurt, { classname: "func_breakable" });
game.addEventListener("takeDamage", onPlayerHurt);
game.addEventListener("deploy", () => false, { classname: "weapon_c4" });
game.addEventListener("teamId", () => "blue", { classname: "func_door" });
game.addEventListener("use", onUse, { classname: "func_button" });
game.addEventListener("isBot", () => true);
game.addEventListener("think", () => console.log("no class"));

server.addCommand("ham_stab", stab);
server.addCommand("ham_deploy", deploy);

function onSlash(event: PrimaryAttackEvent) {
	const knife = event.weapon;
	console.log(`slash ${knife.id}`);
	knife.secondaryAttack();
	event.preventDefault();
}

function afterStab(event: SecondaryAttackEvent) {
	console.log(`stab ${event.weapon.id}`);
}

function onBoxHurt(event: TakeDamageEvent) {
	console.log(`box ${event.entity.id} ${event.damage}`);
	event.damage = 5;
	return 0;
}

function onPlayerHurt(event: TakeDamageEvent) {
	console.log(`player ${event.player.id}`);
}

function onUse(event: UseEvent) {
	console.log(`use ${event.useType} ${event.value}`);
	event.useType = "off";
}

function stab(_player: Player, args: string[]) {
	const knife = new Weapon(parseInt(args[0]));
	knife.secondaryAttack({ hooks: false });
}

function deploy(_player: Player, args: string[]) {
	const c4 = new Weapon(parseInt(args[0]));
	console.log(`deployed ${c4.deploy()}`);
}
