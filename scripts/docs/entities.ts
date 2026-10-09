// Our own words for the fields of an entity, a player and a weapon - the
// entvars (pev->*, var_* in reapi) and the ReGameDLL members (m_*) that
// scripts/generate-entities.ts turns into typed properties of as/entities.ts -
// in both languages the project speaks.
//
// The generator writes an entry as the property's tooltip and adds the
// engine's name on a last line of its own: "The entity's gravity ...",
// then "Pawn: `pev->gravity`". An entry whose numbers are an engine
// constant family ends with its own "Pawn: `kRender*`" paragraph, which the
// generator puts after the engine's name. The language is AMXTS_DOCS_LANG in
// .env ("en" by default, or "ru"). A field missing here falls back to
// English, then to the bare "var_gravity - float" line.
//
// Written for a plugin author (code-style rule 30): the first
// words say what the field is and whose - "The player's money" - then its
// unit or range and typical values; no engine names outside the Pawn line. Angles are degrees, speeds units per second, a "game time"
// is get_gametime() seconds. Where the game itself keeps a field up to date,
// the entry says so - writing it is then undone on the next frame. Keyed by
// the reapi name: m_flTimeWeaponIdle and m_Weapon_flTimeWeaponIdle are a
// player's and a weapon's, and the reapi names tell them apart.
//
// Sources: HLSDK progdefs.h (entvars_t), ReHLDS sv_user.cpp and sv_phys.cpp
// (what the engine does with them), ReGameDLL player.h, weapons.h, cbase.h
// and the code that reads each member.
import type { Text } from './events';

// The spare fields. On an entity that is not a player nothing touches them;
// on a player the game took some of them over (observer.cpp, pm_shared.cpp).
const free: Text = {
	en: `A free field: a plugin keeps its own value here; the game does not use it.`,
	ru: `Свободное поле: плагин хранит здесь своё значение, игра его не трогает.`,
};

function freeEntity(en: string, ru: string): Text {
	return {
		en: `A free field on any entity but a player: a plugin keeps its own value here. ${en}`,
		ru: `Свободное поле на любой сущности, кроме игрока: плагин хранит здесь своё значение. ${ru}`,
	};
}

function unused(en: string, ru: string): Text {
	return {
		en: `${en} CS does not use the field.`,
		ru: `${ru} В CS не используется.`,
	};
}

// CBaseEntity's ammo_* fields: the player's reserve ammo by calibre, copied
// from his real store (m_rgAmmo) by TabulateAmmo whenever it changes.
function ammoCopy(calibre: string, guns: string): Text {
	return {
		en: `A copy of the player's reserve ${calibre} ammo (${guns}): the game refreshes it whenever the real ammo changes, and writing it gives no ammo.`,
		ru: `Копия запаса патронов ${calibre} у игрока (${guns}): игра обновляет её при каждом изменении настоящего запаса, запись патронов не даёт.`,
	};
}

function maxAmmo(calibre: string): Text {
	return {
		en: `The player's limit of ${calibre} ammo, as Half-Life meant it; the game does not use it.`,
		ru: `Предел патронов ${calibre} у игрока, как его задумал Half-Life; игра его не использует.`,
	};
}

