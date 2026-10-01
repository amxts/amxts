// @log setSize: mins [0, 0, 50] above maxs [1, 1, 40]
// entity.origin и поиск по радиусу. Сеттер origin раньше писал поле напрямую,
// движок не перепривязывал сущность, и find_ent_in_sphere искал её на старом
// месте. Свойства модуль читает и пишет в памяти сам; что записано, сверяется
// с модулем engine, который есть на любом сервере, а натив reapi - там, где
// reapi есть.
import { EV_FL_gravity, EV_FL_health, EV_INT_movetype, EV_INT_rendermode, var_classname, var_gravity, var_origin } from "@amxts/core/constants";
import { entity_get_float, entity_get_int, entity_set_float, entity_set_int, get_entvar, set_entvar } from "@amxts/core/natives";
import { Checks } from "@amxts/core/check";

server.addServerCommand("amxts_test_entity", run);

async function run() {
	const check = new Checks("entity");

	const box = Entity.create("info_target");
	check.expect(box != null, "info_target создан").toBe(true);
	if (box == null) {
		check.done();
		return;
	}

	box.classname = "amxts_test_box";
	box.origin = [120.0, -340.0, 64.0];
	check.expect(box.origin.x, "origin.x прочитан обратно").toBeCloseTo(120.0);
	check.expect(box.origin.z, "origin.z прочитан обратно").toBeCloseTo(64.0);
	check.expect(isNear(box, [120.0, -340.0, 70.0]), "найден рядом с новым местом").toBe(true);

	box.origin = [-500.0, 800.0, 32.0];
	check.expect(isNear(box, [-500.0, 800.0, 40.0]), "найден после переноса").toBe(true);
	check.expect(isNear(box, [120.0, -340.0, 70.0]), "на старом месте его нет").toBe(false);

	const byClass = Entity.findAll({ classname: "amxts_test_box" }).map(one => one.id);
	check.expect(byClass.includes(box.id), "найден по classname").toBe(true);

	enumFields(check, box);
	fieldNatives(check, box);
	modelAndSize(check, box);
	box.health = 42.5;
	check.expect(entity_get_float(box.id, EV_FL_health), "health сущности - дробное pev->health").toBe(42.5);

	check.expect(box.exists, "exists у созданной сущности").toBe(true);
	const world = new Entity(0);
	check.expect(world.exists, "exists у 0 - нет сущности").toBe(false);
	const beyond = new Entity(100000);
	check.expect(beyond.exists, "exists за последней сущностью - false, без ошибки").toBe(false);

	box.remove();
	await sleep(200);
	check.expect(box.exists, "exists после remove() и конца кадра").toBe(false);
	check.done();
}

/** Поля-перечисления: имя пишется числом движка и читается обратно именем. */
function enumFields(check: Checks, box: Entity) {
	box.renderMode = "additive";
	box.renderFx = "glowShell";
	box.moveType = "fly";
	box.solid = "trigger";
	box.takeDamage = "aim";
	check.expect(entity_get_int(box.id, EV_INT_rendermode), "renderMode \"additive\" - kRenderTransAdd").toBe(5);
	check.expect(entity_get_int(box.id, EV_INT_movetype), "moveType \"fly\" - MOVETYPE_FLY").toBe(5);
	check.expect(box.renderMode, "renderMode читается именем").toBe("additive");
	check.expect(box.renderFx, "renderFx читается именем").toBe("glowShell");
	check.expect(box.moveType, "moveType читается именем").toBe("fly");
	check.expect(box.solid, "solid читается именем").toBe("trigger");
	check.expect(box.takeDamage, "takeDamage (дробное поле) читается именем").toBe("aim");
	check.expect(box.deadFlag, "deadFlag новой сущности").toBe("alive");
	unnamedValue(check, box);
}

/** Число без имени (его записал бы Pawn-плагин) читается как "unknown", а запись "unknown" поле не трогает. */
function unnamedValue(check: Checks, box: Entity) {
	entity_set_int(box.id, EV_INT_rendermode, 9);
	check.expect(box.renderMode, "число без имени - \"unknown\"").toBe("unknown");
	box.renderMode = "unknown";
	check.expect(entity_get_int(box.id, EV_INT_rendermode), "запись \"unknown\" поле не меняет").toBe(9);
}

/**
 * Дробное поле, записанное движком, свойство читает числом. Натив reapi
 * приходит тем, что поле есть: дробное - числом, вектор - Vector, текст -
 * строкой; без reapi его нет.
 */
function fieldNatives(check: Checks, box: Entity) {
	entity_set_float(box.id, EV_FL_gravity, 0.25);
	check.expect(box.gravity, "свойство видит дробное, записанное движком").toBe(0.25);
	if (!hasModule("reapi")) return;

	set_entvar(box.id, var_gravity, 0.5);
	check.expect(get_entvar(box.id, var_gravity), "get_entvar дробного поля - число, а не биты").toBe(0.5);
	check.expect(box.gravity, "свойство видит то же число").toBe(0.5);
	check.expect(get_entvar<Vector>(box.id, var_origin).y, "get_entvar<Vector> - вектор").toBeCloseTo(box.origin.y);
	check.expect(get_entvar<string>(box.id, var_classname), "get_entvar<string> - текст").toBe("amxts_test_box");
}

/** Есть ли сущность среди найденных в 32 единицах от точки. */
function isNear(target: Entity, point: number[]) {
	const found = Entity.findAll({ near: point, radius: 32.0 }).map(one => one.id);
	return found.includes(target.id);
}

/** Модель ставится как в игре - с индексом; габариты - с size, а вывернутые не ставятся. */
function modelAndSize(check: Checks, box: Entity) {
	box.model = "models/w_c4.mdl";
	check.expect(box.model, "model прочитан обратно").toBe("models/w_c4.mdl");
	check.expect(box.modelIndex > 0, `modelIndex выставлен движком (${box.modelIndex})`).toBe(true);

	box.setSize([-8.0, -4.0, 0.0], [8.0, 4.0, 16.0]);
	check.expect(box.size.x, "size.x после setSize").toBeCloseTo(16.0);
	check.expect(box.mins.y, "mins.y после setSize").toBeCloseTo(-4.0);
	box.setSize([0.0, 0.0, 50.0], [1.0, 1.0, 40.0]);
	check.expect(box.maxs.z, "вывернутые габариты не поставлены").toBeCloseTo(16.0);
}
