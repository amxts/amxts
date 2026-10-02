// @log setSize: mins [0, 0, 50] above maxs [1, 1, 40]
// entity.origin and a search by radius. The origin setter used to write the field
// directly, the engine did not relink the entity, and find_ent_in_sphere looked for it
// in the old place. The module reads and writes the properties in memory itself; what
// is written is checked against the engine module, which every server has, and
// against a reapi native where reapi is.
import { EV_FL_gravity, EV_FL_health, EV_INT_movetype, EV_INT_rendermode, var_classname, var_gravity, var_origin } from "@amxts/core/constants";
import { entity_get_float, entity_get_int, entity_set_float, entity_set_int, get_entvar, set_entvar } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_entity", run);

async function run() {
	const check = new Checks("entity");

	const box = Entity.create("info_target");
	check.expect(box != null, "info_target is created").toBe(true);
	if (box == null) {
		check.done();
		return;
	}

	box.classname = "amxts_test_box";
	box.origin = [120.0, -340.0, 64.0];
	check.expect(box.origin.x, "origin.x reads back").toBeCloseTo(120.0);
	check.expect(box.origin.z, "origin.z reads back").toBeCloseTo(64.0);
	check.expect(isNear(box, [120.0, -340.0, 70.0]), "found near the new place").toBe(true);

	box.origin = [-500.0, 800.0, 32.0];
	check.expect(isNear(box, [-500.0, 800.0, 40.0]), "found after the move").toBe(true);
	check.expect(isNear(box, [120.0, -340.0, 70.0]), "not in the old place").toBe(false);

	const byClass = Entity.findAll({ classname: "amxts_test_box" }).map(one => one.id);
	check.expect(byClass.includes(box.id), "found by classname").toBe(true);

	enumFields(check, box);
	fieldNatives(check, box);
	modelAndSize(check, box);
	box.health = 42.5;
	check.expect(entity_get_float(box.id, EV_FL_health), "an entity's health is the float pev->health").toBe(42.5);

	check.expect(box.exists, "exists of a created entity").toBe(true);
	const world = new Entity(0);
	check.expect(world.exists, "exists of 0 - no entity").toBe(false);
	const beyond = new Entity(100000);
	check.expect(beyond.exists, "exists past the last entity - false, without an error").toBe(false);

	box.remove();
	await sleep(200);
	check.expect(box.exists, "exists after remove() and the end of the frame").toBe(false);
	check.done();
}

/** Enum fields: a name is written as the engine's number and reads back as the name. */
function enumFields(check: Checks, box: Entity) {
	box.renderMode = "additive";
	box.renderFx = "glowShell";
	box.moveType = "fly";
	box.solid = "trigger";
	box.takeDamage = "aim";
	check.expect(entity_get_int(box.id, EV_INT_rendermode), "renderMode \"additive\" - kRenderTransAdd").toBe(5);
	check.expect(entity_get_int(box.id, EV_INT_movetype), "moveType \"fly\" - MOVETYPE_FLY").toBe(5);
	check.expect(box.renderMode, "renderMode reads as a name").toBe("additive");
	check.expect(box.renderFx, "renderFx reads as a name").toBe("glowShell");
	check.expect(box.moveType, "moveType reads as a name").toBe("fly");
	check.expect(box.solid, "solid reads as a name").toBe("trigger");
	check.expect(box.takeDamage, "takeDamage (a float field) reads as a name").toBe("aim");
	check.expect(box.deadFlag, "deadFlag of a new entity").toBe("alive");
	unnamedValue(check, box);
}

/** A number without a name (a Pawn plugin could write it) reads as "unknown", and writing "unknown" leaves the field alone. */
function unnamedValue(check: Checks, box: Entity) {
	entity_set_int(box.id, EV_INT_rendermode, 9);
	check.expect(box.renderMode, "a number without a name is \"unknown\"").toBe("unknown");
	box.renderMode = "unknown";
	check.expect(entity_get_int(box.id, EV_INT_rendermode), "writing \"unknown\" does not change the field").toBe(9);
}

/**
 * A float field the engine wrote, the property reads as a number. The reapi
 * native answers as the field is: a float as a number, a vector as a Vector,
 * text as a string; without reapi there is none.
 */
function fieldNatives(check: Checks, box: Entity) {
	entity_set_float(box.id, EV_FL_gravity, 0.25);
	check.expect(box.gravity, "the property sees a float the engine wrote").toBe(0.25);
	if (!hasModule("reapi")) return;

	set_entvar(box.id, var_gravity, 0.5);
	check.expect(get_entvar(box.id, var_gravity), "get_entvar of a float field is a number, not bits").toBe(0.5);
	check.expect(box.gravity, "the property sees the same number").toBe(0.5);
	check.expect(get_entvar<Vector>(box.id, var_origin).y, "get_entvar<Vector> is a vector").toBeCloseTo(box.origin.y);
	check.expect(get_entvar<string>(box.id, var_classname), "get_entvar<string> is text").toBe("amxts_test_box");
}

/** Whether the entity is among those found within 32 units of the point. */
function isNear(target: Entity, point: number[]) {
	const found = Entity.findAll({ near: point, radius: 32.0 }).map(one => one.id);
	return found.includes(target.id);
}

/** A model is set as in the game - with its index; bounds with size, and inverted ones are not set. */
function modelAndSize(check: Checks, box: Entity) {
	box.model = "models/w_c4.mdl";
	check.expect(box.model, "model reads back").toBe("models/w_c4.mdl");
	check.expect(box.modelIndex > 0, `modelIndex is set by the engine (${box.modelIndex})`).toBe(true);

	box.setSize([-8.0, -4.0, 0.0], [8.0, 4.0, 16.0]);
	check.expect(box.size.x, "size.x after setSize").toBeCloseTo(16.0);
	check.expect(box.mins.y, "mins.y after setSize").toBeCloseTo(-4.0);
	box.setSize([0.0, 0.0, 50.0], [1.0, 1.0, 40.0]);
	check.expect(box.maxs.z, "inverted bounds are not set").toBeCloseTo(16.0);
}