export const ENTITY_FIELDS: Record<string, Text> = {
	// entvars_t - every entity has them.
	var_classname: {
		en: `The entity's class name, e.g. \`"player"\`, \`"weaponbox"\`, \`"grenade"\`, \`"func_door"\`.`,
		ru: `Класс сущности, например \`"player"\`, \`"weaponbox"\`, \`"grenade"\`, \`"func_door"\`.`,
	},
	var_globalname: {
		en: `The entity's global name, which a mapper gives it to carry its state across a level change (single-player maps).`,
		ru: `Глобальное имя сущности: по нему она переносит состояние между уровнями (одиночные карты).`,
	},
	var_origin: {
		en: `The entity's position in the world, in units. Assigning it moves the entity properly, so its collisions move with it.`,
		ru: `Положение сущности в мире, в единицах. Присваивание перемещает её правильно, и столкновения переезжают вместе с ней.`,
	},
	var_oldorigin: {
		en: `The entity's saved position; what it holds depends on the entity (a breakable keeps its spawn point here).`,
		ru: `Сохранённая позиция сущности; что в ней, зависит от сущности (разбиваемая хранит здесь точку появления).`,
	},
	var_velocity: {
		en: `The entity's velocity, units per second: a running player moves at about \`250\`.`,
		ru: `Скорость сущности с направлением, единиц в секунду: бегущий игрок — около \`250\`.`,
	},
	var_basevelocity: {
		en: `The extra velocity the entity gets from what it stands in — a conveyor, a \`trigger_push\`, a water current — on top of its own. Units per second.`,
		ru: `Добавочная скорость сущности от того, в чём она стоит, — конвейер, \`trigger_push\`, течение. Единиц в секунду.`,
	},
	var_clbasevelocity: {
		en: `The conveyor velocity the player's client uses to predict movement; the engine zeroes it every player frame.`,
		ru: `Скорость конвейера для предсказания движения на клиенте игрока; движок обнуляет её каждый кадр игрока.`,
	},
	var_movedir: {
		en: `The direction a door, a platform or a button moves in, worked out from its angles when it spawns.`,
		ru: `Направление движения двери, платформы или кнопки; вычисляется из углов при появлении.`,
	},
	var_angles: {
		en: `The entity's rotation: pitch, yaw, roll in degrees. For a player it follows where he looks; to turn his view, set it together with \`fixAngle\`.`,
		ru: `Поворот сущности: тангаж, рысканье, крен в градусах. У игрока следует за взглядом; чтобы развернуть взгляд, поставьте его вместе с \`fixAngle\`.`,
	},
	var_avelocity: {
		en: `The entity's rotation speed, degrees per second on each axis.`,
		ru: `Скорость вращения сущности, градусов в секунду по каждой оси.`,
	},
	var_punchangle: {
		en: `The player's view kick from recoil or a hit, in degrees; the engine eases it back to zero by itself.`,
		ru: `Толчок взгляда игрока от отдачи или попадания, в градусах; движок сам гасит его до нуля.`,
	},
	var_v_angle: {
		en: `The player's view direction: pitch (down is positive), yaw, roll in degrees. Players only.`,
		ru: `Направление взгляда игрока: тангаж (вниз — положительный), рысканье, крен в градусах. Только у игроков.`,
	},
	var_endpos: {
		en: `The end point of a predicted projectile; sent to the client with \`startTime\` and \`impactTime\`.`,
		ru: `Конечная точка предсказываемого снаряда; уходит клиенту вместе со \`startTime\` и \`impactTime\`.`,
	},
	var_startpos: {
		en: `The start point of a predicted projectile; sent to the client with \`endPos\`.`,
		ru: `Начальная точка предсказываемого снаряда; уходит клиенту вместе с \`endPos\`.`,
	},
	var_impacttime: {
		en: `The game time a predicted projectile reaches \`endPos\`.`,
		ru: `Игровое время, когда предсказываемый снаряд долетит до \`endPos\`.`,
	},
	var_starttime: {
		en: `The game time a predicted projectile left \`startPos\`.`,
		ru: `Игровое время, когда предсказываемый снаряд вылетел из \`startPos\`.`,
	},
	var_fixangle: {
		en: `The player's view snap, one of: \`"none"\`; \`"set"\` - on the next frame the view turns to \`angles\`; \`"addYaw"\` - it turns by the yaw of \`angularVelocity\`. The engine then puts it back to \`"none"\`.`,
		ru: `Разворот взгляда игрока, одно из: \`"none"\` — нет; \`"set"\` — на следующем кадре взгляд повернётся по \`angles\`; \`"addYaw"\` — повернётся на рысканье из \`angularVelocity\`. Потом движок возвращает поле в \`"none"\`.`,
	},
	var_idealpitch: unused(`The pitch a monster turns to, in degrees.`, `Тангаж, к которому поворачивается монстр, в градусах.`),
	var_pitch_speed: unused(`A monster's turn speed in pitch, degrees per second.`, `Скорость поворота монстра по тангажу, градусов в секунду.`),
	var_ideal_yaw: {
		en: `The yaw a monster turns to, in degrees; a \`momentary_rot_button\` keeps its position here instead.`,
		ru: `Рысканье, к которому поворачивается монстр, в градусах; \`momentary_rot_button\` хранит здесь своё положение.`,
	},
	var_yaw_speed: {
		en: `A monster's turn speed, degrees per second.`,
		ru: `Скорость поворота монстра, градусов в секунду.`,
	},
	var_modelindex: {
		en: `The index of the entity's precached model; \`0\` draws nothing.`,
		ru: `Номер подгруженной модели сущности; \`0\` — сущность не рисуется.`,
	},
	var_model: {
		en: `The entity's model path, e.g. \`"models/w_c4.mdl"\`; a map brush has its number, e.g. \`"*12"\`. Writing it sets the model as the game does: \`modelIndex\` and the size follow. The model has to be precached (\`server.precache\`), or the server stops.`,
		ru: `Путь к модели сущности, например \`"models/w_c4.mdl"\`; у браша карты — его номер, например \`"*12"\`. Запись ставит модель так, как это делает игра: \`modelIndex\` и размер следуют за ней. Модель должна быть прекэширована (\`server.precache\`), иначе сервер остановится.`,
	},
	var_viewmodel: {
		en: `The player's first-person weapon model, the one he sees himself, e.g. \`"models/v_knife.mdl"\`.`,
		ru: `Модель оружия от первого лица, которую видит сам игрок, например \`"models/v_knife.mdl"\`.`,
	},
	var_weaponmodel: {
		en: `The weapon model other players see in the player's hands, e.g. \`"models/p_knife.mdl"\`.`,
		ru: `Модель оружия в руках игрока, которую видят другие, например \`"models/p_knife.mdl"\`.`,
	},
	var_absmin: {
		en: `The low corner of the entity's bounding box in world coordinates; the engine recomputes it when the entity moves.`,
		ru: `Нижний угол габаритов сущности в координатах мира; движок пересчитывает его при перемещении.`,
	},
	var_absmax: {
		en: `The high corner of the entity's bounding box in world coordinates; the engine recomputes it when the entity moves.`,
		ru: `Верхний угол габаритов сущности в координатах мира; движок пересчитывает его при перемещении.`,
	},
	var_mins: {
		en: `The low corner of the entity's bounding box, relative to \`origin\`: \`(-16, -16, -36)\` for a standing player. Set it with \`setSize(mins, maxs)\`, so \`size\` and \`absMin\` follow.`,
		ru: `Нижний угол габаритов сущности относительно \`origin\`: \`(-16, -16, -36)\` у стоящего игрока. Ставится через \`setSize(mins, maxs)\`, чтобы \`size\` и \`absMin\` пересчитались.`,
	},
	var_maxs: {
		en: `The high corner of the entity's bounding box, relative to \`origin\`: \`(16, 16, 36)\` for a standing player. Set it with \`setSize(mins, maxs)\`, so \`size\` and \`absMax\` follow.`,
		ru: `Верхний угол габаритов сущности относительно \`origin\`: \`(16, 16, 36)\` у стоящего игрока. Ставится через \`setSize(mins, maxs)\`, чтобы \`size\` и \`absMax\` пересчитались.`,
	},
	var_size: {
		en: `The dimensions of the entity's bounding box, maxs minus mins.`,
		ru: `Размеры габаритов сущности: maxs минус mins.`,
	},
	var_ltime: {
		en: `The local clock of a door, platform or train: it runs only while the entity moves, and its \`nextThink\` counts in it.`,
		ru: `Собственные часы двери, платформы или поезда: идут, только пока сущность движется, и её \`nextThink\` отсчитывается по ним.`,
	},
	var_nextthink: {
		en: `The game time the entity's think runs next; \`0\` or less means never. A door, platform or train counts it in \`localTime\`.`,
		ru: `Игровое время следующего think сущности; \`0\` и меньше — никогда. У двери, платформы и поезда отсчитывается по \`localTime\`.`,
	},
	var_movetype: {
		en: `
			The entity's kind of movement, one of: \`"none"\` - stands still; \`"walk"\` - walks (a player); \`"step"\` - walks as a monster; \`"fly"\` - flies without gravity; \`"toss"\` - falls; \`"push"\` - moves and pushes others, through the world (doors, platforms); \`"noclip"\` - flies through walls; \`"flyMissile"\` - flies like \`"fly"\`, hitting monsters from further away; \`"bounce"\` - falls and bounces; \`"bounceMissile"\` - bounces without gravity; \`"follow"\` - sticks to \`aimEntity\`; \`"pushStep"\` - a map object that collides with the world.

			Pawn: \`MOVETYPE_*\`
		`,
		ru: `
			Способ движения сущности, одно из: \`"none"\` — стоит на месте; \`"walk"\` — ходит (игрок); \`"step"\` — ходит как монстр; \`"fly"\` — летает без гравитации; \`"toss"\` — падает; \`"push"\` — движется и толкает других, сквозь мир (двери, платформы); \`"noclip"\` — летает сквозь стены; \`"flyMissile"\` — летает как \`"fly"\`, задевая монстров издалека; \`"bounce"\` — падает и отскакивает; \`"bounceMissile"\` — отскакивает без гравитации; \`"follow"\` — держится за \`aimEntity\`; \`"pushStep"\` — объект карты, который сталкивается с миром.

			Pawn: \`MOVETYPE_*\`
		`,
	},
	var_solid: {
		en: `
			The entity's solidity, one of: \`"none"\` - passes through everything; \`"trigger"\` - only registers touches; \`"box"\` - collides as a box; \`"slideBox"\` - collides as a player's box; \`"bsp"\` - collides as a map brush.

			Pawn: \`SOLID_*\`
		`,
		ru: `
			Твёрдость сущности, одно из: \`"none"\` — проходит сквозь всё; \`"trigger"\` — только касается; \`"box"\` — сталкивается как коробка; \`"slideBox"\` — как коробка игрока; \`"bsp"\` — как браш карты.

			Pawn: \`SOLID_*\`
		`,
	},
	var_skin: {
		en: `
			The number of the skin the model is drawn with, from \`0\`. A map brush keeps its contents here instead: \`-3\` water, \`-16\` a ladder.

			Pawn: \`CONTENTS_*\`
		`,
		ru: `
			Номер скина, которым рисуется модель, с \`0\`. Браш карты хранит здесь своё содержимое: \`-3\` — вода, \`-16\` — лестница.

			Pawn: \`CONTENTS_*\`
		`,
	},
	var_body: {
		en: `The model's body groups: which submodels are drawn, as one number.`,
		ru: `Группы тела модели: какие подмодели рисуются, одним числом.`,
	},
	var_effects: {
		en: `The entity's visual effects, for example: \`"noDraw"\` hides it, \`"dimLight"\` and \`"brightLight"\` light up around it, \`"muzzleFlash"\` flashes once.`,
		ru: `Визуальные эффекты сущности, например: \`"noDraw"\` прячет её, \`"dimLight"\` и \`"brightLight"\` освещают вокруг, \`"muzzleFlash"\` — одна вспышка.`,
	},
	var_gravity: {
		en: `The entity's gravity multiplier: \`1\` is normal, \`0.5\` is half. \`0\` also counts as normal.`,
		ru: `Множитель гравитации сущности: \`1\` — обычная, \`0.5\` — половина. \`0\` тоже считается обычной.`,
	},
	var_friction: {
		en: `The entity's friction multiplier on the ground, \`1\` is normal. For a bouncing entity (\`moveType\` \`"bounce"\`) it is how little it bounces: \`0\` bounces back at full speed.`,
		ru: `Множитель трения сущности о землю, \`1\` — обычное. У отскакивающей сущности (\`moveType\` \`"bounce"\`) — насколько слабо она отскакивает: \`0\` — отскок на полной скорости.`,
	},
	var_light_level: {
		en: `The light level where the player stands, \`0\` (dark) to \`255\`, as his client reports it every frame.`,
		ru: `Освещённость места, где стоит игрок, от \`0\` (темно) до \`255\`; клиент присылает её каждый кадр.`,
	},
	var_sequence: {
		en: `The number of the animation sequence the model plays.`,
		ru: `Номер анимации, которую играет модель.`,
	},
	var_gaitsequence: {
		en: `The number of the player's legs animation, played on top of \`sequence\`; \`0\` for none.`,
		ru: `Номер анимации ног игрока поверх \`sequence\`; \`0\` — нет.`,
	},
	var_frame: {
		en: `The playback position in the animation, \`0\` to \`255\` over the whole sequence; for a sprite, the frame number.`,
		ru: `Позиция в анимации, от \`0\` до \`255\` на всю последовательность; у спрайта — номер кадра.`,
	},
	var_animtime: {
		en: `The game time the current frame was set; the client animates from it.`,
		ru: `Игровое время, когда выставлен текущий кадр; клиент анимирует от него.`,
	},
	var_framerate: {
		en: `The animation playback rate: \`1\` is normal speed, \`0\` freezes it, negative plays backwards.`,
		ru: `Скорость анимации: \`1\` — обычная, \`0\` — стоп, отрицательная — назад.`,
	},
	var_scale: {
		en: `The sprite's draw scale: \`1\` is its normal size.`,
		ru: `Масштаб спрайта: \`1\` — обычный размер.`,
	},
	var_rendermode: {
		en: `
			The entity's render mode, one of: \`"normal"\` - drawn as it is; \`"color"\` - filled with \`renderColor\`; \`"texture"\` - translucent; \`"glow"\` - glows and shows through walls (for sprites); \`"alpha"\` - translucent, with cut-out textures; \`"additive"\` - its light adds to what is behind it. In every mode but \`"normal"\`, \`renderAmount\` is the opacity, \`0\` to \`255\`.

			Pawn: \`kRender*\`
		`,
		ru: `
			Режим отрисовки сущности, одно из: \`"normal"\` — как есть; \`"color"\` — залита цветом \`renderColor\`; \`"texture"\` — полупрозрачная; \`"glow"\` — светится и видна сквозь стены (для спрайтов); \`"alpha"\` — полупрозрачная, с вырезанными частями текстур; \`"additive"\` — её свет складывается с тем, что позади. Во всех режимах, кроме \`"normal"\`, \`renderAmount\` — непрозрачность, от \`0\` до \`255\`.

			Pawn: \`kRender*\`
		`,
	},
	var_renderamt: {
		en: `The entity's opacity in a transparent \`renderMode\`, \`0\` (invisible) to \`255\`; with the glow shell (\`renderFx\` \`"glowShell"\`), the shell's thickness.`,
		ru: `Непрозрачность сущности в прозрачном \`renderMode\`, от \`0\` (невидима) до \`255\`; со светящейся оболочкой (\`renderFx\` \`"glowShell"\`) — толщина оболочки.`,
	},
	var_rendercolor: {
		en: `The entity's render colour for \`renderMode\` and \`renderFx\`, red, green, blue from \`0\` to \`255\`: the colour of the glow shell (\`renderFx\` \`"glowShell"\`).`,
		ru: `Цвет отрисовки сущности для \`renderMode\` и \`renderFx\` — красный, зелёный, синий от \`0\` до \`255\`: цвет светящейся оболочки (\`renderFx\` \`"glowShell"\`).`,
	},
	var_renderfx: {
		en: `
			The entity's render effect, one of: \`"none"\`; \`"glowShell"\` - a coloured shell around the model (colour \`renderColor\`, thickness \`renderAmount\`); \`"pulseSlow"\`, \`"pulseFast"\`, \`"pulseSlowWide"\`, \`"pulseFastWide"\` - the opacity pulses; \`"fadeSlow"\`, \`"fadeFast"\` - fades out; \`"solidSlow"\`, \`"solidFast"\` - fades in; \`"strobeSlow"\`, \`"strobeFast"\`, \`"strobeFaster"\`, \`"flickerSlow"\`, \`"flickerFast"\` - blinks; \`"hologram"\` - a flickering hologram that fades with distance; \`"distort"\`, \`"noDissipation"\`, \`"deadPlayer"\`, \`"explode"\`, \`"clampMinScale"\`, \`"lightMultiplier"\` - for sprites, corpses and special effects.

			Pawn: \`kRenderFx*\`
		`,
		ru: `
			Эффект отрисовки сущности, одно из: \`"none"\` — нет; \`"glowShell"\` — цветная оболочка вокруг модели (цвет — \`renderColor\`, толщина — \`renderAmount\`); \`"pulseSlow"\`, \`"pulseFast"\`, \`"pulseSlowWide"\`, \`"pulseFastWide"\` — прозрачность пульсирует; \`"fadeSlow"\`, \`"fadeFast"\` — растворяется; \`"solidSlow"\`, \`"solidFast"\` — проявляется; \`"strobeSlow"\`, \`"strobeFast"\`, \`"strobeFaster"\`, \`"flickerSlow"\`, \`"flickerFast"\` — мигает; \`"hologram"\` — мерцающая голограмма, тает с расстоянием; \`"distort"\`, \`"noDissipation"\`, \`"deadPlayer"\`, \`"explode"\`, \`"clampMinScale"\`, \`"lightMultiplier"\` — для спрайтов, трупов и особых эффектов.

			Pawn: \`kRenderFx*\`
		`,
	},
	var_weapons: {
		en: `The player's weapons, as a list of weapon kinds, e.g. [\`"knife"\`, \`"usp"\`]. Writing it does not give or take weapons, and keeps the suit the HUD needs.`,
		ru: `Оружие игрока, списком видов оружия, например [\`"knife"\`, \`"usp"\`]. Запись оружия не даёт и не отбирает и сохраняет костюм, без которого нет HUD.`,
	},
	var_takedamage: {
		en: `
			The entity's vulnerability, one of: \`"no"\` - cannot be hurt (god mode); \`"yes"\` - can be hurt; \`"aim"\` - can be hurt, and aim assist targets it.

			Pawn: \`DAMAGE_*\`
		`,
		ru: `
			Уязвимость сущности, одно из: \`"no"\` — неуязвима (бессмертие); \`"yes"\` — уязвима; \`"aim"\` — уязвима, и на неё работает автоприцел.

			Pawn: \`DAMAGE_*\`
		`,
	},
	var_deadflag: {
		en: `
			The entity's stage of dying, one of: \`"alive"\`; \`"dying"\` - playing the death animation or still falling; \`"dead"\` - lying still; \`"respawnable"\` - waiting to respawn; \`"discardBody"\` - the body can go.

			Pawn: \`DEAD_*\`
		`,
		ru: `
			Стадия смерти сущности, одно из: \`"alive"\` — жива; \`"dying"\` — умирает (анимация смерти или ещё падает); \`"dead"\` — мертва, лежит; \`"respawnable"\` — ждёт возрождения; \`"discardBody"\` — тело можно убрать.

			Pawn: \`DEAD_*\`
		`,
	},
	var_view_ofs: {
		en: `The player's eye position relative to \`origin\`: \`(0, 0, 17)\` standing, \`(0, 0, 12)\` ducked.`,
		ru: `Положение глаз игрока относительно \`origin\`: \`(0, 0, 17)\` стоя, \`(0, 0, 12)\` присев.`,
	},
	var_button: {
		en: `The buttons the player holds this frame, e.g. \`"attack"\`, \`"jump"\`, \`"duck"\`, \`"use"\`.`,
		ru: `Кнопки, которые игрок держит в этом кадре, например \`"attack"\`, \`"jump"\`, \`"duck"\`, \`"use"\`.`,
	},
	var_impulse: {
		en: `The player's impulse command: \`100\` is the flashlight, \`201\` the spray. The game clears it once it has handled it.`,
		ru: `Команда impulse игрока: \`100\` — фонарик, \`201\` — спрей. Игра обнуляет её, когда обработает.`,
	},
	var_chain: {
		en: `The next entity in a list the engine or the game is building, like the result of a search in a sphere.`,
		ru: `Следующая сущность в списке, который строит движок или игра, — например, результат поиска в сфере.`,
	},
	var_dmg_inflictor: {
		en: `The entity that last hurt the player: the shooter for a bullet, a grenade, a \`trigger_hurt\`.`,
		ru: `Сущность, которая последней ранила игрока: стрелявший — для пули, граната, \`trigger_hurt\`.`,
	},
	var_enemy: {
		en: `A monster's enemy: the entity it is after.`,
		ru: `Враг монстра: сущность, за которой он охотится.`,
	},
	var_aiment: {
		en: `The entity this one follows when its \`moveType\` is \`"follow"\`: it moves along with it.`,
		ru: `Сущность, за которой следует эта при \`moveType\` \`"follow"\`: двигается вместе с ней.`,
	},
	var_owner: {
		en: `The entity's owner: a grenade's thrower, a weapon's holder. An entity does not collide with its owner.`,
		ru: `Владелец сущности: бросивший гранату, держащий оружие. Сущность не сталкивается со своим владельцем.`,
	},
	var_groundentity: {
		en: `The ground under the entity: the world (\`0\`) or another entity it stands on.`,
		ru: `Опора сущности: мир (\`0\`) или другая сущность, на которой она стоит.`,
	},
	var_spawnflags: {
		en: `The entity's spawn flags, the bits a mapper ticked in the map; what each means depends on the classname.`,
		ru: `Флаги появления сущности — биты, которые маппер отметил на карте; значение каждого зависит от classname.`,
	},
	var_flags: {
		en: `The entity's state flags, for example \`"onGround"\`, \`"ducking"\`, \`"inWater"\`, \`"frozen"\`, \`"fakeClient"\` for a bot, \`"killMe"\` to be removed.`,
		ru: `Флаги состояния сущности, например \`"onGround"\`, \`"ducking"\`, \`"inWater"\`, \`"frozen"\`, \`"fakeClient"\` у бота, \`"killMe"\` — на удаление.`,
	},
	var_colormap: {
		en: `The player's Half-Life colours, top in the low byte and bottom in the high one; for a player the engine sets it to his index.`,
		ru: `Цвета игрока Half-Life: верх в младшем байте, низ в старшем; игроку движок ставит сюда его номер.`,
	},
	var_health: {
		en: `The entity's health: a breakable breaks and a hostage dies when damage takes it to \`0\` or below, e.g. \`box.health = 50\`. A player's is his own property, a whole number that kills him at \`0\`.`,
		ru: `Здоровье сущности: разбиваемая ломается, а заложник умирает, когда урон доводит его до \`0\` или ниже, например \`box.health = 50\`. У игрока это его собственное свойство — целое число, при \`0\` он умирает.`,
	},
	var_max_health: {
		en: `The entity's maximum health: healing stops at it. A player gets his spawn health here, \`100\`.`,
		ru: `Максимальное здоровье сущности: лечение на нём останавливается. Игроку сюда ставится здоровье при появлении, \`100\`.`,
	},
	var_teleport_time: {
		en: `The player's remaining jump out of water, in milliseconds.`,
		ru: `Остаток прыжка игрока из воды, в миллисекундах.`,
	},
	var_armorvalue: {
		en: `The entity's armour points, \`0\` to \`100\` in a normal game. The kind of armour is in \`kevlar\`.`,
		ru: `Очки брони сущности, от \`0\` до \`100\` в обычной игре. Вид брони — в \`kevlar\`.`,
	},
	var_waterlevel: {
		en: `The entity's depth in water, one of: \`"none"\` - out of the water; \`"feet"\` - feet in; \`"waist"\` - in to the waist; \`"head"\` - the head under.`,
		ru: `Глубина погружения сущности, одно из: \`"none"\` — не в воде; \`"feet"\` — ноги в воде; \`"waist"\` — по пояс; \`"head"\` — с головой.`,
	},
	var_watertype: {
		en: `
			The contents the entity is in, one of: \`"empty"\` when it is not in a liquid, \`"water"\`, \`"slime"\`, \`"lava"\`. The other names (\`"solid"\`, \`"sky"\`, \`"ladder"\`, \`"current0"\` to \`"currentDown"\`, ...) are what a point of the map holds, not a liquid.

			Pawn: \`CONTENTS_*\`
		`,
		ru: `
			Среда, в которой находится сущность, одно из: \`"empty"\`, когда она не в жидкости, \`"water"\`, \`"slime"\`, \`"lava"\`. Остальные имена (\`"solid"\`, \`"sky"\`, \`"ladder"\`, с \`"current0"\` по \`"currentDown"\`, ...) — то, что бывает в точке карты, а не жидкость.

			Pawn: \`CONTENTS_*\`
		`,
	},
	var_target: {
		en: `The entity's target: the \`targetName\` of the entities it fires when it triggers, like a button's door.`,
		ru: `Цель сущности: \`targetName\` сущностей, которые она запускает при срабатывании, — например, дверь у кнопки.`,
	},
	var_targetname: {
		en: `The entity's own name in the map, the one other entities' target points at.`,
		ru: `Собственное имя сущности на карте, на которое указывает target других.`,
	},
	var_netname: {
		en: `The player's name as the engine last set it; on a map entity the meaning depends on the classname.`,
		ru: `Имя игрока, как его последним записал движок; у сущности карты смысл зависит от classname.`,
	},
	var_message: {
		en: `The entity's text, like a \`game_text\`'s or \`env_message\`'s; in \`worldspawn\`, the map's title.`,
		ru: `Текст сущности — у \`game_text\` или \`env_message\`; у \`worldspawn\` — название карты.`,
	},
	var_dmg_take: {
		en: `The damage the player took since the HUD was last told; the game zeroes it after the damage indicator is sent.`,
		ru: `Урон, полученный игроком с последнего обновления HUD; игра обнуляет его, отправив индикатор урона.`,
	},
	var_dmg_save: {
		en: `The damage the player's armour absorbed since the HUD was last told; zeroed with \`damageTaken\`.`,
		ru: `Урон, поглощённый бронёй игрока с последнего обновления HUD; обнуляется вместе с \`damageTaken\`.`,
	},
	var_dmg: {
		en: `The damage the entity deals: a grenade's blast, a \`trigger_hurt\`'s hit, a door that crushes.`,
		ru: `Урон, который наносит сущность: взрыв гранаты, удар \`trigger_hurt\`, дверь, которая давит.`,
	},
	var_dmgtime: {
		en: `A game time mark for damage over time and for when a grenade blows up; the meaning depends on the entity.`,
		ru: `Отметка игрового времени для урона во времени и для взрыва гранаты; смысл зависит от сущности.`,
	},
	var_noise: {
		en: `A sound the entity plays, as a file path: a door's moving sound.`,
		ru: `Звук сущности, путь к файлу: например, звук движущейся двери.`,
	},
	var_noise1: {
		en: `A second sound the entity plays, as a file path: a door's stop sound.`,
		ru: `Второй звук сущности, путь к файлу: например, звук остановки двери.`,
	},
	var_noise2: {
		en: `A third sound the entity plays, as a file path.`,
		ru: `Третий звук сущности, путь к файлу.`,
	},
	var_noise3: {
		en: `A fourth sound the entity plays, as a file path.`,
		ru: `Четвёртый звук сущности, путь к файлу.`,
	},
	var_speed: {
		en: `The speed of a door, platform or train, units per second.`,
		ru: `Скорость двери, платформы или поезда, единиц в секунду.`,
	},
	var_air_finished: {
		en: `The game time the player under water runs out of air and starts to drown; the game pushes it forward while his head is above water.`,
		ru: `Игровое время, когда у игрока под водой кончится воздух и он начнёт тонуть; пока голова над водой, игра отодвигает его.`,
	},
	var_pain_finished: {
		en: `The game time of the player's next pain from drowning or a \`trigger_hurt\`; no new pain until then.`,
		ru: `Игровое время следующей боли игрока от утопления или \`trigger_hurt\`; до него новой нет.`,
	},
	var_radsuit_finished: {
		en: `The game time a training-map timer runs out; nothing else in CS reads it.`,
		ru: `Игровое время, когда истечёт таймер карты-тренировки; больше в CS его никто не читает.`,
	},
	var_pContainingEntity: {
		en: `The entity these fields belong to — the entity itself.`,
		ru: `Сущность, которой принадлежат эти поля, — она сама.`,
	},
	var_playerclass: {
		en: `A mark of a glass \`func_breakable\`: \`1\` lets the client stick decals to it. Players in CS do not use it.`,
		ru: `Отметка стеклянного \`func_breakable\`: с \`1\` клиент рисует на нём декали. У игроков в CS не используется.`,
	},
	var_maxspeed: {
		en: `The player's top running speed, units per second: \`250\` with a knife, \`221\` with an AK-47. The game resets it when he switches weapons.`,
		ru: `Предельная скорость бега игрока, единиц в секунду: \`250\` с ножом, \`221\` с AK-47. Игра сбрасывает её при смене оружия.`,
	},
	var_fov: {
		en: `The entity's field of view in degrees. On a player \`fov\` is his own, which the game zooms by and writes here too.`,
		ru: `Поле зрения сущности в градусах. У игрока \`fov\` — своё, по которому игра приближает прицел и которое пишет и сюда.`,
	},
	var_weaponanim: {
		en: `The number of the first-person weapon animation last played.`,
		ru: `Номер последней сыгранной анимации оружия от первого лица.`,
	},
	var_pushmsec: {
		en: `A player value sent to the client; CS itself does not set it.`,
		ru: `Значение игрока, которое уходит клиенту; сама CS его не ставит.`,
	},
	var_bInDuck: {
		en: `The player's ducking mark: \`1\` while he is going down into a duck, before he is fully crouched.`,
		ru: `Отметка приседания игрока: \`1\`, пока он приседает и ещё не сел полностью.`,
	},
	var_flTimeStepSound: {
		en: `The time until the player's next footstep sound, in milliseconds.`,
		ru: `Время до следующего звука шага игрока, в миллисекундах.`,
	},
	var_flSwimTime: {
		en: `The time until the player's next swimming sound, in milliseconds.`,
		ru: `Время до следующего звука плавания игрока, в миллисекундах.`,
	},
	var_flDuckTime: {
		en: `The player's duck in progress, in milliseconds: the engine starts it at \`1000\` and counts down.`,
		ru: `Приседание игрока в процессе, в миллисекундах: движок начинает с \`1000\` и отсчитывает вниз.`,
	},
	var_iStepLeft: {
		en: `The foot of the player's next footstep sound; it flips every step.`,
		ru: `Нога для следующего звука шага игрока; меняется с каждым шагом.`,
	},
	var_flFallVelocity: {
		en: `The player's falling speed, units per second, positive downwards; fall damage is worked out from it on landing.`,
		ru: `Скорость падения игрока, единиц в секунду, вниз положительная; по ней при приземлении считается урон.`,
	},
	var_gamestate: {
		en: `The player's shield state: \`0\` while the shield is up and takes hits, \`1\` while it is not.`,
		ru: `Состояние щита игрока: \`0\` — щит поднят и принимает попадания, \`1\` — нет.`,
	},
	var_oldbuttons: {
		en: `The buttons the player held the frame before: compare with buttons to see what he just pressed.`,
		ru: `Кнопки, которые игрок держал в прошлом кадре: сравните с buttons, чтобы понять, что он только что нажал.`,
	},
	var_groupinfo: {
		en: `The entity's group bits: once set, traces and what is sent to a player skip entities whose groups do not match.`,
		ru: `Биты групп сущности: если заданы, трассировки и то, что отправляется игроку, пропускают сущности из других групп.`,
	},
	var_iuser1: freeEntity(
		`On a player the game keeps the spectator mode here; read it by name as \`observerMode\`.`,
		`У игрока здесь режим наблюдения, его ставит игра; по имени он читается как \`observerMode\`.`,
	),
	var_iuser2: freeEntity(
		`On a player the game keeps here the index of the player he spectates (\`0\` when roaming).`,
		`У игрока здесь номер того, за кем он наблюдает (\`0\` в свободном полёте); его ставит игра.`,
	),
	var_iuser3: freeEntity(
		`On a player the field is taken: the death camera keeps the killer's index here, and ReGameDLL reads movement locks from its bits (\`16\` no ducking, \`32\` no ladders, \`64\` no jumping, \`128\` no double duck).`,
		`У игрока поле занято: камера смерти держит здесь номер убийцы, а ReGameDLL читает из его битов запреты движения (\`16\` — не приседать, \`32\` — не лазить по лестницам, \`64\` — не прыгать, \`128\` — без двойного приседания).`,
	),
	var_iuser4: freeEntity(
		`On a player the game overwrites the field every frame: \`1\` while he stands on a vehicle, \`0\` otherwise.`,
		`У игрока игра перезаписывает поле каждый кадр: \`1\`, пока он стоит на транспорте, иначе \`0\`.`,
	),
	// player.observerMode: var_iuser1, read by name on a player.
	observerMode: {
		en: `
			The player's spectator mode, one of: \`"none"\` - not spectating; \`"chaseLocked"\` - a camera behind the target that turns with him; \`"chaseFree"\` - a camera behind the target that turns freely; \`"roaming"\` - flies freely; \`"inEye"\` - first person, through the target's eyes; \`"mapFree"\` - the overview map, moving freely; \`"mapChase"\` - the overview map, following the target. Setting a mode switches his camera as the game does when he picks it: onto someone he may watch, \`"roaming"\` when there is nobody; the target is iuser2. Setting \`"none"\` only clears the field: the game ends spectating when he spawns.

			Pawn: \`OBS_*\`, \`rg_set_observer_mode\`
		`,
		ru: `
			Режим наблюдения игрока, одно из: \`"none"\` — не наблюдает; \`"chaseLocked"\` — камера за целью, поворачивается вместе с ней; \`"chaseFree"\` — камера за целью, поворачивается свободно; \`"roaming"\` — свободный полёт; \`"inEye"\` — от первого лица, глазами цели; \`"mapFree"\` — карта, свободно; \`"mapChase"\` — карта за целью. Запись режима переключает камеру так же, как игра, когда он выбирает режим сам: на того, за кем ему можно наблюдать, или \`"roaming"\`, если наблюдать не за кем; цель — iuser2. Запись \`"none"\` только очищает поле: наблюдение заканчивает игра, когда он появляется.

			Pawn: \`OBS_*\`, \`rg_set_observer_mode\`
		`,
	},
	var_fuser1: freeEntity(
		`On a player ReGameDLL zeroes the field, along with fuser2 and fuser3, when it resets his stamina.`,
		`У игрока ReGameDLL обнуляет поле вместе с fuser2 и fuser3, когда сбрасывает выносливость.`,
	),
	var_fuser2: freeEntity(
		`On a player the field is the slowdown after a jump, in milliseconds: set to about \`1316\` on a jump and counted down.`,
		`У игрока здесь замедление после прыжка, в миллисекундах: при прыжке ставится около \`1316\` и отсчитывается вниз.`,
	),
	var_fuser3: freeEntity(
		`On a player ReGameDLL multiplies his movement by the field while \`+speed\` is held (\`0\` is off); in \`noclip\` and spectating it is the acceleration.`,
		`У игрока ReGameDLL умножает на поле движение, пока зажат \`+speed\` (\`0\` — выключено); в \`noclip\` и наблюдении это ускорение.`,
	),
	var_fuser4: free,
	var_vuser1: free,
	var_vuser2: free,
	var_vuser3: free,
	var_vuser4: free,
	var_euser1: free,
	var_euser2: free,
	var_euser3: free,
	var_euser4: free,

	// CBaseEntity: members a player has because every game entity has them.
	currentammo: {
		en: `The player's Half-Life ammo counter; the game does not use it.`,
		ru: `Счётчик патронов игрока из Half-Life; игра его не использует.`,
	},
	maxammo_buckshot: maxAmmo(`buckshot`),
	ammo_buckshot: ammoCopy(`buckshot`, `M3, XM1014`),
	maxammo_9mm: maxAmmo(`9mm`),
	ammo_9mm: ammoCopy(`9mm`, `Glock, Elites, MP5, TMP`),
	maxammo_556nato: maxAmmo(`5.56mm`),
	ammo_556nato: ammoCopy(`5.56mm`, `M4A1, FAMAS, Galil, AUG, SG552, SG550`),
	maxammo_556natobox: maxAmmo(`5.56mm box`),
	ammo_556natobox: ammoCopy(`5.56mm box`, `M249`),
	maxammo_762nato: maxAmmo(`7.62mm`),
	ammo_762nato: ammoCopy(`7.62mm`, `AK-47, Scout, G3SG1`),
	maxammo_45acp: maxAmmo(`.45 ACP`),
	ammo_45acp: ammoCopy(`.45 ACP`, `USP, MAC-10, UMP45`),
	maxammo_50ae: maxAmmo(`.50 AE`),
	ammo_50ae: ammoCopy(`.50 AE`, `Desert Eagle`),
	maxammo_338mag: maxAmmo(`.338 Magnum`),
	ammo_338mag: ammoCopy(`.338 Magnum`, `AWP`),
	maxammo_57mm: maxAmmo(`5.7mm`),
	ammo_57mm: ammoCopy(`5.7mm`, `P90, Five-seveN`),
	maxammo_357sig: maxAmmo(`.357 SIG`),
	ammo_357sig: ammoCopy(`.357 SIG`, `P228`),
	has_disconnected: {
		en: `The player's \`"left"\` flag: \`true\` once he has left the server (or the bot was kicked), until someone takes the slot.`,
		ru: `Отметка ухода игрока: \`true\`, когда он ушёл с сервера (или бота выгнали), пока слот не займёт кто-то другой.`,
	},
	// Only a weapon uses these three.
	m_flStartThrow: {
		en: `The game time a grenade's pin was pulled (\`0\` when not); a player has the field but does not use it.`,
		ru: `Игровое время, когда у гранаты выдернута чека (\`0\` — не выдернута); у игрока поле есть, но не используется.`,
	},
	m_flReleaseThrow: {
		en: `The game time the attack button was let go on a grenade (\`-1\` before the pin is pulled); unused on a player.`,
		ru: `Игровое время, когда у гранаты отпущена кнопка атаки (\`-1\`, пока чека не выдернута); у игрока не используется.`,
	},
	m_iSwing: {
		en: `A knife's swing counter, which picks the left or right slash animation; unused on a player.`,
		ru: `Счётчик взмахов ножа, по которому выбирается анимация удара слева или справа; у игрока не используется.`,
	},

	// CBaseAnimating.
	m_flGroundSpeed: {
		en: `The ground speed of the current animation: how fast it moves the model, units per second.`,
		ru: `Скорость текущей анимации по земле: насколько быстро она двигает модель, единиц в секунду.`,
	},
	m_flLastEventCheck: {
		en: `The game time the animation's events (footsteps, sounds) were last checked.`,
		ru: `Игровое время последней проверки событий анимации (шаги, звуки).`,
	},
	m_fSequenceFinished: {
		en: `The \`"finished"\` flag of the current animation: \`true\` once it has played to its end.`,
		ru: `Флаг конца текущей анимации: \`true\`, когда она доиграла до конца.`,
	},
	m_fSequenceLoops: {
		en: `The \`"loops"\` flag of the current animation: \`true\` if it loops.`,
		ru: `Флаг зацикленности текущей анимации: \`true\`, если она зациклена.`,
	},

	// CBaseMonster: a player is a monster to the game, so these are his too.
	m_LastHitGroup: {
		en: `
			The body part the last bullet hit, one of: \`"generic"\` - no particular part; \`"head"\`, \`"chest"\`, \`"stomach"\`, \`"leftArm"\`, \`"rightArm"\`, \`"leftLeg"\`, \`"rightLeg"\`; \`"shield"\`.

			Pawn: \`HITGROUP_*\`
		`,
		ru: `
			Часть тела, куда попала последняя пуля, одно из: \`"generic"\` — без уточнения; \`"head"\`, \`"chest"\`, \`"stomach"\`, \`"leftArm"\`, \`"rightArm"\`, \`"leftLeg"\`, \`"rightLeg"\`; \`"shield"\` — щит.

			Pawn: \`HITGROUP_*\`
		`,
	},
	m_bitsDamageType: {
		en: `The kinds of damage the player took since the HUD was last told, e.g. \`"fall"\`, \`"bullet"\`, \`"burn"\`; the game clears all but the lasting ones after the damage indicator is sent.`,
		ru: `Виды урона, полученного игроком с последнего обновления HUD, например \`"fall"\`, \`"bullet"\`, \`"burn"\`; отправив индикатор урона, игра оставляет только длительные.`,
	},
	m_flNextAttack: {
		en: `The player's delay before any weapon can be used, in seconds; it counts down to \`0\` by itself. The game sets it while he switches weapons or reloads.`,
		ru: `Задержка игрока до использования любого оружия, в секундах; сама отсчитывается до \`0\`. Игра ставит её при смене оружия и перезарядке.`,
	},
	m_flFieldOfView: {
		en: `A monster's field of view, as the cosine of half the cone: \`0.5\` sees 120 degrees wide.`,
		ru: `Поле зрения монстра как косинус половины конуса: \`0.5\` — обзор 120 градусов.`,
	},
	m_bloodColor: {
		en: `
			The colour of the entity's blood, one of: \`"red"\`; \`"yellow"\`; \`"none"\` - does not bleed.

			Pawn: \`BLOOD_COLOR_*\`, \`DONT_BLEED\`
		`,
		ru: `
			Цвет крови сущности, одно из: \`"red"\` — красная; \`"yellow"\` — жёлтая; \`"none"\` — не кровоточит.

			Pawn: \`BLOOD_COLOR_*\`, \`DONT_BLEED\`
		`,
	},

	// CBasePlayer.
	random_seed: {
		en: `The random seed of the player's current command; bullet spread is drawn from it, so the client can predict it.`,
		ru: `Случайное зерно текущей команды игрока; из него берётся разброс пуль, чтобы клиент мог его предсказать.`,
	},
	m_usPlayerBleed: {
		en: `The player's bleeding event; the game does not use it.`,
		ru: `Событие кровотечения игрока; игра его не использует.`,
	},
	m_hObserverTarget: {
		en: `The player this spectator is watching.`,
		ru: `Игрок, за которым наблюдает этот зритель.`,
	},
	m_flNextObserverInput: {
		en: `The game time when the spectator's next button press is taken; presses are 0.2 seconds apart.`,
		ru: `Игровое время, когда зрителю засчитают следующее нажатие кнопки; нажатия идут не чаще раза в 0.2 секунды.`,
	},
	m_iObserverWeapon: {
		en: `The weapon of the watched player, as last shown to this spectator, by its number.`,
		ru: `Номер оружия наблюдаемого игрока, каким его последний раз показали зрителю.`,
	},
	m_iObserverC4State: {
		en: `The watched player's bomb state, as last shown to this spectator.`,
		ru: `Состояние бомбы у наблюдаемого игрока, каким его последний раз показали зрителю.`,
	},
	m_bObserverHasDefuser: {
		en: `\`true\` if the watched player has a defuse kit, as last shown to this spectator.`,
		ru: `\`true\`, если у наблюдаемого игрока есть набор сапёра, — как последний раз показали зрителю.`,
	},
	m_iObserverLastMode: {
		en: `
			The spectator mode the player chose last, restored when he spectates again - the names \`observerMode\` has, one of: \`"chaseLocked"\`, \`"chaseFree"\`, \`"roaming"\`, \`"inEye"\`, \`"mapFree"\`, \`"mapChase"\`.

			Pawn: \`OBS_*\`
		`,
		ru: `
			Режим наблюдения, который игрок выбрал последним; восстанавливается, когда он снова наблюдает. Имена те же, что у \`observerMode\`, одно из: \`"chaseLocked"\`, \`"chaseFree"\`, \`"roaming"\`, \`"inEye"\`, \`"mapFree"\`, \`"mapChase"\`.

			Pawn: \`OBS_*\`
		`,
	},
	m_flFlinchTime: {
		en: `The game time when a hostage stops flinching from a hit; not used on a player.`,
		ru: `Игровое время, когда заложник перестанет вздрагивать от удара; у игрока не используется.`,
	},
	m_bHighDamage: {
		en: `\`true\` if the player's last hit was heavy (over \`60\` to the head, over \`20\` elsewhere), for the pain animation.`,
		ru: `\`true\`, если последнее попадание в игрока было сильным (больше \`60\` в голову, больше \`20\` в другое место), — для анимации боли.`,
	},
	m_flVelocityModifier: {
		en: `The player's speed multiplier after a hit: below \`1\` he is slowed, and on the ground it climbs back to \`1\` by \`0.01\` a frame.`,
		ru: `Множитель скорости игрока после попадания: меньше \`1\` — игрок замедлен; на земле множитель возвращается к \`1\` по \`0.01\` за кадр.`,
	},
	// player.fov: a player's own field of view, over the entvar of that name.
	m_iFOV: {
		en: `The player's field of view in degrees: \`90\` is normal, \`40\` and \`10\` through a sniper scope. Setting it widens or narrows his view - \`110\` shows more - until the game sets it again: at spawn, when he draws a weapon, when he zooms.`,
		ru: `Поле зрения игрока в градусах: \`90\` — обычное, \`40\` и \`10\` — в снайперский прицел. Запись расширяет или сужает обзор — \`110\` показывает больше, — пока игра не поставит своё: при появлении, когда он достаёт оружие, когда приближает прицел.`,
	},
	m_flFallVelocity: {
		en: `The player's falling speed, units per second, positive downwards: the one the game works fall damage out from on landing. Setting it sets the entity's \`fallVelocity\` too - \`player.fallVelocity = 0\` lands him without damage.`,
		ru: `Скорость падения игрока, единиц в секунду, вниз положительная: по ней игра считает урон при приземлении. Запись ставит и \`fallVelocity\` сущности — \`player.fallVelocity = 0\` приземляет без урона.`,
	},
	m_iLastZoom: {
		en: `The player's zoom (field of view) to go back to after a sniper rifle reloads or fires.`,
		ru: `Зум игрока (поле зрения), к которому вернуться после перезарядки или выстрела снайперской винтовки.`,
	},
	m_bResumeZoom: {
		en: `\`true\` if the player's zoom comes back after the shot.`,
		ru: `\`true\`, если зум игрока вернётся после выстрела.`,
	},
	m_flEjectBrass: {
		en: `The game time when the player's weapon throws out its next shell casing (AWP, Scout, shotguns); \`0\` for none.`,
		ru: `Игровое время, когда из оружия игрока вылетит следующая гильза (AWP, Scout, дробовики); \`0\` — не вылетит.`,
	},
	m_iKevlar: {
		en: `
			The player's armour kind, one of: \`"none"\`; \`"vest"\`; \`"vestHelmet"\` - a vest and a helmet. Setting it shows the helmet on his HUD, or takes it off.

			Pawn: \`ARMOR_*\`
		`,
		ru: `
			Вид брони игрока, одно из: \`"none"\` — нет; \`"vest"\` — жилет; \`"vestHelmet"\` — жилет и шлем. Запись показывает шлем на его HUD или убирает его.

			Pawn: \`ARMOR_*\`
		`,
	},
	m_bNotKilled: {
		en: `\`true\` if the player survived the last round and keeps his equipment; with \`false\` he gets the default one at spawn.`,
		ru: `\`true\`, если игрок пережил прошлый раунд и сохраняет снаряжение; при \`false\` он появится со стандартным.`,
	},
	m_iAccount: {
		en: `The player's money: \`800\` at the start. Setting it shows the new amount on his HUD at once, flashing: \`player.money += 500\`.`,
		ru: `Деньги игрока: \`800\` в начале. Запись сразу показывает новую сумму на его HUD, с миганием: \`player.money += 500\`.`,
	},
	m_bHasPrimary: {
		en: `\`true\` if the player carries a primary weapon (a rifle, a shotgun, a submachine gun).`,
		ru: `\`true\`, если у игрока есть основное оружие (винтовка, дробовик, пистолет-пулемёт).`,
	},
	m_flDeathThrowTime: {
		en: `The player's death throw timer; the game only ever sets it to \`0\`.`,
		ru: `Таймер отброса тела игрока при смерти; игра его только обнуляет.`,
	},
	m_iThrowDirection: {
		en: `The way the player's body is thrown when he dies, one of: \`"none"\` - not thrown; \`"forward"\`; \`"backward"\`; \`"hitVelocity"\` - away from the attacker and up; \`"hitVelocityMinusAir"\` - away from the attacker, without the lift; \`"bomb"\` - by the bomb's blast; \`"grenade"\` - by a grenade's blast.`,
		ru: `Направление, куда отбросит тело игрока при смерти, одно из: \`"none"\` — никуда; \`"forward"\` — вперёд; \`"backward"\` — назад; \`"hitVelocity"\` — от атакующего и вверх; \`"hitVelocityMinusAir"\` — от атакующего, без подброса; \`"bomb"\` — взрывом бомбы; \`"grenade"\` — взрывом гранаты.`,
	},
	m_flLastTalk: {
		en: `The game time of the player's last chat message; a message within 0.66 seconds of it is ignored.`,
		ru: `Игровое время последнего сообщения игрока в чат; сообщение раньше чем через 0.66 секунды после него игра пропускает.`,
	},
	m_bJustConnected: {
		en: `\`true\` from the player's connecting until he first gets into the game.`,
		ru: `\`true\` с подключения игрока до его первого входа в игру.`,
	},
	m_bContextHelp: {
		en: `The player's context help flag: set to \`true\` on connect, never read by the game.`,
		ru: `Флаг контекстной помощи игрока: ставится в \`true\` при подключении, игра его не читает.`,
	},
	m_iJoiningState: {
		en: `
			The player's stage of joining, one of: \`"joined"\` - in the game; \`"showMotd"\` - the MOTD is shown; \`"readingMotd"\` - reading the MOTD; \`"showTeamSelect"\` - the team menu is shown; \`"pickingTeam"\` - picking a team; \`"getIntoGame"\` - getting into the game.

			Pawn: \`JoinState\`
		`,
		ru: `
			Стадия входа игрока в игру, одно из: \`"joined"\` — в игре; \`"showMotd"\` — показан MOTD; \`"readingMotd"\` — читает MOTD; \`"showTeamSelect"\` — показано меню команды; \`"pickingTeam"\` — выбирает команду; \`"getIntoGame"\` — входит в игру.

			Pawn: \`JoinState\`
		`,
	},
	m_pIntroCamera: {
		en: `The camera (\`trigger_camera\`) a player still choosing a team looks through.`,
		ru: `Камера (\`trigger_camera\`), через которую смотрит игрок, пока выбирает команду.`,
	},
	m_fIntroCamTime: {
		en: `The game time when the player's intro view switches to the next camera (every 6 seconds).`,
		ru: `Игровое время, когда вступительный вид игрока переключится на следующую камеру (каждые 6 секунд).`,
	},
	m_fLastMovement: {
		en: `The game time when the player last moved or pressed a button; the kick for idling counts from it.`,
		ru: `Игровое время, когда игрок последний раз двигался или нажимал кнопку; от него считается кик за бездействие.`,
	},
	m_bMissionBriefing: {
		en: `\`true\` while the map's briefing is on the player's screen.`,
		ru: `\`true\`, пока у игрока на экране брифинг карты.`,
	},
	m_bTeamChanged: {
		en: `\`true\` if the player has changed team during this round.`,
		ru: `\`true\`, если игрок сменил команду в этом раунде.`,
	},
	m_iModelName: {
		en: `
			The player's model, one of: \`"urban"\`, \`"gsg9"\`, \`"gign"\`, \`"sas"\`, \`"vip"\`, \`"spetsnaz"\` - the counter-terrorists'; \`"terror"\`, \`"leet"\`, \`"arctic"\`, \`"guerilla"\`, \`"militia"\` - the terrorists'; \`"unassigned"\` before he picks one; \`"auto"\` - the game picks.

			Pawn: \`MODEL_*\`
		`,
		ru: `
			Модель игрока, одно из: \`"urban"\`, \`"gsg9"\`, \`"gign"\`, \`"sas"\`, \`"vip"\`, \`"spetsnaz"\` — спецназа; \`"terror"\`, \`"leet"\`, \`"arctic"\`, \`"guerilla"\`, \`"militia"\` — террористов; \`"unassigned"\` — пока не выбрана; \`"auto"\` — выбирает игра.

			Pawn: \`MODEL_*\`
		`,
	},
	m_iTeamKills: {
		en: `The number of teammates the player has killed; with \`mp_autokick\` he is kicked at \`mp_max_teamkills\`.`,
		ru: `Число союзников, убитых игроком; при \`mp_autokick\` его выгоняют, когда оно доходит до \`mp_max_teamkills\`.`,
	},
	m_iIgnoreGlobalChat: {
		en: `
			The chat the player hides (the \`ignoremsg\` command), one of: \`"none"\` - nobody's; \`"enemy"\` - the enemy's; \`"all"\` - everyone's.

			Pawn: \`IGNOREMSG_*\`
		`,
		ru: `
			Чат, который игрок скрывает (команда \`ignoremsg\`), одно из: \`"none"\` — ничей; \`"enemy"\` — врагов; \`"all"\` — всех.

			Pawn: \`IGNOREMSG_*\`
		`,
	},
	m_bHasNightVision: {
		en: `\`true\` if the player owns night vision goggles. Setting it gives or takes them, and his buy menu knows.`,
		ru: `\`true\`, если у игрока есть прибор ночного видения. Запись выдаёт или забирает его, и меню покупки это знает.`,
	},
	m_bNightVisionOn: {
		en: `\`true\` while the player's night vision is switched on. Setting it switches his screen to night vision or back.`,
		ru: `\`true\`, пока прибор ночного видения игрока включён. Запись включает или выключает ночное видение на его экране.`,
	},
	m_flIdleCheckTime: {
		en: `The game time of the player's next idle check; checks are 5 seconds apart.`,
		ru: `Игровое время следующей проверки игрока на бездействие; проверки идут раз в 5 секунд.`,
	},
	m_flRadioTime: {
		en: `The game time when the player can use the radio again.`,
		ru: `Игровое время, когда игрок снова сможет пользоваться радио.`,
	},
	m_iRadioMessages: {
		en: `The number of radio messages the player has left until he spawns again (\`mp_radio_maxinround\`, \`60\` by default); at \`0\` his radio is silent.`,
		ru: `Число радиосообщений, оставшихся у игрока до следующего появления (\`mp_radio_maxinround\`, по умолчанию \`60\`); на \`0\` его радио молчит.`,
	},
	m_bIgnoreRadio: {
		en: `\`true\` if the player does not hear radio messages (the ignorerad command).`,
		ru: `\`true\`, если игрок не слышит радио (команда ignorerad).`,
	},
	m_bHasC4: {
		en: `\`true\` while the player carries the bomb.`,
		ru: `\`true\`, пока игрок несёт бомбу.`,
	},
	m_bHasDefuser: {
		en: `\`true\` if the player has a defuse kit. Setting it gives or takes the kit as the game does: on his model, its icon on his HUD and in his buy menu.`,
		ru: `\`true\`, если у игрока есть набор сапёра. Запись выдаёт или забирает набор, как это делает игра: на модели, значком на HUD и в меню покупки.`,
	},
	m_bKilledByBomb: {
		en: `\`true\` if the bomb's explosion killed the player.`,
		ru: `\`true\`, если игрока убил взрыв бомбы.`,
	},
	m_vBlastVector: {
		en: `The direction from an explosion to the player, saved on a blast hit to throw the body if he dies.`,
		ru: `Направление от взрыва к игроку; запоминается при попадании взрывом, чтобы отбросить тело, если игрок умрёт.`,
	},
	m_bKilledByGrenade: {
		en: `\`true\` if a grenade killed the player.`,
		ru: `\`true\`, если игрока убила граната.`,
	},
	m_flDisplayHistory: {
		en: `The one-time hints the player has already been shown, one bit each.`,
		ru: `Разовые подсказки, уже показанные игроку, по биту на каждую.`,
	},
	m_iMenu: {
		en: `
			The old-style menu the game has open for the player, one of: \`"none"\`; \`"team"\` - the team menu, \`"teamInGame"\` - the same, once in the game; \`"appearance"\` - the model menu; \`"buy"\`, \`"buyPistol"\`, \`"buyRifle"\`, \`"buyMachineGun"\`, \`"buyShotgun"\`, \`"buySubMachineGun"\`, \`"buyItem"\` - the buy menus; \`"radio1"\`, \`"radio2"\`, \`"radio3"\` - the radio menus; \`"clientBuy"\` - the buy menu the client draws itself.

			Pawn: \`Menu_*\`
		`,
		ru: `
			Старое меню, которое игра открыла игроку, одно из: \`"none"\` — никакое; \`"team"\` — меню команды, \`"teamInGame"\` — оно же в игре; \`"appearance"\` — меню модели; \`"buy"\`, \`"buyPistol"\`, \`"buyRifle"\`, \`"buyMachineGun"\`, \`"buyShotgun"\`, \`"buySubMachineGun"\`, \`"buyItem"\` — меню закупки; \`"radio1"\`, \`"radio2"\`, \`"radio3"\` — меню радио; \`"clientBuy"\` — меню закупки, которое рисует сам клиент.

			Pawn: \`Menu_*\`
		`,
	},
	m_iChaseTarget: {
		en: `The player's chase target: set to \`1\` on spawn, never read by the game.`,
		ru: `Цель слежения игрока: ставится в \`1\` при появлении, игра её не читает.`,
	},
	m_fCamSwitch: {
		en: `The player's camera switch: set to \`0\` on spawn, never read by the game.`,
		ru: `Переключатель камеры игрока: обнуляется при появлении, игра его не читает.`,
	},
	m_bEscaped: {
		en: `\`true\` if the player escaped (on an escape map) or, as the VIP, got out.`,
		ru: `\`true\`, если игрок сбежал (на карте побега) или, будучи VIP, спасся.`,
	},
	m_bIsVIP: {
		en: `\`true\` if the player is the VIP on an as_ map.`,
		ru: `\`true\`, если игрок — VIP на карте as_.`,
	},
	m_szNewName: {
		en: `The name the player takes at his next respawn: a name he changed while dead waits here.`,
		ru: `Имя, которое игрок получит при следующем возрождении: имя, сменённое мёртвым, ждёт здесь.`,
	},
	m_szTextureName: {
		en: `The name of the texture the player last stood on, which his footsteps sound by.`,
		ru: `Имя текстуры, на которой игрок стоял последней; по ней звучат его шаги.`,
	},
	m_SbarString0: {
		en: `The status bar text the game last sent the player - the line that names whom he aims at, as a format his client fills in.`,
		ru: `Текст строки состояния, который игра последним отправила игроку, — строка о том, в кого он целится, в виде формата, который заполняет его клиент.`,
	},
	m_szAnimExtention: {
		en: `The animation set the player's model holds his weapon with, e.g. \`"knife"\`, \`"rifle"\`, \`"c4"\`.`,
		ru: `Набор анимаций, с которым модель игрока держит оружие, например \`"knife"\`, \`"rifle"\`, \`"c4"\`.`,
	},
	m_autoBuyString: {
		en: `The player's autobuy list: the items his client sent for \`autobuy\`.`,
		ru: `Список автозакупки игрока: предметы, которые его клиент прислал для \`autobuy\`.`,
	},
	m_rebuyString: {
		en: `The player's rebuy list: the items his client sent for \`rebuy\`.`,
		ru: `Список повторной закупки игрока: предметы, которые его клиент прислал для \`rebuy\`.`,
	},
	m_lastLocation: {
		en: `The name of the place on the map the player was last in, which the radio and team chat name, e.g. \`"BombsiteA"\`.`,
		ru: `Название места на карте, где игрок был последним, — его называют радио и командный чат, например \`"BombsiteA"\`.`,
	},
	m_tmNextRadarUpdate: {
		en: `The game time when the player's position is next sent to his teammates' radar, once a second.`,
		ru: `Игровое время, когда позиция игрока снова уйдёт на радар союзников; раз в секунду.`,
	},
	m_vLastOrigin: {
		en: `The player's position when his teammates' radar was last updated.`,
		ru: `Позиция игрока при последнем обновлении радара союзников.`,
	},
	m_iCurrentKickVote: {
		en: `The \`userid\` of the player this one voted to kick (the \`vote\` command); \`0\` for none.`,
		ru: `\`userid\` игрока, за кик которого проголосовал этот (команда \`vote\`); \`0\` — ни за кого.`,
	},
	m_flNextVoteTime: {
		en: `The game time when the player can vote again, 3 seconds after his last vote.`,
		ru: `Игровое время, когда игрок снова сможет голосовать, — через 3 секунды после прошлого голоса.`,
	},
	m_bJustKilledTeammate: {
		en: `\`true\` if the player killed a teammate; with \`mp_tkpunish\` he is punished when the next round starts.`,
		ru: `\`true\`, если игрок убил союзника; при \`mp_tkpunish\` его накажут в начале следующего раунда.`,
	},
	m_iHostagesKilled: {
		en: `The number of hostages the player has killed; past \`mp_hostagepenalty\` the game kicks him.`,
		ru: `Число заложников, убитых игроком; сверх \`mp_hostagepenalty\` игра его выгоняет.`,
	},
	m_iMapVote: {
		en: `The number of the map the player voted for with \`votemap\`; \`0\` for none.`,
		ru: `Номер карты, за которую игрок проголосовал через \`votemap\`; \`0\` — ни за какую.`,
	},
	m_bCanShoot: {
		en: `\`false\` while the player may not fire; the game sets it to \`true\` when freeze time ends.`,
		ru: `\`false\`, пока игроку нельзя стрелять; когда кончается заморозка, игра ставит \`true\`.`,
	},
	m_flLastFired: {
		en: `The game time of the player's last shot, for his footstep and shooting animations.`,
		ru: `Игровое время последнего выстрела игрока — для анимаций шагов и стрельбы.`,
	},
	m_flLastAttackedTeammate: {
		en: `The game time when the player last hurt a teammate; the “teammate attack” message waits 0.6 seconds from it.`,
		ru: `Игровое время, когда игрок последний раз ранил союзника; сообщение об атаке союзника ждёт 0.6 секунды от него.`,
	},
	m_bHeadshotKilled: {
		en: `\`true\` if the player was killed by a headshot.`,
		ru: `\`true\`, если игрока убили в голову.`,
	},
	m_bPunishedForTK: {
		en: `\`true\` if the player was punished for a team kill this round.`,
		ru: `\`true\`, если игрок наказан за убийство союзника в этом раунде.`,
	},
	m_bReceivesNoMoneyNextRound: {
		en: `\`true\` if the player gets no round bonus next round: the game marks so the living players of a team that let the round time run out.`,
		ru: `\`true\`, если игрок не получит бонус в следующем раунде: так игра отмечает живых игроков команды, у которой истекло время раунда.`,
	},
	m_iTimeCheckAllowed: {
		en: `The game time, in whole seconds, when the timeleft command answers the player again.`,
		ru: `Игровое время в целых секундах, когда команда timeleft снова ответит игроку.`,
	},
	m_bHasChangedName: {
		en: `\`true\` if the player changed his name while dead; the new name is applied at his next spawn.`,
		ru: `\`true\`, если игрок сменил имя, будучи мёртвым; новое имя применится при следующем появлении.`,
	},
	m_bIsDefusing: {
		en: `\`true\` while the player defuses the bomb.`,
		ru: `\`true\`, пока игрок обезвреживает бомбу.`,
	},
	m_tmHandleSignals: {
		en: `The game time when the player's zones (buy zone, bomb site, rescue zone) are next checked, every half second.`,
		ru: `Игровое время следующей проверки зон игрока (зона закупки, точка бомбы, зона спасения); раз в полсекунды.`,
	},
	m_pentCurBombTarget: {
		en: `The bomb site the player stands in, or \`0\`.`,
		ru: `Точка закладки бомбы, в которой стоит игрок, или \`0\`.`,
	},
	m_iPlayerSound: {
		en: `The player's slot in the list of sounds monsters (hostages) hear.`,
		ru: `Место игрока в списке звуков, которые слышат монстры (заложники).`,
	},
	m_iTargetVolume: {
		en: `The player's loudness to monsters this frame: the louder of his body and his weapon.`,
		ru: `Громкость игрока для монстров в этом кадре — громче из шагов и оружия.`,
	},
	m_iWeaponVolume: {
		en: `The loudness of the player's last shot to monsters; it fades by itself.`,
		ru: `Громкость последнего выстрела игрока для монстров; затихает сама.`,
	},
	m_iExtraSoundTypes: {
		en: `The extra kinds of sound the player makes for monsters until \`stopExtraSoundTime\`.`,
		ru: `Дополнительные виды звука, которые игрок издаёт для монстров до \`stopExtraSoundTime\`.`,
	},
	m_iWeaponFlash: {
		en: `The brightness of the player's last muzzle flash, adding to how visible he is; it fades by itself.`,
		ru: `Яркость последней вспышки выстрела игрока — добавляется к его заметности; гаснет сама.`,
	},
	m_flStopExtraSoundTime: {
		en: `The game time when the player's \`extraSoundTypes\` is cleared.`,
		ru: `Игровое время, когда \`extraSoundTypes\` игрока сбросится.`,
	},
	m_flFlashLightTime: {
		en: `The game time when the player's flashlight battery next drains (while on) or charges (while off) by one.`,
		ru: `Игровое время, когда батарея фонарика игрока в следующий раз разрядится (включён) или зарядится (выключен) на единицу.`,
	},
	m_iFlashBattery: {
		en: `The charge of the player's flashlight, \`0\` to \`100\`. Setting it shows the new charge on his HUD.`,
		ru: `Заряд фонарика игрока, от \`0\` до \`100\`. Запись сразу показывает новый заряд на его HUD.`,
	},
	m_afButtonLast: {
		en: `The buttons the player held the frame before: \`["jump"]\`.`,
		ru: `Кнопки, которые игрок держал в прошлом кадре: \`["jump"]\`.`,
	},
	m_afButtonPressed: {
		en: `The buttons the player pressed this frame: \`["jump"]\`.`,
		ru: `Кнопки, которые игрок нажал в этом кадре: \`["jump"]\`.`,
	},
	m_afButtonReleased: {
		en: `The buttons the player let go this frame: \`["jump"]\`.`,
		ru: `Кнопки, которые игрок отпустил в этом кадре: \`["jump"]\`.`,
	},
	m_pentSndLast: {
		en: `The sound area (\`env_sound\`) whose room effect is on the player.`,
		ru: `Звуковая область (\`env_sound\`), чей эффект помещения сейчас действует на игрока.`,
	},
	m_flSndRoomtype: {
		en: `The room effect (echo) of the player's sound area, \`0\` for none.`,
		ru: `Эффект помещения (эхо) звуковой области игрока, \`0\` — нет.`,
	},
	m_flSndRange: {
		en: `The distance from the player to his sound area.`,
		ru: `Расстояние от игрока до его звуковой области.`,
	},
	m_fNewAmmo: unused(`The player's “new ammo to send” flag from Half-Life.`, `Флаг игрока «есть новые патроны для отправки» из Half-Life.`),
	m_afPhysicsFlags: {
		en: `
			The player's physics state, a list of any of: \`"onLadder"\`, \`"onTrain"\`, \`"onBarnacle"\`, \`"ducking"\` - crouching down right now, \`"using"\` - holding an object's use key, \`"observer"\` - a spectator locked in place.

			Pawn: \`PFLAG_*\`
		`,
		ru: `
			Физическое состояние игрока, список, любые из: \`"onLadder"\` — на лестнице, \`"onTrain"\` — на поезде, \`"onBarnacle"\` — схвачен барнаклом, \`"ducking"\` — приседает прямо сейчас, \`"using"\` — держит клавишу использования на объекте, \`"observer"\` — закреплённый наблюдатель.

			Pawn: \`PFLAG_*\`
		`,
	},
	m_fNextSuicideTime: {
		en: `The game time when the kill command works for the player again, a second after the last one.`,
		ru: `Игровое время, когда команда kill снова сработает для игрока, — через секунду после прошлой.`,
	},
	m_flTimeWeaponIdle: {
		en: `The player's idle timer from Half-Life; CS keeps it on the weapon (a Weapon's \`nextIdle\`) and does not use this one.`,
		ru: `Таймер покоя игрока из Half-Life; CS держит его у оружия (\`nextIdle\` у Weapon), а этот не использует.`,
	},
	m_flWallJumpTime: unused(`The player's wall-jump timer from Half-Life.`, `Таймер прыжка от стены у игрока из Half-Life.`),
	m_flSuitUpdate: {
		en: `The game time of the next HEV suit phrase (Half-Life); \`0\` for none.`,
		ru: `Игровое время следующей фразы костюма HEV (Half-Life); \`0\` — нет.`,
	},
	m_iSuitPlayNext: {
		en: `The next place in the HEV suit's phrase queue (Half-Life).`,
		ru: `Следующее место в очереди фраз костюма HEV (Half-Life).`,
	},
	m_lastDamageAmount: {
		en: `The damage the player took from the last hit.`,
		ru: `Урон, который игрок получил последним попаданием.`,
	},
	m_tbdPrev: {
		en: `The game time when damage over time (poison, burn, drowning recovery) was last applied to the player.`,
		ru: `Игровое время, когда к игроку последний раз применялся урон во времени (яд, огонь, восстановление после утопления).`,
	},
	m_flgeigerRange: {
		en: `The distance to the nearest radiation, for Half-Life's Geiger counter.`,
		ru: `Расстояние до ближайшей радиации — для счётчика Гейгера из Half-Life.`,
	},
	m_flgeigerDelay: {
		en: `The game time of the next Geiger counter update (Half-Life).`,
		ru: `Игровое время следующего обновления счётчика Гейгера (Half-Life).`,
	},
	m_igeigerRangePrev: {
		en: `The Geiger counter reading last sent to the client (Half-Life).`,
		ru: `Показание счётчика Гейгера, последним отправленное клиенту (Half-Life).`,
	},
	m_chTextureType: unused(`The type of texture under the player, for step sounds.`, `Тип текстуры под игроком — для звука шагов.`),
	m_idrowndmg: {
		en: `The health drowning has taken from the player; it is given back once he surfaces.`,
		ru: `Здоровье, которое отняло у игрока утопление; вернётся, когда игрок вынырнет.`,
	},
	m_idrownrestored: {
		en: `The part of the drowning damage already given back to the player.`,
		ru: `Часть урона от утопления, уже возвращённая игроку.`,
	},
	m_bitsHUDDamage: {
		en: `
			The kinds of damage last shown on the player's HUD, as bits; \`-1\` makes the game send them again.

			Pawn: \`DMG_*\`
		`,
		ru: `
			Виды урона, последними показанные на HUD игрока, битами; \`-1\` — игра отправит их заново.

			Pawn: \`DMG_*\`
		`,
	},
	m_fInitHUD: {
		en: `\`true\` when the player's HUD has to be reset on his next update (after a spawn).`,
		ru: `\`true\`, когда HUD игрока нужно сбросить при следующем обновлении (после появления).`,
	},
	m_fGameHUDInitialized: {
		en: `\`true\` once the player's HUD has been set up since he connected.`,
		ru: `\`true\`, когда HUD игрока настроен с момента подключения.`,
	},
	m_iTrain: {
		en: `
			The train control on the player's HUD: \`0\` off, \`1\` to \`5\` the speed notch, plus bits for \`"changed"\` and \`"active"\`.

			Pawn: \`TRAIN_*\`
		`,
		ru: `
			Управление поездом на HUD игрока: \`0\` — нет, от \`1\` до \`5\` — положение рычага, плюс биты «изменилось» и «активно».

			Pawn: \`TRAIN_*\`
		`,
	},
	m_fWeapon: {
		en: `\`false\` when the player's weapon list has to be sent again.`,
		ru: `\`false\`, когда список оружия игрока нужно отправить заново.`,
	},
	m_pTank: {
		en: `The mounted gun (\`func_tank\`) the player is using.`,
		ru: `Стационарное оружие (\`func_tank\`), которым пользуется игрок.`,
	},
	m_fDeadTime: {
		en: `The game time of the player's death.`,
		ru: `Игровое время смерти игрока.`,
	},
	m_fNoPlayerSound: {
		en: `\`true\` if monsters do not hear the player.`,
		ru: `\`true\`, если монстры не слышат игрока.`,
	},
	m_fLongJump: {
		en: `\`true\` if the player has the long jump module from Half-Life.`,
		ru: `\`true\`, если у игрока есть модуль длинного прыжка из Half-Life.`,
	},
	m_tSneaking: {
		en: `The game time from which the player counts as sneaking (Half-Life).`,
		ru: `Игровое время, с которого игрок считается крадущимся (Half-Life).`,
	},
	m_iUpdateTime: {
		en: `The player's update counter: set to \`5\` on reset, never read by the game.`,
		ru: `Счётчик обновления игрока: ставится в \`5\` при сбросе, игра его не читает.`,
	},
	m_iClientHealth: {
		en: `The health last sent to the player's HUD; when it differs from his health, the game sends the new one.`,
		ru: `Здоровье, последним отправленное в HUD игрока; если оно отличается от настоящего, игра отправит новое.`,
	},
	m_iClientBattery: {
		en: `The armour last sent to the player's HUD; \`-1\` makes the game send it again.`,
		ru: `Броня, последней отправленная в HUD игрока; \`-1\` — игра отправит её заново.`,
	},
	m_iHideHUD: {
		en: `The parts of the player's HUD that are hidden: \`["money", "timer"]\`; the game sends the change itself.`,
		ru: `Скрытые части HUD игрока: \`["money", "timer"]\`; изменение игра отправляет сама.`,
	},
	m_iClientHideHUD: {
		en: `The hidden HUD parts last sent to the player; when they differ from \`hideHud\`, the game sends \`hideHud\`.`,
		ru: `Скрытые части HUD, последними отправленные игроку; если они отличаются от \`hideHud\`, игра отправит \`hideHud\`.`,
	},
	m_iClientFOV: {
		en: `The field of view last sent to the player; when the game's own copy differs, the game sends that one.`,
		ru: `Поле зрения, последним отправленное игроку; если своя копия игры отличается, игра отправит её.`,
	},
	m_iNumSpawns: {
		en: `The number of times the player has spawned this round; with \`mp_forcerespawn\` off, a second spawn is refused.`,
		ru: `Число появлений игрока в этом раунде; без \`mp_forcerespawn\` второй раз его не пустят.`,
	},
	m_pObserver: {
		en: `An observer entity tied to the player; the game never creates one and only removes it when he disconnects.`,
		ru: `Сущность наблюдателя, привязанная к игроку; игра её не создаёт и только удаляет, когда игрок отключается.`,
	},
	m_pActiveItem: {
		en: `The weapon in the player's hands, or \`null\`.`,
		ru: `Оружие в руках игрока или \`null\`.`,
	},
	m_pClientActiveItem: {
		en: `The weapon the player's client was last told he holds.`,
		ru: `Оружие, которое, по последнему сообщению клиенту игрока, у него в руках.`,
	},
	m_pLastItem: {
		en: `The weapon the player held before this one — the one lastinv switches to.`,
		ru: `Оружие, которое игрок держал до текущего, — на него переключает lastinv.`,
	},
	m_vecAutoAim: {
		en: `The player's aim assist correction, in degrees.`,
		ru: `Поправка автоприцела игрока, в градусах.`,
	},
	m_fOnTarget: {
		en: `\`true\` while the player's aim assist has a target under the crosshair.`,
		ru: `\`true\`, пока у автоприцела игрока есть цель под прицелом.`,
	},
	m_flNextSBarUpdateTime: {
		en: `The game time of the next update of the player's status bar (the name under the crosshair), every 0.2 seconds.`,
		ru: `Игровое время следующего обновления строки статуса игрока (имя под прицелом); раз в 0.2 секунды.`,
	},
	m_flStatusBarDisappearDelay: {
		en: `The game time the status bar about the player under the crosshair stays until: 2 seconds after he leaves the crosshair.`,
		ru: `Игровое время, до которого держится строка статуса об игроке под прицелом, — 2 секунды после того, как он ушёл из прицела.`,
	},
	m_lastx: {
		en: `The horizontal aim assist correction last sent to the player's client.`,
		ru: `Горизонтальная поправка автоприцела, последней отправленная клиенту игрока.`,
	},
	m_lasty: {
		en: `The vertical aim assist correction last sent to the player's client.`,
		ru: `Вертикальная поправка автоприцела, последней отправленная клиенту игрока.`,
	},
	m_nCustomSprayFrames: {
		en: `The number of frames in the player's own spray logo; \`-1\` for none.`,
		ru: `Число кадров в собственном спрей-логотипе игрока; \`-1\` — логотипа нет.`,
	},
	m_flNextDecalTime: {
		en: `The game time when the player can spray again (decalfrequency).`,
		ru: `Игровое время, когда игрок снова сможет нанести спрей (decalfrequency).`,
	},
	m_modelIndexPlayer: {
		en: `The index of the player's own model; the game sets \`modelIndex\` back to it, at spawn for one.`,
		ru: `Номер собственной модели игрока; игра возвращает к нему \`modelIndex\`, например при появлении.`,
	},
	m_iGaitsequence: {
		en: `The legs' animation the game picked for the player this frame.`,
		ru: `Анимация ног, которую игра выбрала игроку в этом кадре.`,
	},
	m_flGaitframe: {
		en: `The playback position of the player's legs' animation, in frames.`,
		ru: `Позиция в анимации ног игрока, в кадрах.`,
	},
	m_flGaityaw: {
		en: `The direction the player's legs face, in degrees; it catches up with the body's.`,
		ru: `Направление ног игрока, в градусах; догоняет направление тела.`,
	},
	m_prevgaitorigin: {
		en: `The player's position on the previous animation update, to estimate his speed.`,
		ru: `Позиция игрока при прошлом обновлении анимации — чтобы оценить его скорость.`,
	},
	m_flPitch: {
		en: `The upper body's tilt the game worked out for the player's model.`,
		ru: `Наклон верхней части тела, который игра вычислила для модели игрока.`,
	},
	m_flYaw: {
		en: `The turn of the player's upper body against the legs, in degrees.`,
		ru: `Поворот верхней части тела игрока относительно ног, в градусах.`,
	},
	m_flGaitMovement: {
		en: `The distance the player moved since the previous animation update, for the legs' animation.`,
		ru: `Расстояние, на которое игрок сдвинулся с прошлого обновления анимации, — для анимации ног.`,
	},
	m_iAutoWepSwitch: {
		en: `The player's \`_cl_autowepswitch\` setting: \`0\` never switch to a picked-up weapon, \`1\` always, \`2\` only when not firing.`,
		ru: `Настройка \`_cl_autowepswitch\` игрока: \`0\` — не переключаться на подобранное оружие, \`1\` — всегда, \`2\` — если не стреляет.`,
	},
	m_bVGUIMenus: {
		en: `\`true\` if the player uses the graphical (VGUI) menus — his \`_vgui_menus\` setting.`,
		ru: `\`true\`, если игрок пользуется графическими (VGUI) меню, — его настройка \`_vgui_menus\`.`,
	},
	m_bShowHints: {
		en: `\`true\` if the player wants hints — his _ah setting.`,
		ru: `\`true\`, если игрок хочет подсказки, — его настройка _ah.`,
	},
	m_bShieldDrawn: {
		en: `\`true\` while the player holds his shield up.`,
		ru: `\`true\`, пока игрок держит щит поднятым.`,
	},
	m_bOwnsShield: {
		en: `\`true\` if the player has a tactical shield.`,
		ru: `\`true\`, если у игрока есть тактический щит.`,
	},
	m_bWasFollowing: {
		en: `\`true\` if the spectator was following a player before he switched to free look.`,
		ru: `\`true\`, если зритель следил за игроком, прежде чем перешёл в свободный полёт.`,
	},
	m_flNextFollowTime: {
		en: `The game time when the spectator can switch to the next player again.`,
		ru: `Игровое время, когда зритель снова сможет переключиться на следующего игрока.`,
	},
	m_flYawModifier: {
		en: `The speed at which the player's legs turn after the body, for his animation.`,
		ru: `Скорость, с которой ноги игрока поворачивают за телом, — для его анимации.`,
	},
	m_blindUntilTime: {
		en: `The game time when the player's flashbang blindness ends. Writing it does not blind the screen — that is \`player.screen.fade\`.`,
		ru: `Игровое время, когда кончится ослепление игрока флешкой. Запись не ослепляет экран — это делает \`player.screen.fade\`.`,
	},
	m_blindStartTime: {
		en: `The game time when the player was blinded.`,
		ru: `Игровое время, когда игрока ослепило.`,
	},
	m_blindHoldTime: {
		en: `The time the player's blindness stays full, in seconds.`,
		ru: `Время, которое ослепление игрока держится полным, в секундах.`,
	},
	m_blindFadeTime: {
		en: `The time the player's blindness takes to fade, in seconds.`,
		ru: `Время, за которое ослепление игрока проходит, в секундах.`,
	},
	m_blindAlpha: {
		en: `The strength of the player's blindness, \`0\` to \`255\`; \`255\` is fully blind.`,
		ru: `Сила ослепления игрока, от \`0\` до \`255\`; \`255\` — полностью слеп.`,
	},
	m_allowAutoFollowTime: {
		en: `The game time from which a bot may follow teammates on its own.`,
		ru: `Игровое время, с которого бот может сам пойти за союзниками.`,
	},
	m_bIsInRebuy: {
		en: `\`true\` while the rebuy command is buying the player's last equipment.`,
		ru: `\`true\`, пока команда rebuy закупает прошлое снаряжение игрока.`,
	},
	m_flLastUpdateTime: {
		en: `The game time of the last update of the player's location name (the place on the map).`,
		ru: `Игровое время последнего обновления названия места игрока на карте.`,
	},
	m_progressStart: {
		en: `The game time when the player's progress bar (defusing, planting) started; \`0\` for none.`,
		ru: `Игровое время начала полосы прогресса игрока (разминирование, закладка); \`0\` — нет.`,
	},
	m_progressEnd: {
		en: `The game time when the player's progress bar fills.`,
		ru: `Игровое время, когда полоса прогресса игрока заполнится.`,
	},
	m_bObserverAutoDirector: {
		en: `\`true\` if the spectator's chase camera follows the target's view rather than turning freely.`,
		ru: `\`true\`, если камера зрителя следует за взглядом цели, а не вращается свободно.`,
	},
	m_canSwitchObserverModes: {
		en: `\`true\` if the spectator may change his view mode; \`false\` right after death.`,
		ru: `\`true\`, если зритель может менять режим обзора; сразу после смерти — \`false\`.`,
	},
	m_heartBeatTime: {
		en: `A Condition Zero leftover; the game does not use it.`,
		ru: `Остаток Condition Zero; игра его не использует.`,
	},
	m_intenseTimestamp: {
		en: `A Condition Zero leftover; the game does not use it.`,
		ru: `Остаток Condition Zero; игра его не использует.`,
	},
	m_silentTimestamp: {
		en: `A Condition Zero leftover; the game does not use it.`,
		ru: `Остаток Condition Zero; игра его не использует.`,
	},
	m_musicState: {
		en: `A Condition Zero leftover, one of: \`"silent"\`, \`"calm"\`, \`"intense"\`; the game does not use it.`,
		ru: `Остаток Condition Zero, одно из: \`"silent"\`, \`"calm"\`, \`"intense"\`; игра его не использует.`,
	},
	m_iLastAccount: {
		en: `The player's money last sent to the other players' scoreboards.`,
		ru: `Деньги игрока, последними отправленные в таблицы счёта других игроков.`,
	},
	m_iLastClientHealth: {
		en: `The player's health last sent to the other players' scoreboards.`,
		ru: `Здоровье игрока, последним отправленное в таблицы счёта других игроков.`,
	},
	m_tmNextAccountHealthUpdate: {
		en: `The game time when the player's money and health are next sent to the scoreboards, even unchanged; every 5 seconds.`,
		ru: `Игровое время, когда деньги и здоровье игрока снова уйдут в таблицы счёта, даже без изменений; раз в 5 секунд.`,
	},

	// CBasePlayerItem and CBasePlayerWeapon. Weapon timers count down in
	// seconds from now (CS predicts weapons on the client), not game time.
	m_pPlayer: {
		en: `The player holding the weapon, or \`null\` if it lies on the ground.`,
		ru: `Игрок, у которого оружие, или \`null\`, если оно лежит на земле.`,
	},
	m_pNext: {
		en: `The next weapon in the same inventory slot (grenades share one), or \`null\`.`,
		ru: `Следующее оружие в том же слоте инвентаря (гранаты делят один), или \`null\`.`,
	},
	m_Weapon_iPlayEmptySound: {
		en: `The weapon's empty “click”: \`1\` if it may play on the next attack.`,
		ru: `Щелчок пустого оружия: \`1\`, если он может прозвучать при следующей атаке.`,
	},
	m_Weapon_fFireOnEmpty: {
		en: `The weapon's “firing on empty” mark: \`1\` while the player holds attack with an empty clip.`,
		ru: `Отметка «стрельба впустую»: \`1\`, пока игрок жмёт атаку с пустым магазином.`,
	},
	m_Weapon_flNextPrimaryAttack: {
		en: `The time until the weapon can fire again, in seconds, counting down by itself: about \`0.1\` after an AK-47 shot, \`1.45\` after an AWP one.`,
		ru: `Время до следующего выстрела оружия, в секундах; отсчитывается само: около \`0.1\` после выстрела AK-47, \`1.45\` после AWP.`,
	},
	m_Weapon_flNextSecondaryAttack: {
		en: `The time until the weapon's secondary attack (zoom, silencer, burst mode) works again, in seconds, counting down by itself.`,
		ru: `Время до следующей вторичной атаки оружия (зум, глушитель, режим очереди), в секундах; отсчитывается само.`,
	},
	m_Weapon_flTimeWeaponIdle: {
		en: `The time until the weapon plays its idle animation, in seconds, counting down by itself.`,
		ru: `Время до анимации покоя оружия, в секундах; отсчитывается само.`,
	},
	m_Weapon_iPrimaryAmmoType: {
		en: `The weapon's ammo kind — the slot of the player's ammo it takes from; \`-1\` for none (a knife).`,
		ru: `Вид патронов оружия — номер запаса патронов игрока, из которого оно берёт; \`-1\` — никаких (нож).`,
	},
	m_Weapon_iSecondaryAmmoType: {
		en: `The weapon's secondary ammo slot; CS weapons have none (\`-1\`).`,
		ru: `Номер запаса вторичных патронов оружия; у оружия CS их нет (\`-1\`).`,
	},
	m_Weapon_iClip: {
		en: `The rounds in the weapon's magazine: \`30\` in a full AK-47; \`-1\` for the knife, which has none.`,
		ru: `Патроны в магазине оружия: \`30\` у полного AK-47; \`-1\` у ножа, у которого магазина нет.`,
	},
	m_Weapon_iClientClip: {
		en: `The clip last sent to the player's HUD; when it differs from clip, the game sends the new one.`,
		ru: `Магазин, последним отправленный в HUD игрока; если он отличается от clip, игра отправит новый.`,
	},
	m_Weapon_iClientWeaponState: {
		en: `The weapon's state (held or not) last sent to the player's HUD.`,
		ru: `Состояние оружия (в руках или нет), последним отправленное в HUD игрока.`,
	},
	m_Weapon_fInReload: {
		en: `The weapon's reload mark: \`1\` while it is reloading.`,
		ru: `Отметка перезарядки оружия: \`1\`, пока оно перезаряжается.`,
	},
	m_Weapon_fInSpecialReload: {
		en: `The shotgun's shell-by-shell reload stage: \`0\` not reloading, \`1\` starting, \`2\` putting a shell in.`,
		ru: `Стадия поштучной перезарядки дробовика: \`0\` — не перезаряжается, \`1\` — начало, \`2\` — вставляет патрон.`,
	},
	m_Weapon_iDefaultAmmo: {
		en: `The ammo the weapon gives when first picked up; \`0\` for one dropped by a player (only its clip).`,
		ru: `Патроны, которые оружие даёт при первом подборе; \`0\` у выброшенного игроком (только магазин).`,
	},
	m_Weapon_iShellId: {
		en: `The shell casing model the weapon throws out (precached).`,
		ru: `Модель гильзы, которую выбрасывает оружие (подгруженная).`,
	},
	m_Weapon_bDelayFire: {
		en: `\`true\` from a shot until the attack button is let go; this way tapping the button does not keep single-shot accuracy.`,
		ru: `\`true\` от выстрела до того, как отпустят кнопку атаки; так частые нажатия не сохраняют точность одиночного выстрела.`,
	},
	m_Weapon_iDirection: {
		en: `The side the weapon's recoil pulls to next, left or right; it flips from time to time.`,
		ru: `Сторона, в которую отдача оружия уведёт в следующий раз, — влево или вправо; время от времени меняется.`,
	},
	m_Weapon_bSecondarySilencerOn: unused(`The weapon's flag meant for a second silencer.`, `Флаг оружия, задуманный для второго глушителя.`),
	m_Weapon_flAccuracy: {
		en: `The weapon's current inaccuracy: it grows as it fires and settles back; each weapon has its own range (\`0.2\` for a fresh AK-47).`,
		ru: `Текущий разброс оружия: растёт при стрельбе и возвращается; у каждого оружия свои пределы (\`0.2\` у свежего AK-47).`,
	},
	m_Weapon_iShotsFired: {
		en: `The shots in the weapon's current burst; the recoil grows with it, and it drops back once the player stops firing.`,
		ru: `Выстрелы в текущей очереди оружия; с ними растёт отдача, и счёт сбрасывается, когда игрок перестаёт стрелять.`,
	},
	m_Weapon_flGlock18Shoot: {
		en: `The game time of the next round in the Glock's burst; \`0\` when not bursting.`,
		ru: `Игровое время следующего патрона очереди Glock; \`0\` — очереди нет.`,
	},
	m_Weapon_iGlock18ShotsFired: {
		en: `The rounds the Glock has fired in the current burst.`,
		ru: `Патроны, которые Glock выпустил в текущей очереди.`,
	},
	m_Weapon_flFamasShoot: {
		en: `The game time of the next round in the FAMAS's burst; \`0\` when not bursting.`,
		ru: `Игровое время следующего патрона очереди FAMAS; \`0\` — очереди нет.`,
	},
	m_Weapon_iFamasShotsFired: {
		en: `The rounds the FAMAS has fired in the current burst.`,
		ru: `Патроны, которые FAMAS выпустил в текущей очереди.`,
	},
	m_Weapon_fBurstSpread: {
		en: `The spread of the FAMAS's burst, kept for its later rounds.`,
		ru: `Разброс очереди FAMAS, сохранённый для её следующих патронов.`,
	},
	m_Weapon_iWeaponState: {
		en: `
			The weapon's modes, a list of any of: \`"uspSilenced"\` - the USP's silencer is on, \`"glock18Burst"\` - the Glock fires bursts, \`"m4a1Silenced"\` - the M4A1's silencer is on, \`"eliteLeft"\` - the Elites fire the left gun next, \`"famasBurst"\` - the FAMAS fires bursts, \`"shieldDrawn"\` - the shield is up.

			Pawn: \`WPNSTATE_*\`
		`,
		ru: `
			Режимы оружия, список, любые из: \`"uspSilenced"\` — глушитель на USP, \`"glock18Burst"\` — Glock стреляет очередями, \`"m4a1Silenced"\` — глушитель на M4A1, \`"eliteLeft"\` — Elites следующим стреляют из левого, \`"famasBurst"\` — FAMAS стреляет очередями, \`"shieldDrawn"\` — щит поднят.

			Pawn: \`WPNSTATE_*\`
		`,
	},
	m_Weapon_flNextReload: {
		en: `The time until the shotgun's next shell goes in during its reload, in seconds, counting down.`,
		ru: `Время до следующего патрона при перезарядке дробовика, в секундах; отсчитывается вниз.`,
	},
	m_Weapon_flDecreaseShotsFired: {
		en: `The game time when \`shotsFired\` next goes down by one after the player stops firing.`,
		ru: `Игровое время, когда \`shotsFired\` уменьшится на единицу после того, как игрок перестал стрелять.`,
	},
	m_Weapon_flPrevPrimaryAttack: {
		en: `The delay between the weapon's last two shots, in seconds; the game uses it to keep the fire rate even.`,
		ru: `Задержка между двумя последними выстрелами оружия, в секундах; по ней игра выравнивает темп стрельбы.`,
	},
	m_Weapon_flLastFireTime: {
		en: `The game time of the weapon's last shot; \`0\` before the first one.`,
		ru: `Игровое время последнего выстрела оружия; \`0\` до первого выстрела.`,
	},
	// The game rules (CSGameRules): the fields of `game`.
	m_bFreezePeriod: {
		en: `\`true\` during the freeze time at a round's start, while players cannot move or shoot. Writing \`false\` ends it for the game's own checks.`,
		ru: `\`true\` во время заморозки в начале раунда, пока игроки не могут ни двигаться, ни стрелять. Запись \`false\` заканчивает её для собственных проверок игры.`,
	},
	m_bBombDropped: {
		en: `\`true\` while the bomb lies on the ground, dropped by its carrier.`,
		ru: `\`true\`, пока бомба лежит на земле, брошенная тем, кто её нёс.`,
	},
	m_GameDesc: {
		en: `The game's name in the server browser, e.g. \`"Counter-Strike"\`.`,
		ru: `Название игры в браузере серверов, например \`"Counter-Strike"\`.`,
	},
	m_nMaxPlayers: {
		en: `The number of player slots, as the game's voice code counts them.`,
		ru: `Число мест для игроков, как их считает голосовой код игры.`,
	},
	m_UpdateInterval: {
		en: `The seconds between the game's updates of who hears whom on the voice chat.`,
		ru: `Секунды между обновлениями игры о том, кто кого слышит в голосовом чате.`,
	},
	m_flRestartRoundTime: {
		en: `The game time the next round starts at, after a round's end or a restart; \`0\` when none is due.`,
		ru: `Игровое время, когда начнётся следующий раунд после конца раунда или рестарта; \`0\`, если ничего не ожидается.`,
	},
	m_flCheckWinConditions: {
		en: `The game time of the game's next check whether a side has won; \`0\` when none is due.`,
		ru: `Игровое время следующей проверки игрой, не победила ли сторона; \`0\`, если проверка не ожидается.`,
	},
	m_fRoundStartTime: {
		en: `The game time the round's play began: the end of the freeze time.`,
		ru: `Игровое время, когда началась игра в раунде: конец заморозки.`,
	},
	m_iRoundTime: {
		en: `The round's length in seconds; during the freeze time, the freeze time's.`,
		ru: `Длина раунда в секундах; во время заморозки — длина заморозки.`,
	},
	m_iRoundTimeSecs: {
		en: `The round's length in seconds, from \`mp_roundtime\`.`,
		ru: `Длина раунда в секундах, из \`mp_roundtime\`.`,
	},
	m_iIntroRoundTime: {
		en: `The freeze time's length in seconds, from \`mp_freezetime\`.`,
		ru: `Длина заморозки в секундах, из \`mp_freezetime\`.`,
	},
	m_fRoundStartTimeReal: {
		en: `The game time the round started, the freeze time included.`,
		ru: `Игровое время, когда начался раунд, вместе с заморозкой.`,
	},
	m_iAccountTerrorist: {
		en: `The money every terrorist is paid when the next round starts, for how this one went.`,
		ru: `Деньги, которые каждый террорист получит в начале следующего раунда за то, как прошёл этот.`,
	},
	m_iAccountCT: {
		en: `The money every counter-terrorist is paid when the next round starts, for how this one went.`,
		ru: `Деньги, которые каждый спецназовец получит в начале следующего раунда за то, как прошёл этот.`,
	},
	m_iNumTerrorist: {
		en: `The number of terrorists, counted when a round ends.`,
		ru: `Число террористов, посчитанное в конце раунда.`,
	},
	m_iNumCT: {
		en: `The number of counter-terrorists, counted when a round ends.`,
		ru: `Число спецназовцев, посчитанное в конце раунда.`,
	},
	m_iNumSpawnableTerrorist: {
		en: `The number of terrorists who can spawn in the next round, counted when a round ends.`,
		ru: `Число террористов, которые могут появиться в следующем раунде, посчитанное в конце раунда.`,
	},
	m_iNumSpawnableCT: {
		en: `The number of counter-terrorists who can spawn in the next round, counted when a round ends.`,
		ru: `Число спецназовцев, которые могут появиться в следующем раунде, посчитанное в конце раунда.`,
	},
	m_iSpawnPointCount_Terrorist: {
		en: `The number of the map's terrorist spawn points.`,
		ru: `Число точек появления террористов на карте.`,
	},
	m_iSpawnPointCount_CT: {
		en: `The number of the map's counter-terrorist spawn points.`,
		ru: `Число точек появления спецназовцев на карте.`,
	},
	m_iHostagesRescued: {
		en: `The number of hostages rescued this round.`,
		ru: `Число заложников, спасённых в этом раунде.`,
	},
	m_iHostagesTouched: {
		en: `The number of hostages a counter-terrorist has led away this round.`,
		ru: `Число заложников, которых спецназовец повёл за собой в этом раунде.`,
	},
	m_iRoundWinStatus: {
		en: `The last round's winner, one of \`"CT"\`, \`"TERRORIST"\`, \`"draw"\`, or \`"none"\` while the round goes on.`,
		ru: `Победитель последнего раунда, одно из \`"CT"\`, \`"TERRORIST"\`, \`"draw"\` или \`"none"\`, пока раунд идёт.`,
	},
	m_iNumCTWins: {
		en: `
			The counter-terrorists' score: the rounds they have won. Writing it changes the score, and the scoreboard shows it at once.

			Pawn: \`rg_update_teamscores\`
		`,
		ru: `
			Счёт спецназовцев: выигранные ими раунды. Запись меняет счёт, и таблица сразу его показывает.

			Pawn: \`rg_update_teamscores\`
		`,
	},
	m_iNumTerroristWins: {
		en: `
			The terrorists' score: the rounds they have won. Writing it changes the score, and the scoreboard shows it at once.

			Pawn: \`rg_update_teamscores\`
		`,
		ru: `
			Счёт террористов: выигранные ими раунды. Запись меняет счёт, и таблица сразу его показывает.

			Pawn: \`rg_update_teamscores\`
		`,
	},
	m_bTargetBombed: {
		en: `\`true\` once the bomb has blown a target up this round.`,
		ru: `\`true\`, когда бомба в этом раунде взорвала цель.`,
	},
	m_bBombDefused: {
		en: `\`true\` once the bomb has been defused this round.`,
		ru: `\`true\`, когда бомбу в этом раунде обезвредили.`,
	},
	m_bMapHasBombTarget: {
		en: `\`true\` when the map has a bomb site.`,
		ru: `\`true\`, если на карте есть место для закладки бомбы.`,
	},
	m_bMapHasBombZone: {
		en: `\`true\` when the map has a bomb zone a planter must stand in.`,
		ru: `\`true\`, если на карте есть зона, в которой надо стоять, чтобы заложить бомбу.`,
	},
	m_bMapHasBuyZone: {
		en: `\`true\` when the map has buy zones of its own.`,
		ru: `\`true\`, если на карте есть свои зоны закупки.`,
	},
	m_bMapHasRescueZone: {
		en: `\`true\` when the map has a hostage rescue zone.`,
		ru: `\`true\`, если на карте есть зона спасения заложников.`,
	},
	m_bMapHasEscapeZone: {
		en: `\`true\` when the map has an escape zone for the terrorists.`,
		ru: `\`true\`, если на карте есть зона побега для террористов.`,
	},
	m_bMapHasVIPSafetyZone: {
		en: `Whether the map has a VIP safety zone, one of \`"yes"\`, \`"no"\`, or \`"notChecked"\` until the game has looked.`,
		ru: `Есть ли на карте зона спасения VIP, одно из: \`"yes"\`, \`"no"\` или \`"notChecked"\`, пока игра её не искала.`,
	},
	m_bMapHasCameras: {
		en: `\`true\` when the map has spectator cameras.`,
		ru: `\`true\`, если на карте есть камеры для зрителей.`,
	},
	m_iC4Timer: {
		en: `The bomb's timer in seconds, from \`mp_c4timer\`.`,
		ru: `Таймер бомбы в секундах, из \`mp_c4timer\`.`,
	},
	m_iC4Guy: {
		en: `The terrorist who got the bomb this round, or \`null\`.`,
		ru: `Террорист, которому в этом раунде досталась бомба, или \`null\`.`,
	},
	m_iLoserBonus: {
		en: `The money the side that loses a round is paid; it grows with each loss in a row.`,
		ru: `Деньги, которые получает проигравшая раунд сторона; растут с каждым поражением подряд.`,
	},
	m_iNumConsecutiveCTLoses: {
		en: `The number of rounds the counter-terrorists have lost in a row.`,
		ru: `Число раундов, проигранных спецназовцами подряд.`,
	},
	m_iNumConsecutiveTerroristLoses: {
		en: `The number of rounds the terrorists have lost in a row.`,
		ru: `Число раундов, проигранных террористами подряд.`,
	},
	m_fMaxIdlePeriod: {
		en: `The seconds a player may stand idle before he is kicked, with \`mp_autokick\` on.`,
		ru: `Секунды, которые игрок может стоять без дела, пока его не выкинет при включённом \`mp_autokick\`.`,
	},
	m_iLimitTeams: {
		en: `The most one side may outnumber the other by, from \`mp_limitteams\`.`,
		ru: `Насколько одна сторона может превосходить другую числом, из \`mp_limitteams\`.`,
	},
	m_bLevelInitialized: {
		en: `\`true\` once the game has looked the map over for its bomb sites, buy zones and hostages.`,
		ru: `\`true\`, когда игра осмотрела карту: места для бомбы, зоны закупки и заложников.`,
	},
	m_bRoundTerminating: {
		en: `\`true\` from a round's end until the next round starts.`,
		ru: `\`true\` с конца раунда до начала следующего.`,
	},
	m_bCompleteReset: {
		en: `\`true\` when the next restart resets everything, the scores too, as \`sv_restart\` does.`,
		ru: `\`true\`, если следующий рестарт сбросит всё, и счёт тоже, как это делает \`sv_restart\`.`,
	},
	m_flRequiredEscapeRatio: {
		en: `The share of terrorists, \`0\` to \`1\`, who must escape for them to win on an escape map.`,
		ru: `Доля террористов, от \`0\` до \`1\`, которым надо сбежать, чтобы они победили на карте побега.`,
	},
	m_iNumEscapers: {
		en: `The number of terrorists who can escape, on an escape map.`,
		ru: `Число террористов, которые могут сбежать, на карте побега.`,
	},
	m_iHaveEscaped: {
		en: `The number of terrorists who have escaped this round.`,
		ru: `Число террористов, сбежавших в этом раунде.`,
	},
	m_bCTCantBuy: {
		en: `\`true\` while the counter-terrorists may not buy.`,
		ru: `\`true\`, пока спецназовцам нельзя покупать.`,
	},
	m_bTCantBuy: {
		en: `\`true\` while the terrorists may not buy.`,
		ru: `\`true\`, пока террористам нельзя покупать.`,
	},
	m_flBombRadius: {
		en: `The bomb's blast radius, in units, as the map sets it.`,
		ru: `Радиус взрыва бомбы в единицах, как его задаёт карта.`,
	},
	m_iConsecutiveVIP: {
		en: `The number of rounds in a row the same player has been the VIP.`,
		ru: `Число раундов подряд, в которых VIP был один и тот же игрок.`,
	},
	m_iTotalGunCount: {
		en: `The number of guns the game has counted lying on the map.`,
		ru: `Число ружей, которые игра насчитала лежащими на карте.`,
	},
	m_iTotalGrenadeCount: {
		en: `The number of grenades the game has counted lying on the map.`,
		ru: `Число гранат, которые игра насчитала лежащими на карте.`,
	},
	m_iTotalArmourCount: {
		en: `The number of armour pieces the game has counted lying on the map.`,
		ru: `Число бронежилетов, которые игра насчитала лежащими на карте.`,
	},
	m_iUnBalancedRounds: {
		en: `The number of rounds in a row one side has outnumbered the other by more than two; the game balances the sides after enough of them.`,
		ru: `Число раундов подряд, в которых одна сторона превосходила другую больше чем на двоих; после нескольких таких игра уравнивает стороны.`,
	},
	m_iNumEscapeRounds: {
		en: `The number of escape rounds played in a row; the sides swap after 8.`,
		ru: `Число раундов побега подряд; после 8 стороны меняются.`,
	},
	m_iLastPick: {
		en: `The number of the map the last map vote picked.`,
		ru: `Номер карты, которую выбрало последнее голосование.`,
	},
	m_iMaxMapTime: {
		en: `The map's time limit, from \`mp_timelimit\`.`,
		ru: `Ограничение времени карты, из \`mp_timelimit\`.`,
	},
	m_iMaxRounds: {
		en: `The number of rounds the map lasts, from \`mp_maxrounds\`; \`0\` for no limit.`,
		ru: `Число раундов, которое длится карта, из \`mp_maxrounds\`; \`0\` — без ограничения.`,
	},
	m_iTotalRoundsPlayed: {
		en: `The number of rounds played on the map.`,
		ru: `Число раундов, сыгранных на карте.`,
	},
	m_iMaxRoundsWon: {
		en: `The number of rounds a side must win to end the map, from \`mp_winlimit\`; \`0\` for no limit.`,
		ru: `Число раундов, которые стороне надо выиграть, чтобы карта кончилась, из \`mp_winlimit\`; \`0\` — без ограничения.`,
	},
	m_iStoredSpectValue: {
		en: `The value of \`allow_spectators\` the game remembers to notice when it changes.`,
		ru: `Значение \`allow_spectators\`, которое игра помнит, чтобы заметить его изменение.`,
	},
	m_flForceCameraValue: {
		en: `The value of \`mp_forcecamera\` the game remembers to notice when it changes.`,
		ru: `Значение \`mp_forcecamera\`, которое игра помнит, чтобы заметить его изменение.`,
	},
	m_flForceChaseCamValue: {
		en: `The value of \`mp_forcechasecam\` the game remembers to notice when it changes.`,
		ru: `Значение \`mp_forcechasecam\`, которое игра помнит, чтобы заметить его изменение.`,
	},
	m_flFadeToBlackValue: {
		en: `The value of \`mp_fadetoblack\` the game remembers to notice when it changes.`,
		ru: `Значение \`mp_fadetoblack\`, которое игра помнит, чтобы заметить его изменение.`,
	},
	m_pVIP: {
		en: `The VIP on an assassination map, a player \`id\`; \`0\` for none.`,
		ru: `VIP на карте с убийством VIP — \`id\` игрока; \`0\`, если его нет.`,
	},
	m_flIntermissionEndTime: {
		en: `The game time the intermission at the map's end is over and the next map loads.`,
		ru: `Игровое время, когда закончится перерыв в конце карты и загрузится следующая.`,
	},
	m_flIntermissionStartTime: {
		en: `The game time the intermission at the map's end began.`,
		ru: `Игровое время, когда начался перерыв в конце карты.`,
	},
	m_iEndIntermissionButtonHit: {
		en: `\`true\` once a player has pressed a button to end the intermission early.`,
		ru: `\`true\`, когда игрок нажал кнопку, чтобы закончить перерыв раньше.`,
	},
	m_tmNextPeriodicThink: {
		en: `The game time of the game's next periodic check of its limits and cvars.`,
		ru: `Игровое время следующей периодической проверки игрой её ограничений и кваров.`,
	},
	m_bGameStarted: {
		en: `\`true\` once the game has begun: both sides have had players. Until then a round ends with “Game Commencing”.`,
		ru: `\`true\`, когда игра началась: на обеих сторонах были игроки. До этого раунд кончается надписью «Game Commencing».`,
	},
	m_bSkipSpawn: {
		en: `\`true\` when the next round starts without respawning the players.`,
		ru: `\`true\`, если следующий раунд начнётся, не возрождая игроков.`,
	},
	m_bSkipShowMenu: {
		en: `\`true\` while a joining player is not shown the team menu.`,
		ru: `\`true\`, пока входящему игроку не показывается меню выбора команды.`,
	},
	m_bNeededPlayers: {
		en: `\`true\` while the game waits for players because a side is empty.`,
		ru: `\`true\`, пока игра ждёт игроков, потому что одна из сторон пуста.`,
	},
	m_flEscapeRatio: {
		en: `The share of terrorists, \`0\` to \`1\`, who have escaped this round.`,
		ru: `Доля террористов, от \`0\` до \`1\`, сбежавших в этом раунде.`,
	},
	m_flTimeLimit: {
		en: `The game time the map ends by \`mp_timelimit\`; \`0\` for no limit.`,
		ru: `Игровое время, когда карта кончится по \`mp_timelimit\`; \`0\` — без ограничения.`,
	},
	m_flGameStartTime: {
		en: `The game time the game began, after “Game Commencing”.`,
		ru: `Игровое время, когда началась игра, после «Game Commencing».`,
	},
	m_bTeamBalanced: {
		en: `\`true\` when the sides were balanced at this round's start.`,
		ru: `\`true\`, если стороны уравнивались в начале этого раунда.`,
	},
};

// The unions of the enum fields (ENUM_TYPES in scripts/generate-entities.ts):
// what a value of the type is. What each name means is in the field's entry;
// the generator adds the line about "unknown" and the Pawn constants.
export const ENTITY_TYPES: Record<string, Text> = {
	RenderMode: {
		en: `An entity's render mode - \`entity.renderMode\`.`,
		ru: `Режим отрисовки сущности — \`entity.renderMode\`.`,
	},
	RenderFx: {
		en: `A render effect of an entity - \`entity.renderFx\`.`,
		ru: `Эффект отрисовки сущности — \`entity.renderFx\`.`,
	},
	MoveType: {
		en: `An entity's kind of movement - \`entity.moveType\`.`,
		ru: `Способ движения сущности — \`entity.moveType\`.`,
	},
	Solid: {
		en: `An entity's solidity - \`entity.solid\`.`,
		ru: `Твёрдость сущности — \`entity.solid\`.`,
	},
	TakeDamage: {
		en: `An entity's vulnerability - \`entity.takeDamage\`.`,
		ru: `Уязвимость сущности — \`entity.takeDamage\`.`,
	},
	DeadFlag: {
		en: `An entity's stage of dying - \`entity.deadFlag\`.`,
		ru: `Стадия смерти сущности — \`entity.deadFlag\`.`,
	},
	WaterLevel: {
		en: `An entity's depth in water - \`entity.waterLevel\`.`,
		ru: `Глубина погружения сущности — \`entity.waterLevel\`.`,
	},
	Contents: {
		en: `The contents of a point of the map: air, water, a wall - \`entity.waterType\`.`,
		ru: `Содержимое точки карты: воздух, вода, стена — \`entity.waterType\`.`,
	},
	FixAngle: {
		en: `A player's view snap - \`player.fixAngle\`.`,
		ru: `Разворот взгляда игрока — \`player.fixAngle\`.`,
	},
	HitGroup: {
		en: `A body part a bullet hits - \`player.lastHitGroup\`.`,
		ru: `Часть тела, куда попадает пуля, — \`player.lastHitGroup\`.`,
	},
	ArmorType: {
		en: `A player's armour kind - \`player.kevlar\`.`,
		ru: `Вид брони игрока — \`player.kevlar\`.`,
	},
	ObserverMode: {
		en: `A player's spectator mode - \`player.observerMode\`, \`player.observerLastMode\`.`,
		ru: `Режим наблюдения игрока — \`player.observerMode\`, \`player.observerLastMode\`.`,
	},
	JoinState: {
		en: `A player's stage of joining the game - \`player.joiningState\`.`,
		ru: `Стадия входа игрока в игру — \`player.joiningState\`.`,
	},
	GameMenu: {
		en: `An old-style menu of the game - \`player.openMenu\`.`,
		ru: `Старое меню игры — \`player.openMenu\`.`,
	},
	ThrowDirection: {
		en: `The way a dead player's body is thrown - \`player.throwDirection\`.`,
		ru: `Направление, куда отбрасывает тело убитого игрока, — \`player.throwDirection\`.`,
	},
	BloodColor: {
		en: `The colour of an entity's blood - \`player.bloodColor\`.`,
		ru: `Цвет крови сущности — \`player.bloodColor\`.`,
	},
	PlayerModel: {
		en: `A player's model - \`player.modelName\`.`,
		ru: `Модель игрока — \`player.modelName\`.`,
	},
	IgnoredChat: {
		en: `The chat a player hides - \`player.ignoreGlobalChat\`.`,
		ru: `Чат, который скрывает игрок, — \`player.ignoreGlobalChat\`.`,
	},
	MusicState: {
		en: `A Condition Zero music state - \`player.musicState\`.`,
		ru: `Музыкальное состояние Condition Zero — \`player.musicState\`.`,
	},
	VipSafetyZone: {
		en: `Whether the map has a VIP safety zone - \`game.mapHasVipSafetyZone\`.`,
		ru: `Есть ли на карте зона спасения VIP — \`game.mapHasVipSafetyZone\`.`,
	},
};

// The members scripts/generate-entities.ts writes by hand rather than from a
// field: what an entity does, by `Class.member`.
export const ENTITY_METHODS: Record<string, Text> = {
	'Weapon.classname': {
		en: `The weapon's class name, e.g. \`"weapon_ak47"\`: the name \`player.give\`, \`setAmmo\`, \`getAmmo\` and \`switchWeapon\` take - \`player.give(weapon.classname)\`.

Pawn: \`pev->classname\`, \`get_weaponname\``,
		ru: `Класс оружия, например \`"weapon_ak47"\`: имя, которое принимают \`player.give\`, \`setAmmo\`, \`getAmmo\` и \`switchWeapon\`, — \`player.give(weapon.classname)\`.

Pawn: \`pev->classname\`, \`get_weaponname\``,
	},
	'Entity.exists': {
		en: `\`true\` while the entity is in the world: \`false\` once the engine has freed it (\`remove()\` has it freed at the end of the frame), for a player who has left, and for \`0\`, no entity. An id that came from an event or a hook may name an entity that is gone.

Pawn: \`is_valid_ent\`, \`is_entity\``,
		ru: `\`true\`, пока сущность есть в мире: \`false\`, когда движок её освободил (\`remove()\` освобождает её в конце кадра), для ушедшего игрока и для \`0\` — «нет сущности». Номер из события или хука может указывать на сущность, которой уже нет.

Pawn: \`is_valid_ent\`, \`is_entity\``,
	},
	'Entity.dropToFloor': {
		en: `Drops the entity straight down onto what is under it, as the game puts an item on the floor when a map starts: \`true\` when it landed, \`false\` when there is nothing under it within 256 units or it is stuck in something.

Pawn: \`drop_to_floor\`, \`engfunc(EngFunc_DropToFloor, ...)\``,
		ru: `Опускает сущность вертикально вниз на то, что под ней, как игра кладёт предмет на пол при старте карты: \`true\`, если она опустилась, \`false\`, если под ней ничего нет в пределах 256 единиц или она во что-то застряла.

Pawn: \`drop_to_floor\`, \`engfunc(EngFunc_DropToFloor, ...)\``,
	},
	'Entity.emitSound': {
		en: `Plays a sound from the entity, heard by everyone near and fading with distance: \`player.emitSound("myplugin/hit.wav")\`. The path is under \`sound/\`, as \`server.precache\` takes it; \`options\` set the channel, the volume, the attenuation and the pitch.

Pawn: \`emit_sound\`, \`rh_emit_sound2\``,
		ru: `Проигрывает звук от сущности: его слышат все рядом, и он затихает с расстоянием: \`player.emitSound("myplugin/hit.wav")\`. Путь — внутри \`sound/\`, как его принимает \`server.precache\`; \`options\` задают канал, громкость, затухание и высоту.

Pawn: \`emit_sound\`, \`rh_emit_sound2\``,
	},
	'Entity.setSize': {
		en: `Sets the entity's bounding box, the corners relative to its \`origin\`: \`box.setSize([-16, -16, 0], [16, 16, 72])\`. \`mins\`, \`maxs\`, \`size\` and where it collides follow. A box whose \`mins\` is above its \`maxs\` on any axis is refused, with an error in the console.

Pawn: \`entity_set_size\``,
		ru: `Задаёт габариты сущности, углы — относительно её \`origin\`: \`box.setSize([-16, -16, 0], [16, 16, 72])\`. \`mins\`, \`maxs\`, \`size\` и то, где она сталкивается, следуют за ними. Габариты, у которых \`mins\` хоть по одной оси больше \`maxs\`, не ставятся, а в консоль пишется ошибка.

Pawn: \`entity_set_size\``,
	},
	'Entity.spawn': {
		en: `Runs the entity's spawn, as the game does when it makes one: an entity made with \`Entity.create\` is set up by it.

Pawn: \`ExecuteHamB(Ham_Spawn, ...)\`, \`ExecuteHam\``,
		ru: `Выполняет появление сущности, как игра, когда её создаёт: сущность из \`Entity.create\` настраивается им.

Pawn: \`ExecuteHamB(Ham_Spawn, ...)\`, \`ExecuteHam\``,
	},
	'Entity.activate': {
		en: `Activates the entity, as the game does once the map has loaded.

Pawn: \`ExecuteHamB(Ham_Activate, ...)\`, \`ExecuteHam\``,
		ru: `Активирует сущность, как игра после загрузки карты.

Pawn: \`ExecuteHamB(Ham_Activate, ...)\`, \`ExecuteHam\``,
	},

	'Entity.heal': {
		en: `Heals the entity as the game does, up to its maximum: \`true\` when it took any.

Pawn: \`ExecuteHamB(Ham_TakeHealth, ...)\`, \`ExecuteHam\``,
		ru: `Лечит сущность, как игра, не выше её максимума: \`true\`, если здоровье прибавилось.

Pawn: \`ExecuteHamB(Ham_TakeHealth, ...)\`, \`ExecuteHam\``,
	},
	'Entity.killed': {
		en: `Kills the entity as the game does, with the killer it names; \`gib\` is \`0\` for the usual death, \`1\` never torn apart, \`2\` always.

Pawn: \`ExecuteHamB(Ham_Killed, ...)\`, \`ExecuteHam\``,
		ru: `Убивает сущность, как игра, с указанным убийцей; \`gib\` — \`0\` обычная смерть, \`1\` — никогда не разрывает, \`2\` — всегда.

Pawn: \`ExecuteHamB(Ham_Killed, ...)\`, \`ExecuteHam\``,
	},
	'Entity.think': {
		en: `Runs the entity's think now, without waiting for its \`nextThink\`.

Pawn: \`ExecuteHamB(Ham_Think, ...)\`, \`ExecuteHam\``,
		ru: `Выполняет «мысль» сущности сейчас, не дожидаясь её \`nextThink\`.

Pawn: \`ExecuteHamB(Ham_Think, ...)\`, \`ExecuteHam\``,
	},
	'Entity.use': {
		en: `Uses the entity - a button pressed, a door opened - as \`activator\` would, through \`caller\`.

Pawn: \`ExecuteHamB(Ham_Use, ...)\`, \`ExecuteHam\``,
		ru: `Использует сущность — нажимает кнопку, открывает дверь, — как это сделал бы \`activator\` через \`caller\`.

Pawn: \`ExecuteHamB(Ham_Use, ...)\`, \`ExecuteHam\``,
	},
	'Entity.blocked': {
		en: `Tells a moving entity - a door, a train - that \`other\` is in its way.

Pawn: \`ExecuteHamB(Ham_Blocked, ...)\`, \`ExecuteHam\``,
		ru: `Сообщает движущейся сущности — двери, поезду, — что \`other\` стоит у неё на пути.

Pawn: \`ExecuteHamB(Ham_Blocked, ...)\`, \`ExecuteHam\``,
	},
	'Entity.restart': {
		en: `Puts the entity back as a new round finds it.

Pawn: \`ExecuteHamB(Ham_CS_Restart, ...)\`, \`ExecuteHam\``,
		ru: `Возвращает сущность в то состояние, в каком её застаёт новый раунд.

Pawn: \`ExecuteHamB(Ham_CS_Restart, ...)\`, \`ExecuteHam\``,
	},
	'Player.addFrags': {
		en: `Adds points to the player's score, as a kill does; \`allowNegative\` lets the score go below \`0\`.

Pawn: \`ExecuteHamB(Ham_AddPoints, ...)\`, \`ExecuteHam\``,
		ru: `Добавляет очки к счёту игрока, как убийство; \`allowNegative\` позволяет счёту уйти ниже \`0\`.

Pawn: \`ExecuteHamB(Ham_AddPoints, ...)\`, \`ExecuteHam\``,
	},
	'Player.addTeamScore': {
		en: `Adds points to the scores of the player's team, as the game does for an objective.

Pawn: \`ExecuteHamB(Ham_AddPointsToTeam, ...)\`, \`ExecuteHam\``,
		ru: `Добавляет очки к счёту команды игрока, как игра за выполнение задачи.

Pawn: \`ExecuteHamB(Ham_AddPointsToTeam, ...)\`, \`ExecuteHam\``,
	},
	'Player.addItem': {
		en: `Puts a weapon entity into the player's inventory; \`true\` when it went in. To give a weapon by name, \`player.give\`.

Pawn: \`ExecuteHamB(Ham_AddPlayerItem, ...)\`, \`ExecuteHam\``,
		ru: `Кладёт оружие-сущность в инвентарь игрока; \`true\` — положено. Чтобы выдать оружие по имени — \`player.give\`.

Pawn: \`ExecuteHamB(Ham_AddPlayerItem, ...)\`, \`ExecuteHam\``,
	},
	'Player.removeItem': {
		en: `Takes a weapon entity out of the player's inventory, leaving the entity; \`true\` when it was there.

Pawn: \`ExecuteHamB(Ham_RemovePlayerItem, ...)\`, \`ExecuteHam\``,
		ru: `Убирает оружие-сущность из инвентаря игрока, не удаляя саму сущность; \`true\` — оно там было.

Pawn: \`ExecuteHamB(Ham_RemovePlayerItem, ...)\`, \`ExecuteHam\``,
	},
	'Player.giveAmmo': {
		en: `Gives the player ammo of a kind by the game's name, e.g. \`"buckshot"\`, up to \`max\`; returns the ammo's index, \`-1\` when none went in.

Pawn: \`ExecuteHamB(Ham_GiveAmmo, ...)\`, \`ExecuteHam\``,
		ru: `Даёт игроку патроны по имени вида у игры, например \`"buckshot"\`, не больше \`max\`; возвращает индекс патронов, \`-1\` — не дано.

Pawn: \`ExecuteHamB(Ham_GiveAmmo, ...)\`, \`ExecuteHam\``,
	},
	'Player.jump': {
		en: `Runs the game's jump for the player, as when he presses jump.

Pawn: \`ExecuteHamB(Ham_Player_Jump, ...)\`, \`ExecuteHam\``,
		ru: `Выполняет прыжок игрока, как когда он нажимает прыжок.

Pawn: \`ExecuteHamB(Ham_Player_Jump, ...)\`, \`ExecuteHam\``,
	},
	'Player.duck': {
		en: `Runs the game's duck for the player, as when he holds duck.

Pawn: \`ExecuteHamB(Ham_Player_Duck, ...)\`, \`ExecuteHam\``,
		ru: `Выполняет приседание игрока, как когда он держит присед.

Pawn: \`ExecuteHamB(Ham_Player_Duck, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.addToPlayer': {
		en: `Gives the weapon to the player, as picking it up does; \`true\` when he took it.

Pawn: \`ExecuteHamB(Ham_Item_AddToPlayer, ...)\`, \`ExecuteHam\``,
		ru: `Отдаёт оружие игроку, как при подборе; \`true\` — он его взял.

Pawn: \`ExecuteHamB(Ham_Item_AddToPlayer, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.deploy': {
		en: `Draws the weapon in its owner's hands, as switching to it does - the model and the animation shown again: \`knife.deploy()\`. \`true\` when it was drawn.

Pawn: \`ExecuteHamB(Ham_Item_Deploy, ...)\`, \`ExecuteHam\``,
		ru: `Достаёт оружие в руки владельца, как при переключении на него, — модель и анимация показываются заново: \`knife.deploy()\`. \`true\` — достал.

Pawn: \`ExecuteHamB(Ham_Item_Deploy, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.holster': {
		en: `Puts the weapon away, as switching from it does.

Pawn: \`ExecuteHamB(Ham_Item_Holster, ...)\`, \`ExecuteHam\``,
		ru: `Убирает оружие, как при переключении с него.

Pawn: \`ExecuteHamB(Ham_Item_Holster, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.drop': {
		en: `Drops the weapon out of its owner's inventory.

Pawn: \`ExecuteHamB(Ham_Item_Drop, ...)\`, \`ExecuteHam\``,
		ru: `Выбрасывает оружие из инвентаря владельца.

Pawn: \`ExecuteHamB(Ham_Item_Drop, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.attachToPlayer': {
		en: `Attaches the weapon to the player as his, without the pick-up.

Pawn: \`ExecuteHamB(Ham_Item_AttachToPlayer, ...)\`, \`ExecuteHam\``,
		ru: `Прикрепляет оружие к игроку как его собственное, без подбора.

Pawn: \`ExecuteHamB(Ham_Item_AttachToPlayer, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.extractAmmo': {
		en: `Moves this weapon's ammo into \`target\`, as picking up a second one of a kind does; the ammo moved.

Pawn: \`ExecuteHamB(Ham_Weapon_ExtractAmmo, ...)\`, \`ExecuteHam\``,
		ru: `Перекладывает патроны этого оружия в \`target\`, как при подборе второго такого же; возвращает переложенное.

Pawn: \`ExecuteHamB(Ham_Weapon_ExtractAmmo, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.extractClipAmmo': {
		en: `Moves the ammo in this weapon's clip into \`target\`; the ammo moved.

Pawn: \`ExecuteHamB(Ham_Weapon_ExtractClipAmmo, ...)\`, \`ExecuteHam\``,
		ru: `Перекладывает патроны из обоймы этого оружия в \`target\`; возвращает переложенное.

Pawn: \`ExecuteHamB(Ham_Weapon_ExtractClipAmmo, ...)\`, \`ExecuteHam\``,
	},

	'Weapon.resetEmptySound': {
		en: `Lets the empty click sound again on the next try.

Pawn: \`ExecuteHamB(Ham_Weapon_ResetEmptySound, ...)\`, \`ExecuteHam\``,
		ru: `Разрешает щелчку пустого оружия прозвучать снова при следующей попытке.

Pawn: \`ExecuteHamB(Ham_Weapon_ResetEmptySound, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.primaryAttack': {
		en: `Fires the weapon's primary attack - a shot, a knife's slash - as the left click does.

Pawn: \`ExecuteHamB(Ham_Weapon_PrimaryAttack, ...)\`, \`ExecuteHam\``,
		ru: `Выполняет основную атаку оружия — выстрел, удар ножом, — как левый клик.

Pawn: \`ExecuteHamB(Ham_Weapon_PrimaryAttack, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.secondaryAttack': {
		en: `Fires the weapon's secondary attack - a knife's stab, a scope - as the right click does: \`knife.secondaryAttack()\`.

Pawn: \`ExecuteHamB(Ham_Weapon_SecondaryAttack, ...)\`, \`ExecuteHam\``,
		ru: `Выполняет вторую атаку оружия — укол ножом, прицел, — как правый клик: \`knife.secondaryAttack()\`.

Pawn: \`ExecuteHamB(Ham_Weapon_SecondaryAttack, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.reload': {
		en: `Reloads the weapon, as the reload key does.

Pawn: \`ExecuteHamB(Ham_Weapon_Reload, ...)\`, \`ExecuteHam\``,
		ru: `Перезаряжает оружие, как клавиша перезарядки.

Pawn: \`ExecuteHamB(Ham_Weapon_Reload, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.weaponIdle': {
		en: `Runs the weapon's idle, which plays its idle animation.

Pawn: \`ExecuteHamB(Ham_Weapon_WeaponIdle, ...)\`, \`ExecuteHam\``,
		ru: `Выполняет бездействие оружия, которое проигрывает анимацию ожидания.

Pawn: \`ExecuteHamB(Ham_Weapon_WeaponIdle, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.retireWeapon': {
		en: `Retires the weapon - one out of ammo - and switches its owner to his next best.

Pawn: \`ExecuteHamB(Ham_Weapon_RetireWeapon, ...)\`, \`ExecuteHam\``,
		ru: `Убирает оружие — например, без патронов — и переключает владельца на следующее лучшее.

Pawn: \`ExecuteHamB(Ham_Weapon_RetireWeapon, ...)\`, \`ExecuteHam\``,
	},
	'Weapon.sendWeaponAnim': {
		en: `Plays one of the weapon's view-model animations by its number; \`skipLocal\` leaves out a client that predicts it himself.

Pawn: \`ExecuteHamB(Ham_CS_Weapon_SendWeaponAnim, ...)\`, \`ExecuteHam\``,
		ru: `Проигрывает анимацию модели оружия от первого лица по номеру; \`skipLocal\` пропускает клиента, который предсказывает её сам.

Pawn: \`ExecuteHamB(Ham_CS_Weapon_SendWeaponAnim, ...)\`, \`ExecuteHam\``,
	},
};
