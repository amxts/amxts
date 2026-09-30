// The tooltips of as/effects.ts, in both languages: scripts/apply-docs.ts writes the
// one AMXTS_DOCS_LANG picks into the JSDoc above each element.
export default {
	'EffectRecipients': {
		en: `The players who see an effect - the second argument of every \`effects\` function; everyone when it is left out. An effect is sent as the game sends its own: a player whose connection drops it misses it.`,
		ru: `Игроки, которые видят эффект, — второй аргумент каждой функции \`effects\`; если его нет — все. Эффект отправляется так, как игра отправляет свои: игрок, чьё соединение его потеряло, его не увидит.`,
	},
	'EffectRecipients.near': {
		en: `
			Only the players who can see this point, e.g. \`{ near: grenade.origin }\`.

			Pawn: \`MSG_PVS\`
		`,
		ru: `
			Только игроки, которым видна эта точка, например \`{ near: grenade.origin }\`.

			Pawn: \`MSG_PVS\`
		`,
	},
	'EffectRecipients.to': {
		en: `
			Only this player, e.g. \`{ to: player }\`.

			Pawn: \`MSG_ONE_UNRELIABLE\`
		`,
		ru: `
			Только этот игрок, например \`{ to: player }\`.

			Pawn: \`MSG_ONE_UNRELIABLE\`
		`,
	},
	'PointEffectOptions': {
		en: `The options of \`effects.gunshot\`, \`effects.sparks\`, \`effects.tarExplosion\`, \`effects.lavaSplash\` and \`effects.teleport\`.`,
		ru: `Настройки \`effects.gunshot\`, \`effects.sparks\`, \`effects.tarExplosion\`, \`effects.lavaSplash\` и \`effects.teleport\`.`,
	},
	'PointEffectOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'SegmentEffectOptions': {
		en: `The options of \`effects.tracer\` and \`effects.showLine\`.`,
		ru: `Настройки \`effects.tracer\` и \`effects.showLine\`.`,
	},
	'SegmentEffectOptions.start': {
		en: `The point the effect starts from.`,
		ru: `Точка, откуда начинается эффект.`,
	},
	'SegmentEffectOptions.end': {
		en: `The point the effect ends at.`,
		ru: `Точка, где эффект заканчивается.`,
	},
	'EntityEffectOptions': {
		en: `The options of \`effects.killBeams\`.`,
		ru: `Настройки \`effects.killBeams\`.`,
	},
	'EntityEffectOptions.entity': {
		en: `The entity whose beams go.`,
		ru: `Сущность, чьи лучи исчезают.`,
	},
	'PlayerEffectOptions': {
		en: `The options of \`effects.killPlayerAttachments\`.`,
		ru: `Настройки \`effects.killPlayerAttachments\`.`,
	},
	'PlayerEffectOptions.player': {
		en: `The player whose attached models go.`,
		ru: `Игрок, чьи прикреплённые модели исчезают.`,
	},
	'BeamPointsOptions': {
		en: `The options of \`effects.beamPoints\`.`,
		ru: `Настройки \`effects.beamPoints\`.`,
	},
	'BeamPointsOptions.start': {
		en: `The point the beam starts from.`,
		ru: `Точка, откуда идёт луч.`,
	},
	'BeamPointsOptions.end': {
		en: `The point the beam ends at.`,
		ru: `Точка, где кончается луч.`,
	},
	'BeamPointsOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'BeamPointsOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'BeamPointsOptions.width': {
		en: `The beam's width, \`0\` to \`255\`: \`10\` is one unit.`,
		ru: `Толщина луча, от \`0\` до \`255\`: \`10\` — одна единица.`,
	},
	'BeamPointsOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'BeamPointsOptions.alpha': {
		en: `The brightness, \`0\` to \`255\`; \`255\` by default.`,
		ru: `Яркость, от \`0\` до \`255\`; по умолчанию \`255\`.`,
	},
	'BeamPointsOptions.noise': {
		en: `The beam's waver, \`0\` to \`255\`: \`100\` is one unit; \`0\` by default, a straight beam.`,
		ru: `Дрожание луча, от \`0\` до \`255\`: \`100\` — одна единица; по умолчанию \`0\` — прямой луч.`,
	},
	'BeamPointsOptions.frame': {
		en: `The sprite's frame the beam starts from; \`0\` by default.`,
		ru: `Кадр спрайта, с которого начинается луч; по умолчанию \`0\`.`,
	},
	'BeamPointsOptions.frameRate': {
		en: `The sprite's frame rate, in tenths of a frame a second; \`0\` by default.`,
		ru: `Частота кадров спрайта, в десятых долях кадра в секунду; по умолчанию \`0\`.`,
	},
	'BeamPointsOptions.speed': {
		en: `The speed the sprite scrolls along the beam, in tenths of a unit a second; \`0\` by default.`,
		ru: `Скорость, с которой спрайт бежит вдоль луча, в десятых долях единицы в секунду; по умолчанию \`0\`.`,
	},
	'BeamEntityPointOptions': {
		en: `The options of \`effects.beamEntityPoint\`.`,
		ru: `Настройки \`effects.beamEntityPoint\`.`,
	},
	'BeamEntityPointOptions.start': {
		en: `The entity the beam starts from; the beam follows it as it moves.`,
		ru: `Сущность, от которой идёт луч; луч следует за ней, когда она движется.`,
	},
	'BeamEntityPointOptions.end': {
		en: `The point the beam ends at.`,
		ru: `Точка, где кончается луч.`,
	},
	'BeamEntityPointOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'BeamEntityPointOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'BeamEntityPointOptions.width': {
		en: `The beam's width, \`0\` to \`255\`: \`10\` is one unit.`,
		ru: `Толщина луча, от \`0\` до \`255\`: \`10\` — одна единица.`,
	},
	'BeamEntityPointOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'BeamEntityPointOptions.alpha': {
		en: `The brightness, \`0\` to \`255\`; \`255\` by default.`,
		ru: `Яркость, от \`0\` до \`255\`; по умолчанию \`255\`.`,
	},
	'BeamEntityPointOptions.noise': {
		en: `The beam's waver, \`0\` to \`255\`: \`100\` is one unit; \`0\` by default, a straight beam.`,
		ru: `Дрожание луча, от \`0\` до \`255\`: \`100\` — одна единица; по умолчанию \`0\` — прямой луч.`,
	},
	'BeamEntityPointOptions.frame': {
		en: `The sprite's frame the beam starts from; \`0\` by default.`,
		ru: `Кадр спрайта, с которого начинается луч; по умолчанию \`0\`.`,
	},
	'BeamEntityPointOptions.frameRate': {
		en: `The sprite's frame rate, in tenths of a frame a second; \`0\` by default.`,
		ru: `Частота кадров спрайта, в десятых долях кадра в секунду; по умолчанию \`0\`.`,
	},
	'BeamEntityPointOptions.speed': {
		en: `The speed the sprite scrolls along the beam, in tenths of a unit a second; \`0\` by default.`,
		ru: `Скорость, с которой спрайт бежит вдоль луча, в десятых долях единицы в секунду; по умолчанию \`0\`.`,
	},
	'BeamEntitiesOptions': {
		en: `The options of \`effects.beamEntities\` and \`effects.beamRing\`.`,
		ru: `Настройки \`effects.beamEntities\` и \`effects.beamRing\`.`,
	},
	'BeamEntitiesOptions.start': {
		en: `The entity the beam starts from; the beam follows it as it moves.`,
		ru: `Сущность, от которой идёт луч; луч следует за ней, когда она движется.`,
	},
	'BeamEntitiesOptions.end': {
		en: `The entity the beam ends at; the beam follows it as it moves.`,
		ru: `Сущность, в которую упирается луч; луч следует за ней, когда она движется.`,
	},
	'BeamEntitiesOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'BeamEntitiesOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'BeamEntitiesOptions.width': {
		en: `The beam's width, \`0\` to \`255\`: \`10\` is one unit.`,
		ru: `Толщина луча, от \`0\` до \`255\`: \`10\` — одна единица.`,
	},
	'BeamEntitiesOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'BeamEntitiesOptions.alpha': {
		en: `The brightness, \`0\` to \`255\`; \`255\` by default.`,
		ru: `Яркость, от \`0\` до \`255\`; по умолчанию \`255\`.`,
	},
	'BeamEntitiesOptions.noise': {
		en: `The beam's waver, \`0\` to \`255\`: \`100\` is one unit; \`0\` by default, a straight beam.`,
		ru: `Дрожание луча, от \`0\` до \`255\`: \`100\` — одна единица; по умолчанию \`0\` — прямой луч.`,
	},
	'BeamEntitiesOptions.frame': {
		en: `The sprite's frame the beam starts from; \`0\` by default.`,
		ru: `Кадр спрайта, с которого начинается луч; по умолчанию \`0\`.`,
	},
	'BeamEntitiesOptions.frameRate': {
		en: `The sprite's frame rate, in tenths of a frame a second; \`0\` by default.`,
		ru: `Частота кадров спрайта, в десятых долях кадра в секунду; по умолчанию \`0\`.`,
	},
	'BeamEntitiesOptions.speed': {
		en: `The speed the sprite scrolls along the beam, in tenths of a unit a second; \`0\` by default.`,
		ru: `Скорость, с которой спрайт бежит вдоль луча, в десятых долях единицы в секунду; по умолчанию \`0\`.`,
	},
	'BeamCircleOptions': {
		en: `The options of \`effects.beamCylinder\`, \`effects.beamDisk\` and \`effects.beamTorus\`.`,
		ru: `Настройки \`effects.beamCylinder\`, \`effects.beamDisk\` и \`effects.beamTorus\`.`,
	},
	'BeamCircleOptions.at': {
		en: `The circle's centre.`,
		ru: `Центр круга.`,
	},
	'BeamCircleOptions.radius': {
		en: `The circle's radius at the end of its life, in units.`,
		ru: `Радиус круга к концу его жизни, в единицах.`,
	},
	'BeamCircleOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'BeamCircleOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'BeamCircleOptions.width': {
		en: `The beam's width, \`0\` to \`255\`: \`10\` is one unit.`,
		ru: `Толщина луча, от \`0\` до \`255\`: \`10\` — одна единица.`,
	},
	'BeamCircleOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'BeamCircleOptions.alpha': {
		en: `The brightness, \`0\` to \`255\`; \`255\` by default.`,
		ru: `Яркость, от \`0\` до \`255\`; по умолчанию \`255\`.`,
	},
	'BeamCircleOptions.noise': {
		en: `The beam's waver, \`0\` to \`255\`: \`100\` is one unit; \`0\` by default, a straight beam.`,
		ru: `Дрожание луча, от \`0\` до \`255\`: \`100\` — одна единица; по умолчанию \`0\` — прямой луч.`,
	},
	'BeamCircleOptions.frame': {
		en: `The sprite's frame the beam starts from; \`0\` by default.`,
		ru: `Кадр спрайта, с которого начинается луч; по умолчанию \`0\`.`,
	},
	'BeamCircleOptions.frameRate': {
		en: `The sprite's frame rate, in tenths of a frame a second; \`0\` by default.`,
		ru: `Частота кадров спрайта, в десятых долях кадра в секунду; по умолчанию \`0\`.`,
	},
	'BeamCircleOptions.speed': {
		en: `The speed the sprite scrolls along the beam, in tenths of a unit a second; \`0\` by default.`,
		ru: `Скорость, с которой спрайт бежит вдоль луча, в десятых долях единицы в секунду; по умолчанию \`0\`.`,
	},
	'BeamFollowOptions': {
		en: `The options of \`effects.beamFollow\`.`,
		ru: `Настройки \`effects.beamFollow\`.`,
	},
	'BeamFollowOptions.entity': {
		en: `The entity the trail follows - a grenade, a player.`,
		ru: `Сущность, за которой тянется след, — граната, игрок.`,
	},
	'BeamFollowOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'BeamFollowOptions.life': {
		en: `The lifetime of each piece of the trail, in seconds, up to \`25.5\`.`,
		ru: `Время жизни каждого куска следа, в секундах, до \`25.5\`.`,
	},
	'BeamFollowOptions.width': {
		en: `The beam's width, \`0\` to \`255\`: \`10\` is one unit.`,
		ru: `Толщина луча, от \`0\` до \`255\`: \`10\` — одна единица.`,
	},
	'BeamFollowOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'BeamFollowOptions.alpha': {
		en: `The brightness, \`0\` to \`255\`; \`255\` by default.`,
		ru: `Яркость, от \`0\` до \`255\`; по умолчанию \`255\`.`,
	},
	'BeamSpriteOptions': {
		en: `The options of \`effects.beamSprite\`.`,
		ru: `Настройки \`effects.beamSprite\`.`,
	},
	'BeamSpriteOptions.start': {
		en: `The point the beam starts from.`,
		ru: `Точка, откуда идёт луч.`,
	},
	'BeamSpriteOptions.end': {
		en: `The point the beam ends at, where the end sprite is.`,
		ru: `Точка, где кончается луч и стоит концевой спрайт.`,
	},
	'BeamSpriteOptions.sprite': {
		en: `The beam's sprite, as \`server.precache\` returned it.`,
		ru: `Спрайт луча, как его вернул \`server.precache\`.`,
	},
	'BeamSpriteOptions.endSprite': {
		en: `The sprite at the beam's end, as \`server.precache\` returned it.`,
		ru: `Спрайт на конце луча, как его вернул \`server.precache\`.`,
	},
	'LightningOptions': {
		en: `The options of \`effects.lightning\`.`,
		ru: `Настройки \`effects.lightning\`.`,
	},
	'LightningOptions.start': {
		en: `The point the bolt starts from.`,
		ru: `Точка, откуда бьёт молния.`,
	},
	'LightningOptions.end': {
		en: `The point the bolt ends at.`,
		ru: `Точка, куда бьёт молния.`,
	},
	'LightningOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'LightningOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'LightningOptions.width': {
		en: `The beam's width, \`0\` to \`255\`: \`10\` is one unit.`,
		ru: `Толщина луча, от \`0\` до \`255\`: \`10\` — одна единица.`,
	},
	'LightningOptions.noise': {
		en: `The beam's waver, \`0\` to \`255\`: \`100\` is one unit; \`0\` by default, a straight beam.`,
		ru: `Дрожание луча, от \`0\` до \`255\`: \`100\` — одна единица; по умолчанию \`0\` — прямой луч.`,
	},
	'ExplosionOptions': {
		en: `The options of \`effects.explosion\`.`,
		ru: `Настройки \`effects.explosion\`.`,
	},
	'ExplosionOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'ExplosionOptions.sprite': {
		en: `The explosion's sprite, e.g. \`sprites/zerogxplode.spr\`, as \`server.precache\` returned it.`,
		ru: `Спрайт взрыва, например \`sprites/zerogxplode.spr\`, как его вернул \`server.precache\`.`,
	},
	'ExplosionOptions.scale': {
		en: `The sprite's size, \`0\` to \`255\`: \`10\` is its own size; \`10\` by default.`,
		ru: `Размер спрайта, от \`0\` до \`255\`: \`10\` — его собственный размер; по умолчанию \`10\`.`,
	},
	'ExplosionOptions.frameRate': {
		en: `The sprite's frames a second; \`15\` by default.`,
		ru: `Кадров спрайта в секунду; по умолчанию \`15\`.`,
	},
	'ExplosionOptions.additive': {
		en: `Whether the sprite is drawn glowing, added to what is behind it; \`true\` by default, \`false\` draws it opaque.`,
		ru: `Рисуется ли спрайт светящимся, поверх того, что за ним; по умолчанию \`true\`, \`false\` — непрозрачным.`,
	},
	'ExplosionOptions.lights': {
		en: `Whether the explosion lights up the world around it; \`true\` by default.`,
		ru: `Освещает ли взрыв мир вокруг; по умолчанию \`true\`.`,
	},
	'ExplosionOptions.sound': {
		en: `Whether the explosion is heard; \`true\` by default.`,
		ru: `Слышен ли взрыв; по умолчанию \`true\`.`,
	},
	'ExplosionOptions.particles': {
		en: `Whether the explosion throws out particles; \`true\` by default.`,
		ru: `Разбрасывает ли взрыв частицы; по умолчанию \`true\`.`,
	},
	'SmokeOptions': {
		en: `The options of \`effects.smoke\`.`,
		ru: `Настройки \`effects.smoke\`.`,
	},
	'SmokeOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'SmokeOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'SmokeOptions.scale': {
		en: `The sprite's size, \`0\` to \`255\`: \`10\` is its own size; \`10\` by default.`,
		ru: `Размер спрайта, от \`0\` до \`255\`: \`10\` — его собственный размер; по умолчанию \`10\`.`,
	},
	'SmokeOptions.frameRate': {
		en: `The sprite's frames a second; \`10\` by default.`,
		ru: `Кадров спрайта в секунду; по умолчанию \`10\`.`,
	},
	'ParticleExplosionOptions': {
		en: `The options of \`effects.particleExplosion\`.`,
		ru: `Настройки \`effects.particleExplosion\`.`,
	},
	'ParticleExplosionOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'ParticleExplosionOptions.palette': {
		en: `The first colour of the game's palette the particles take, \`0\` to \`255\`; \`0\` by default.`,
		ru: `Первый цвет палитры игры, который берут частицы, от \`0\` до \`255\`; по умолчанию \`0\`.`,
	},
	'ParticleExplosionOptions.colors': {
		en: `The number of the palette's colours from there on the particles take; \`16\` by default.`,
		ru: `Число цветов палитры, начиная с него, которые берут частицы; по умолчанию \`16\`.`,
	},
	'ImplosionOptions': {
		en: `The options of \`effects.implosion\`.`,
		ru: `Настройки \`effects.implosion\`.`,
	},
	'ImplosionOptions.at': {
		en: `The point the tracers fly into.`,
		ru: `Точка, куда слетаются трассеры.`,
	},
	'ImplosionOptions.radius': {
		en: `The distance the tracers start from, in units, up to \`255\`.`,
		ru: `Расстояние, с которого летят трассеры, в единицах, до \`255\`.`,
	},
	'ImplosionOptions.count': {
		en: `The number of tracers, \`0\` to \`255\`.`,
		ru: `Число трассеров, от \`0\` до \`255\`.`,
	},
	'ImplosionOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'SpriteTrailOptions': {
		en: `The options of \`effects.spriteTrail\`.`,
		ru: `Настройки \`effects.spriteTrail\`.`,
	},
	'SpriteTrailOptions.start': {
		en: `The point the effect starts from.`,
		ru: `Точка, откуда начинается эффект.`,
	},
	'SpriteTrailOptions.end': {
		en: `The point the effect ends at.`,
		ru: `Точка, где эффект заканчивается.`,
	},
	'SpriteTrailOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'SpriteTrailOptions.count': {
		en: `The number of sprites, \`0\` to \`255\`.`,
		ru: `Число спрайтов, от \`0\` до \`255\`.`,
	},
	'SpriteTrailOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'SpriteTrailOptions.scale': {
		en: `The sprite's size, \`0\` to \`255\`: \`10\` is its own size; \`10\` by default.`,
		ru: `Размер спрайта, от \`0\` до \`255\`: \`10\` — его собственный размер; по умолчанию \`10\`.`,
	},
	'SpriteTrailOptions.speed': {
		en: `The sprites' speed along the line, \`0\` to \`255\`: \`1\` is ten units a second; \`10\` by default.`,
		ru: `Скорость спрайтов вдоль линии, от \`0\` до \`255\`: \`1\` — десять единиц в секунду; по умолчанию \`10\`.`,
	},
	'SpriteTrailOptions.randomness': {
		en: `The spread of the sprites' speeds, \`0\` to \`255\`: \`1\` is ten units a second; \`10\` by default.`,
		ru: `Разброс скоростей спрайтов, от \`0\` до \`255\`: \`1\` — десять единиц в секунду; по умолчанию \`10\`.`,
	},
	'SpriteOptions': {
		en: `The options of \`effects.sprite\`.`,
		ru: `Настройки \`effects.sprite\`.`,
	},
	'SpriteOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'SpriteOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'SpriteOptions.scale': {
		en: `The sprite's size, \`0\` to \`255\`: \`10\` is its own size; \`10\` by default.`,
		ru: `Размер спрайта, от \`0\` до \`255\`: \`10\` — его собственный размер; по умолчанию \`10\`.`,
	},
	'SpriteOptions.alpha': {
		en: `The brightness, \`0\` to \`255\`; \`255\` by default.`,
		ru: `Яркость, от \`0\` до \`255\`; по умолчанию \`255\`.`,
	},
	'GlowSpriteOptions': {
		en: `The options of \`effects.glowSprite\`.`,
		ru: `Настройки \`effects.glowSprite\`.`,
	},
	'GlowSpriteOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'GlowSpriteOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'GlowSpriteOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'GlowSpriteOptions.scale': {
		en: `The sprite's size, \`0\` to \`255\`: \`10\` is its own size; \`10\` by default.`,
		ru: `Размер спрайта, от \`0\` до \`255\`: \`10\` — его собственный размер; по умолчанию \`10\`.`,
	},
	'GlowSpriteOptions.alpha': {
		en: `The brightness, \`0\` to \`255\`; \`255\` by default.`,
		ru: `Яркость, от \`0\` до \`255\`; по умолчанию \`255\`.`,
	},
	'StreakSplashOptions': {
		en: `The options of \`effects.streakSplash\`.`,
		ru: `Настройки \`effects.streakSplash\`.`,
	},
	'StreakSplashOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'StreakSplashOptions.direction': {
		en: `The direction the spray goes, a vector: its length is not read.`,
		ru: `Направление, куда летят брызги, — вектор; его длина не важна.`,
	},
	'StreakSplashOptions.count': {
		en: `The number of tracers, up to \`32767\`.`,
		ru: `Число трассеров, до \`32767\`.`,
	},
	'StreakSplashOptions.speed': {
		en: `The tracers' speed, in units a second.`,
		ru: `Скорость трассеров, в единицах в секунду.`,
	},
	'StreakSplashOptions.randomness': {
		en: `The spread of the tracers' speeds, in units a second; \`0\` by default.`,
		ru: `Разброс скоростей трассеров, в единицах в секунду; по умолчанию \`0\`.`,
	},
	'StreakSplashOptions.palette': {
		en: `The tracers' colour in the game's palette, \`0\` to \`255\`; \`5\` by default, yellow sparks.`,
		ru: `Цвет трассеров в палитре игры, от \`0\` до \`255\`; по умолчанию \`5\` — жёлтые искры.`,
	},
	'DynamicLightOptions': {
		en: `The options of \`effects.dynamicLight\`.`,
		ru: `Настройки \`effects.dynamicLight\`.`,
	},
	'DynamicLightOptions.at': {
		en: `The point the light shines from.`,
		ru: `Точка, откуда светит свет.`,
	},
	'DynamicLightOptions.radius': {
		en: `The light's reach, in units, up to \`2550\`.`,
		ru: `Радиус света, в единицах, до \`2550\`.`,
	},
	'DynamicLightOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'DynamicLightOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'DynamicLightOptions.decay': {
		en: `The speed the light shrinks at, in units a second; \`0\` by default, not at all.`,
		ru: `Скорость, с которой свет сжимается, в единицах в секунду; по умолчанию \`0\` — не сжимается.`,
	},
	'EntityLightOptions': {
		en: `The options of \`effects.entityLight\`.`,
		ru: `Настройки \`effects.entityLight\`.`,
	},
	'EntityLightOptions.entity': {
		en: `The entity the light follows.`,
		ru: `Сущность, за которой следует свет.`,
	},
	'EntityLightOptions.at': {
		en: `The point the light starts at.`,
		ru: `Точка, где свет появляется.`,
	},
	'EntityLightOptions.radius': {
		en: `The light's reach, in units.`,
		ru: `Радиус света, в единицах.`,
	},
	'EntityLightOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'EntityLightOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'EntityLightOptions.decay': {
		en: `The speed the light shrinks at, in units a second; \`0\` by default, not at all.`,
		ru: `Скорость, с которой свет сжимается, в единицах в секунду; по умолчанию \`0\` — не сжимается.`,
	},
	'LineOptions': {
		en: `The options of \`effects.line\`.`,
		ru: `Настройки \`effects.line\`.`,
	},
	'LineOptions.start': {
		en: `The point the effect starts from.`,
		ru: `Точка, откуда начинается эффект.`,
	},
	'LineOptions.end': {
		en: `The point the effect ends at.`,
		ru: `Точка, где эффект заканчивается.`,
	},
	'LineOptions.life': {
		en: `The effect's lifetime, in seconds.`,
		ru: `Время жизни эффекта, в секундах.`,
	},
	'LineOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'BoxOptions': {
		en: `The options of \`effects.box\`.`,
		ru: `Настройки \`effects.box\`.`,
	},
	'BoxOptions.mins': {
		en: `The box's lower corner.`,
		ru: `Нижний угол коробки.`,
	},
	'BoxOptions.maxs': {
		en: `The box's upper corner.`,
		ru: `Верхний угол коробки.`,
	},
	'BoxOptions.life': {
		en: `The effect's lifetime, in seconds.`,
		ru: `Время жизни эффекта, в секундах.`,
	},
	'BoxOptions.color': {
		en: `The colour in CSS hex, e.g. \`"#0096ff"\` or \`"#09f"\`; white by default.`,
		ru: `Цвет в шестнадцатеричной записи CSS, например \`"#0096ff"\` или \`"#09f"\`; по умолчанию белый.`,
	},
	'LargeFunnelOptions': {
		en: `The options of \`effects.largeFunnel\`.`,
		ru: `Настройки \`effects.largeFunnel\`.`,
	},
	'LargeFunnelOptions.at': {
		en: `The funnel's bottom.`,
		ru: `Низ воронки.`,
	},
	'LargeFunnelOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'LargeFunnelOptions.reverse': {
		en: `\`true\`: the sprites fly out of the funnel rather than into it.`,
		ru: `\`true\` — спрайты вылетают из воронки, а не влетают в неё.`,
	},
	'BloodOptions': {
		en: `The options of \`effects.blood\` and \`effects.bloodStream\`.`,
		ru: `Настройки \`effects.blood\` и \`effects.bloodStream\`.`,
	},
	'BloodOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'BloodOptions.direction': {
		en: `The direction the spray goes, a vector: its length is not read.`,
		ru: `Направление, куда летят брызги, — вектор; его длина не важна.`,
	},
	'BloodOptions.speed': {
		en: `The spray's speed, \`0\` to \`255\`.`,
		ru: `Скорость брызг, от \`0\` до \`255\`.`,
	},
	'BloodOptions.palette': {
		en: `The blood's colour in the game's palette, \`0\` to \`255\`: \`247\` (the default) is red, \`195\` yellow.`,
		ru: `Цвет крови в палитре игры, от \`0\` до \`255\`: \`247\` (по умолчанию) — красный, \`195\` — жёлтый.`,
	},
	'FizzOptions': {
		en: `The options of \`effects.fizz\`.`,
		ru: `Настройки \`effects.fizz\`.`,
	},
	'FizzOptions.entity': {
		en: `The entity the bubbles rise in - a brush, such as water.`,
		ru: `Сущность, в которой поднимаются пузыри, — браш, например вода.`,
	},
	'FizzOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'FizzOptions.density': {
		en: `The bubbles' density, \`0\` to \`255\`.`,
		ru: `Плотность пузырей, от \`0\` до \`255\`.`,
	},
	'BounceSound': {
		en: `The sound a model makes as it bounces, one of \`"none"\`, \`"shell"\` or \`"shotgunShell"\`.`,
		ru: `Звук, с которым отскакивает модель, одно из \`"none"\`, \`"shell"\` или \`"shotgunShell"\`.`,
	},
	'ModelOptions': {
		en: `The options of \`effects.model\`.`,
		ru: `Настройки \`effects.model\`.`,
	},
	'ModelOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'ModelOptions.velocity': {
		en: `The starting velocity, in units a second.`,
		ru: `Начальная скорость, в единицах в секунду.`,
	},
	'ModelOptions.model': {
		en: `The model to draw - a \`.mdl\` or a sprite - as \`server.precache\` returned it.`,
		ru: `Модель, которая рисуется, — \`.mdl\` или спрайт, — как её вернул \`server.precache\`.`,
	},
	'ModelOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'ModelOptions.yaw': {
		en: `The model's starting turn around the vertical, in degrees; \`0\` by default.`,
		ru: `Начальный поворот модели вокруг вертикали, в градусах; по умолчанию \`0\`.`,
	},
	'ModelOptions.sound': {
		en: `The sound the model makes as it bounces, one of \`"none"\` (the default), \`"shell"\` or \`"shotgunShell"\`.`,
		ru: `Звук при отскоке, одно из \`"none"\` (по умолчанию), \`"shell"\` или \`"shotgunShell"\`.`,
	},
	'ExplodeModelOptions': {
		en: `The options of \`effects.explodeModel\`.`,
		ru: `Настройки \`effects.explodeModel\`.`,
	},
	'ExplodeModelOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'ExplodeModelOptions.speed': {
		en: `The pieces' speed, in units a second.`,
		ru: `Скорость осколков, в единицах в секунду.`,
	},
	'ExplodeModelOptions.model': {
		en: `The model to draw - a \`.mdl\` or a sprite - as \`server.precache\` returned it.`,
		ru: `Модель, которая рисуется, — \`.mdl\` или спрайт, — как её вернул \`server.precache\`.`,
	},
	'ExplodeModelOptions.count': {
		en: `The number of pieces, up to \`32767\`.`,
		ru: `Число осколков, до \`32767\`.`,
	},
	'ExplodeModelOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'BreakMaterial': {
		en: `The material a broken thing was made of - the sound its pieces make: one of \`"none"\`, \`"glass"\`, \`"metal"\`, \`"flesh"\`, \`"wood"\` or \`"concrete"\`.`,
		ru: `Материал разбитой вещи — звук её осколков: одно из \`"none"\`, \`"glass"\`, \`"metal"\`, \`"flesh"\`, \`"wood"\` или \`"concrete"\`.`,
	},
	'BreakModelOptions': {
		en: `The options of \`effects.breakModel\`.`,
		ru: `Настройки \`effects.breakModel\`.`,
	},
	'BreakModelOptions.at': {
		en: `The centre of the box the pieces fly out of.`,
		ru: `Центр коробки, из которой летят осколки.`,
	},
	'BreakModelOptions.size': {
		en: `The box's size along each axis, in units.`,
		ru: `Размер коробки по каждой оси, в единицах.`,
	},
	'BreakModelOptions.velocity': {
		en: `The starting velocity, in units a second.`,
		ru: `Начальная скорость, в единицах в секунду.`,
	},
	'BreakModelOptions.model': {
		en: `The model to draw - a \`.mdl\` or a sprite - as \`server.precache\` returned it.`,
		ru: `Модель, которая рисуется, — \`.mdl\` или спрайт, — как её вернул \`server.precache\`.`,
	},
	'BreakModelOptions.count': {
		en: `The number of pieces, \`0\` to \`255\`.`,
		ru: `Число частиц, от \`0\` до \`255\`.`,
	},
	'BreakModelOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'BreakModelOptions.randomness': {
		en: `The spread of the pieces' speeds, \`0\` to \`255\`: \`1\` is ten units a second; \`0\` by default.`,
		ru: `Разброс скоростей осколков, от \`0\` до \`255\`: \`1\` — десять единиц в секунду; по умолчанию \`0\`.`,
	},
	'BreakModelOptions.material': {
		en: `The material the pieces sound as, one of \`"none"\` (the default), \`"glass"\`, \`"metal"\`, \`"flesh"\`, \`"wood"\` or \`"concrete"\`.`,
		ru: `Материал, которым звучат осколки, одно из \`"none"\` (по умолчанию), \`"glass"\`, \`"metal"\`, \`"flesh"\`, \`"wood"\` или \`"concrete"\`.`,
	},
	'BreakModelOptions.smoke': {
		en: `\`true\`: the pieces trail smoke.`,
		ru: `\`true\` — за осколками тянется дым.`,
	},
	'BreakModelOptions.transparent': {
		en: `\`true\`: the pieces are drawn see-through.`,
		ru: `\`true\` — осколки полупрозрачные.`,
	},
	'SpriteSprayOptions': {
		en: `The options of \`effects.spriteSpray\`.`,
		ru: `Настройки \`effects.spriteSpray\`.`,
	},
	'SpriteSprayOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'SpriteSprayOptions.velocity': {
		en: `The starting velocity, in units a second.`,
		ru: `Начальная скорость, в единицах в секунду.`,
	},
	'SpriteSprayOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'SpriteSprayOptions.count': {
		en: `The number of pieces, \`0\` to \`255\`.`,
		ru: `Число частиц, от \`0\` до \`255\`.`,
	},
	'SpriteSprayOptions.speed': {
		en: `The sprites' speed, \`0\` to \`255\`.`,
		ru: `Скорость спрайтов, от \`0\` до \`255\`.`,
	},
	'SpriteSprayOptions.noise': {
		en: `The spread of the sprites' directions, \`0\` to \`255\`; \`0\` by default.`,
		ru: `Разброс направлений спрайтов, от \`0\` до \`255\`; по умолчанию \`0\`.`,
	},
	'ArmorRicochetOptions': {
		en: `The options of \`effects.armorRicochet\`.`,
		ru: `Настройки \`effects.armorRicochet\`.`,
	},
	'ArmorRicochetOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'ArmorRicochetOptions.scale': {
		en: `The sprite's size, \`0\` to \`255\`: \`10\` is its own size; \`10\` by default.`,
		ru: `Размер спрайта, от \`0\` до \`255\`: \`10\` — его собственный размер; по умолчанию \`10\`.`,
	},
	'BubblesOptions': {
		en: `The options of \`effects.bubbles\` and \`effects.bubbleTrail\`.`,
		ru: `Настройки \`effects.bubbles\` и \`effects.bubbleTrail\`.`,
	},
	'BubblesOptions.start': {
		en: `One corner of the box, or one end of the line, the bubbles appear in.`,
		ru: `Один угол коробки или один конец линии, где появляются пузыри.`,
	},
	'BubblesOptions.end': {
		en: `The other corner of the box, or the other end of the line.`,
		ru: `Другой угол коробки или другой конец линии.`,
	},
	'BubblesOptions.height': {
		en: `The height the bubbles rise to, in units.`,
		ru: `Высота, до которой поднимаются пузыри, в единицах.`,
	},
	'BubblesOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'BubblesOptions.count': {
		en: `The number of bubbles, \`0\` to \`255\`.`,
		ru: `Число пузырей, от \`0\` до \`255\`.`,
	},
	'BubblesOptions.speed': {
		en: `The bubbles' speed, in units a second.`,
		ru: `Скорость пузырей, в единицах в секунду.`,
	},
	'BloodSpriteOptions': {
		en: `The options of \`effects.bloodSprite\`.`,
		ru: `Настройки \`effects.bloodSprite\`.`,
	},
	'BloodSpriteOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'BloodSpriteOptions.spray': {
		en: `The sprite of the drops that fall, e.g. \`sprites/bloodspray.spr\`, as \`server.precache\` returned it.`,
		ru: `Спрайт падающих капель, например \`sprites/bloodspray.spr\`, как его вернул \`server.precache\`.`,
	},
	'BloodSpriteOptions.drop': {
		en: `The sprite of the blot that stays a moment, e.g. \`sprites/blood.spr\`, as \`server.precache\` returned it.`,
		ru: `Спрайт пятна, которое держится мгновение, например \`sprites/blood.spr\`, как его вернул \`server.precache\`.`,
	},
	'BloodSpriteOptions.scale': {
		en: `The sprite's size, \`0\` to \`255\`: \`10\` is its own size; \`10\` by default.`,
		ru: `Размер спрайта, от \`0\` до \`255\`: \`10\` — его собственный размер; по умолчанию \`10\`.`,
	},
	'BloodSpriteOptions.palette': {
		en: `The blood's colour in the game's palette, \`0\` to \`255\`: \`247\` (the default) is red, \`195\` yellow.`,
		ru: `Цвет крови в палитре игры, от \`0\` до \`255\`: \`247\` (по умолчанию) — красный, \`195\` — жёлтый.`,
	},
	'ProjectileOptions': {
		en: `The options of \`effects.projectile\`.`,
		ru: `Настройки \`effects.projectile\`.`,
	},
	'ProjectileOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'ProjectileOptions.velocity': {
		en: `The starting velocity, in units a second.`,
		ru: `Начальная скорость, в единицах в секунду.`,
	},
	'ProjectileOptions.model': {
		en: `The model to draw - a \`.mdl\` or a sprite - as \`server.precache\` returned it.`,
		ru: `Модель, которая рисуется, — \`.mdl\` или спрайт, — как её вернул \`server.precache\`.`,
	},
	'ProjectileOptions.life': {
		en: `The projectile's lifetime, in whole seconds, up to \`255\`.`,
		ru: `Время жизни снаряда, в целых секундах, до \`255\`.`,
	},
	'ProjectileOptions.owner': {
		en: `The player the projectile passes through; left out, it hits anyone.`,
		ru: `Игрок, сквозь которого снаряд пролетает; если не задан, снаряд попадает в любого.`,
	},
	'SprayOptions': {
		en: `The options of \`effects.spray\`.`,
		ru: `Настройки \`effects.spray\`.`,
	},
	'SprayOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'SprayOptions.direction': {
		en: `The direction the spray goes, a vector: its length is not read.`,
		ru: `Направление, куда летят брызги, — вектор; его длина не важна.`,
	},
	'SprayOptions.model': {
		en: `The model to draw - a \`.mdl\` or a sprite - as \`server.precache\` returned it.`,
		ru: `Модель, которая рисуется, — \`.mdl\` или спрайт, — как её вернул \`server.precache\`.`,
	},
	'SprayOptions.count': {
		en: `The number of pieces, \`0\` to \`255\`.`,
		ru: `Число частиц, от \`0\` до \`255\`.`,
	},
	'SprayOptions.speed': {
		en: `The pieces' speed, \`0\` to \`255\`.`,
		ru: `Скорость частиц, от \`0\` до \`255\`.`,
	},
	'SprayOptions.noise': {
		en: `The spread of the pieces' directions, \`0\` to \`255\`; \`0\` by default.`,
		ru: `Разброс направлений частиц, от \`0\` до \`255\`; по умолчанию \`0\`.`,
	},
	'SprayOptions.renderMode': {
		en: `The pieces' render mode, as an entity's \`renderMode\`; \`"normal"\` by default.`,
		ru: `Режим отрисовки частиц, как \`renderMode\` сущности; по умолчанию \`"normal"\`.`,
	},
	'PlayerSpritesOptions': {
		en: `The options of \`effects.playerSprites\`.`,
		ru: `Настройки \`effects.playerSprites\`.`,
	},
	'PlayerSpritesOptions.player': {
		en: `The player the sprites come out of.`,
		ru: `Игрок, из которого вылетают спрайты.`,
	},
	'PlayerSpritesOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'PlayerSpritesOptions.count': {
		en: `The number of sprites, \`0\` to \`255\`.`,
		ru: `Число спрайтов, от \`0\` до \`255\`.`,
	},
	'PlayerSpritesOptions.variance': {
		en: `The spread of the sprites' sizes, in percent; \`0\` by default, all the same.`,
		ru: `Разброс размеров спрайтов, в процентах; по умолчанию \`0\` — все одинаковые.`,
	},
	'ParticleBurstOptions': {
		en: `The options of \`effects.particleBurst\`.`,
		ru: `Настройки \`effects.particleBurst\`.`,
	},
	'ParticleBurstOptions.at': {
		en: `The point the effect is at.`,
		ru: `Точка, где возникает эффект.`,
	},
	'ParticleBurstOptions.radius': {
		en: `The burst's radius, in units.`,
		ru: `Радиус вспышки, в единицах.`,
	},
	'ParticleBurstOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'ParticleBurstOptions.palette': {
		en: `The particles' colour in the game's palette, \`0\` to \`255\`; \`0\` by default.`,
		ru: `Цвет частиц в палитре игры, от \`0\` до \`255\`; по умолчанию \`0\`.`,
	},
	'FireRise': {
		en: `The share of a fire field's sprites that drift upwards, one of \`"none"\`, \`"some"\` (half of them) or \`"all"\`.`,
		ru: `Доля спрайтов огненного поля, уплывающих вверх, одно из \`"none"\`, \`"some"\` (половина) или \`"all"\`.`,
	},
	'FireBlend': {
		en: `The look of a fire field's sprites, one of \`"opaque"\`, \`"alpha"\` (half see-through) or \`"additive"\` (glowing).`,
		ru: `Вид спрайтов огненного поля, одно из \`"opaque"\`, \`"alpha"\` (полупрозрачные) или \`"additive"\` (светящиеся).`,
	},
	'FireFieldOptions': {
		en: `The options of \`effects.fireField\`.`,
		ru: `Настройки \`effects.fireField\`.`,
	},
	'FireFieldOptions.at': {
		en: `The field's centre.`,
		ru: `Центр поля.`,
	},
	'FireFieldOptions.radius': {
		en: `Half the side of the square the fire fills, in units.`,
		ru: `Половина стороны квадрата, который заполняет огонь, в единицах.`,
	},
	'FireFieldOptions.sprite': {
		en: `The sprite to draw, as \`server.precache\` returned it.`,
		ru: `Спрайт, который рисуется, — как его вернул \`server.precache\`.`,
	},
	'FireFieldOptions.count': {
		en: `The number of sprites, \`0\` to \`255\`.`,
		ru: `Число спрайтов, от \`0\` до \`255\`.`,
	},
	'FireFieldOptions.life': {
		en: `The effect's lifetime, in seconds, up to \`25.5\`.`,
		ru: `Время жизни эффекта, в секундах, до \`25.5\`.`,
	},
	'FireFieldOptions.rise': {
		en: `The share of the sprites that drift upwards, one of \`"none"\` (the default), \`"some"\` or \`"all"\`.`,
		ru: `Доля спрайтов, уплывающих вверх, одно из \`"none"\` (по умолчанию), \`"some"\` или \`"all"\`.`,
	},
	'FireFieldOptions.blend': {
		en: `The sprites' look, one of \`"opaque"\` (the default), \`"alpha"\` or \`"additive"\`.`,
		ru: `Вид спрайтов, одно из \`"opaque"\` (по умолчанию), \`"alpha"\` или \`"additive"\`.`,
	},
	'FireFieldOptions.loop': {
		en: `\`true\`: the sprites play at 15 frames a second; otherwise once over their lifetime.`,
		ru: `\`true\` — спрайты играют по 15 кадров в секунду; иначе — один раз за время жизни.`,
	},
	'FireFieldOptions.flat': {
		en: `\`true\`: every sprite starts at the same height, a flat field rather than a cube.`,
		ru: `\`true\` — все спрайты начинают с одной высоты: плоское поле, а не куб.`,
	},
	'PlayerAttachmentOptions': {
		en: `The options of \`effects.playerAttachment\`.`,
		ru: `Настройки \`effects.playerAttachment\`.`,
	},
	'PlayerAttachmentOptions.player': {
		en: `The player the model is attached to.`,
		ru: `Игрок, к которому прикреплена модель.`,
	},
	'PlayerAttachmentOptions.model': {
		en: `The model to draw - a \`.mdl\` or a sprite - as \`server.precache\` returned it.`,
		ru: `Модель, которая рисуется, — \`.mdl\` или спрайт, — как её вернул \`server.precache\`.`,
	},
	'PlayerAttachmentOptions.life': {
		en: `The effect's lifetime, in seconds.`,
		ru: `Время жизни эффекта, в секундах.`,
	},
	'PlayerAttachmentOptions.offset': {
		en: `The model's height above the player's origin, in units; \`0\` by default.`,
		ru: `Высота модели над точкой игрока, в единицах; по умолчанию \`0\`.`,
	},
	'effects': {
		en: `
			Temporary effects - beams, explosions, sprites, sparks, lights, blood - the game draws for a moment and forgets. One function per effect; the options are its arguments, the second argument who sees it:

			\`\`\`ts
			const shock = server.precache("sprites/shockwave.spr");

			effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60, color: "#0096ff", alpha: 200 }, { near: here });
			effects.sparks({ at: here });                          // everyone
			effects.beamFollow({ entity: grenade, sprite: shock, life: 1, width: 5 }, { to: player });
			\`\`\`

			Times are in seconds, a colour is CSS hex, a sprite or a model is what \`server.precache\` returned. An effect whose file is not precached is not sent, with a line in the console.

			Pawn: \`message_begin(..., SVC_TEMPENTITY)\`, \`TE_*\`
		`,
		ru: `
			Временные эффекты — лучи, взрывы, спрайты, искры, свет, кровь, — которые игра рисует на мгновение и забывает. Функция на эффект; настройки — его аргументы, второй аргумент — кто его видит:

			\`\`\`ts
			const shock = server.precache("sprites/shockwave.spr");

			effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60, color: "#0096ff", alpha: 200 }, { near: here });
			effects.sparks({ at: here });                          // все
			effects.beamFollow({ entity: grenade, sprite: shock, life: 1, width: 5 }, { to: player });
			\`\`\`

			Время — в секундах, цвет — шестнадцатеричная запись CSS, спрайт или модель — то, что вернул \`server.precache\`. Эффект, чей файл не прекэширован, не отправляется, а в консоли появляется строка.

			Pawn: \`message_begin(..., SVC_TEMPENTITY)\`, \`TE_*\`
		`,
	},
	'effects.beamPoints': {
		en: `
			A beam between two points.

			Pawn: \`TE_BEAMPOINTS\`
		`,
		ru: `
			Луч между двумя точками.

			Pawn: \`TE_BEAMPOINTS\`
		`,
	},
	'effects.beamEntityPoint': {
		en: `
			A beam from an entity to a point; its start follows the entity.

			Pawn: \`TE_BEAMENTPOINT\`
		`,
		ru: `
			Луч от сущности к точке; его начало следует за сущностью.

			Pawn: \`TE_BEAMENTPOINT\`
		`,
	},
	'effects.beamEntities': {
		en: `
			A beam between two entities, following both.

			Pawn: \`TE_BEAMENTS\`
		`,
		ru: `
			Луч между двумя сущностями, следующий за обеими.

			Pawn: \`TE_BEAMENTS\`
		`,
	},
	'effects.beamRing': {
		en: `
			A ring of beam between two entities: they are its diameter.

			Pawn: \`TE_BEAMRING\`
		`,
		ru: `
			Кольцо луча между двумя сущностями: они — его диаметр.

			Pawn: \`TE_BEAMRING\`
		`,
	},
	'effects.beamCylinder': {
		en: `
			A cylinder of beam that grows from a point to \`radius\` over its life - a shockwave on the ground:

			\`\`\`ts
			effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60, color: "#0096ff", alpha: 200 }, { near: here });
			\`\`\`

			Pawn: \`TE_BEAMCYLINDER\`
		`,
		ru: `
			Цилиндр из луча, который растёт от точки до \`radius\` за время жизни, — ударная волна по земле:

			\`\`\`ts
			effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60, color: "#0096ff", alpha: 200 }, { near: here });
			\`\`\`

			Pawn: \`TE_BEAMCYLINDER\`
		`,
	},
	'effects.beamDisk': {
		en: `
			A disk of beam that grows from a point to \`radius\` over its life.

			Pawn: \`TE_BEAMDISK\`
		`,
		ru: `
			Диск из луча, который растёт от точки до \`radius\` за время жизни.

			Pawn: \`TE_BEAMDISK\`
		`,
	},
	'effects.beamTorus': {
		en: `
			A ring of beam facing the viewer that grows from a point to \`radius\` over its life.

			Pawn: \`TE_BEAMTORUS\`
		`,
		ru: `
			Кольцо из луча, повёрнутое к зрителю, которое растёт от точки до \`radius\` за время жизни.

			Pawn: \`TE_BEAMTORUS\`
		`,
	},
	'effects.beamFollow': {
		en: `
			A trail behind a moving entity - a grenade, a player - until it stops:

			\`\`\`ts
			effects.beamFollow({ entity: grenade, sprite: trail, life: 1, width: 5, color: "#0096ff", alpha: 200 });
			\`\`\`

			Pawn: \`TE_BEAMFOLLOW\`
		`,
		ru: `
			След за движущейся сущностью — гранатой, игроком, — пока она не остановится:

			\`\`\`ts
			effects.beamFollow({ entity: grenade, sprite: trail, life: 1, width: 5, color: "#0096ff", alpha: 200 });
			\`\`\`

			Pawn: \`TE_BEAMFOLLOW\`
		`,
	},
	'effects.beamSprite': {
		en: `
			A beam between two points with a sprite at its end.

			Pawn: \`TE_BEAMSPRITE\`
		`,
		ru: `
			Луч между двумя точками со спрайтом на конце.

			Pawn: \`TE_BEAMSPRITE\`
		`,
	},
	'effects.lightning': {
		en: `
			A bolt between two points: a beam of fewer options.

			Pawn: \`TE_LIGHTNING\`
		`,
		ru: `
			Молния между двумя точками: луч с меньшим числом настроек.

			Pawn: \`TE_LIGHTNING\`
		`,
	},
	'effects.killBeams': {
		en: `
			Takes away every beam attached to an entity.

			Pawn: \`TE_KILLBEAM\`
		`,
		ru: `
			Убирает все лучи, прикреплённые к сущности.

			Pawn: \`TE_KILLBEAM\`
		`,
	},
	'effects.explosion': {
		en: `
			An explosion: a sprite, two lights, flying particles and the sound, rising slowly.

			Pawn: \`TE_EXPLOSION\`
		`,
		ru: `
			Взрыв: спрайт, два источника света, разлетающиеся частицы и звук; медленно поднимается.

			Pawn: \`TE_EXPLOSION\`
		`,
	},
	'effects.tarExplosion': {
		en: `
			A burst of dark particles with a sound.

			Pawn: \`TE_TAREXPLOSION\`
		`,
		ru: `
			Вспышка тёмных частиц со звуком.

			Pawn: \`TE_TAREXPLOSION\`
		`,
	},
	'effects.particleExplosion': {
		en: `
			A burst of particles in colours of the game's palette, with a sound.

			Pawn: \`TE_EXPLOSION2\`
		`,
		ru: `
			Вспышка частиц цветов палитры игры, со звуком.

			Pawn: \`TE_EXPLOSION2\`
		`,
	},
	'effects.smoke': {
		en: `
			A puff of smoke: a see-through sprite rising.

			Pawn: \`TE_SMOKE\`
		`,
		ru: `
			Клуб дыма: полупрозрачный спрайт, который поднимается.

			Pawn: \`TE_SMOKE\`
		`,
	},
	'effects.implosion': {
		en: `
			Tracers flying into a point.

			Pawn: \`TE_IMPLOSION\`
		`,
		ru: `
			Трассеры, слетающиеся в точку.

			Pawn: \`TE_IMPLOSION\`
		`,
	},
	'effects.gunshot': {
		en: `
			A bullet's hit: particles and a ricochet's sound.

			Pawn: \`TE_GUNSHOT\`
		`,
		ru: `
			Попадание пули: частицы и звук рикошета.

			Pawn: \`TE_GUNSHOT\`
		`,
	},
	'effects.sparks': {
		en: `
			Sparks falling from a point.

			Pawn: \`TE_SPARKS\`
		`,
		ru: `
			Искры, падающие из точки.

			Pawn: \`TE_SPARKS\`
		`,
	},
	'effects.armorRicochet': {
		en: `
			A bullet off armour: a quick spark and a ricochet's sound.

			Pawn: \`TE_ARMOR_RICOCHET\`
		`,
		ru: `
			Пуля от брони: быстрая искра и звук рикошета.

			Pawn: \`TE_ARMOR_RICOCHET\`
		`,
	},
	'effects.lavaSplash': {
		en: `
			A splash of particles, as from lava.

			Pawn: \`TE_LAVASPLASH\`
		`,
		ru: `
			Всплеск частиц, как от лавы.

			Pawn: \`TE_LAVASPLASH\`
		`,
	},
	'effects.teleport': {
		en: `
			A splash of particles, as at a teleport.

			Pawn: \`TE_TELEPORT\`
		`,
		ru: `
			Всплеск частиц, как у телепорта.

			Pawn: \`TE_TELEPORT\`
		`,
	},
	'effects.tracer': {
		en: `
			A tracer flying from one point to another.

			Pawn: \`TE_TRACER\`
		`,
		ru: `
			Трассер, летящий от точки к точке.

			Pawn: \`TE_TRACER\`
		`,
	},
	'effects.showLine': {
		en: `
			A line of particles between two points that stays 30 seconds.

			Pawn: \`TE_SHOWLINE\`
		`,
		ru: `
			Линия частиц между двумя точками, которая держится 30 секунд.

			Pawn: \`TE_SHOWLINE\`
		`,
	},
	'effects.streakSplash': {
		en: `
			A shower of tracers in a direction.

			Pawn: \`TE_STREAK_SPLASH\`
		`,
		ru: `
			Сноп трассеров в заданном направлении.

			Pawn: \`TE_STREAK_SPLASH\`
		`,
	},
	'effects.sprite': {
		en: `
			A glowing sprite that plays once.

			Pawn: \`TE_SPRITE\`
		`,
		ru: `
			Светящийся спрайт, который проигрывается один раз.

			Pawn: \`TE_SPRITE\`
		`,
	},
	'effects.glowSprite': {
		en: `
			A glowing sprite that stays a while.

			Pawn: \`TE_GLOWSPRITE\`
		`,
		ru: `
			Светящийся спрайт, который держится какое-то время.

			Pawn: \`TE_GLOWSPRITE\`
		`,
	},
	'effects.spriteTrail': {
		en: `
			A line of glowing sprites that fly off it, fall and fade.

			Pawn: \`TE_SPRITETRAIL\`
		`,
		ru: `
			Линия светящихся спрайтов, которые разлетаются, падают и гаснут.

			Pawn: \`TE_SPRITETRAIL\`
		`,
	},
	'effects.spriteSpray': {
		en: `
			A spray of see-through sprites.

			Pawn: \`TE_SPRITE_SPRAY\`
		`,
		ru: `
			Брызги полупрозрачных спрайтов.

			Pawn: \`TE_SPRITE_SPRAY\`
		`,
	},
	'effects.largeFunnel': {
		en: `
			A funnel of sprites flying into a point, or out of it.

			Pawn: \`TE_LARGEFUNNEL\`
		`,
		ru: `
			Воронка спрайтов, слетающихся в точку или вылетающих из неё.

			Pawn: \`TE_LARGEFUNNEL\`
		`,
	},
	'effects.fizz': {
		en: `
			Bubbles rising inside a brush entity, such as water.

			Pawn: \`TE_FIZZ\`
		`,
		ru: `
			Пузыри, поднимающиеся внутри браш-сущности, например воды.

			Pawn: \`TE_FIZZ\`
		`,
	},
	'effects.bubbles': {
		en: `
			Bubbles rising from a box.

			Pawn: \`TE_BUBBLES\`
		`,
		ru: `
			Пузыри, поднимающиеся из коробки.

			Pawn: \`TE_BUBBLES\`
		`,
	},
	'effects.bubbleTrail': {
		en: `
			Bubbles rising from a line.

			Pawn: \`TE_BUBBLETRAIL\`
		`,
		ru: `
			Пузыри, поднимающиеся с линии.

			Pawn: \`TE_BUBBLETRAIL\`
		`,
	},
	'effects.dynamicLight': {
		en: `
			A light that lights up the world around a point.

			Pawn: \`TE_DLIGHT\`
		`,
		ru: `
			Свет, который освещает мир вокруг точки.

			Pawn: \`TE_DLIGHT\`
		`,
	},
	'effects.entityLight': {
		en: `
			A light on an entity that lights up entities only, not the world.

			Pawn: \`TE_ELIGHT\`
		`,
		ru: `
			Свет на сущности, который освещает только сущности, не мир.

			Pawn: \`TE_ELIGHT\`
		`,
	},
	'effects.line': {
		en: `
			A coloured line between two points.

			Pawn: \`TE_LINE\`
		`,
		ru: `
			Цветная линия между двумя точками.

			Pawn: \`TE_LINE\`
		`,
	},
	'effects.box': {
		en: `
			The edges of a box in colour.

			Pawn: \`TE_BOX\`
		`,
		ru: `
			Рёбра коробки, цветные.

			Pawn: \`TE_BOX\`
		`,
	},
	'effects.blood': {
		en: `
			A spray of blood particles.

			Pawn: \`TE_BLOOD\`
		`,
		ru: `
			Брызги частиц крови.

			Pawn: \`TE_BLOOD\`
		`,
	},
	'effects.bloodStream': {
		en: `
			A stream of blood particles.

			Pawn: \`TE_BLOODSTREAM\`
		`,
		ru: `
			Струя частиц крови.

			Pawn: \`TE_BLOODSTREAM\`
		`,
	},
	'effects.bloodSprite': {
		en: `
			Blood as the game draws a hit: drops that fall and a blot that stays a moment.

			Pawn: \`TE_BLOODSPRITE\`
		`,
		ru: `
			Кровь, как её рисует игра при попадании: падающие капли и пятно, которое держится мгновение.

			Pawn: \`TE_BLOODSPRITE\`
		`,
	},
	'effects.model': {
		en: `
			A model thrown from a point that bounces - a shell out of a gun.

			Pawn: \`TE_MODEL\`
		`,
		ru: `
			Модель, брошенная из точки, которая отскакивает, — гильза из оружия.

			Pawn: \`TE_MODEL\`
		`,
	},
	'effects.explodeModel': {
		en: `
			Pieces of a model flying out of a point in every direction.

			Pawn: \`TE_EXPLODEMODEL\`
		`,
		ru: `
			Осколки модели, разлетающиеся из точки во все стороны.

			Pawn: \`TE_EXPLODEMODEL\`
		`,
	},
	'effects.breakModel': {
		en: `
			Pieces flying out of a box - something broken:

			\`\`\`ts
			effects.breakModel({ at: box.origin, size: [16, 16, 16], velocity: [0, 0, 50], model: gibs, count: 8, life: 2, material: "glass" });
			\`\`\`

			Pawn: \`TE_BREAKMODEL\`
		`,
		ru: `
			Осколки, вылетающие из коробки, — что-то разбилось:

			\`\`\`ts
			effects.breakModel({ at: box.origin, size: [16, 16, 16], velocity: [0, 0, 50], model: gibs, count: 8, life: 2, material: "glass" });
			\`\`\`

			Pawn: \`TE_BREAKMODEL\`
		`,
	},
	'effects.projectile': {
		en: `
			A model flying like a nail that hits players.

			Pawn: \`TE_PROJECTILE\`
		`,
		ru: `
			Модель, летящая как гвоздь, которая попадает в игроков.

			Pawn: \`TE_PROJECTILE\`
		`,
	},
	'effects.spray': {
		en: `
			A shower of models or sprites thrown in a direction.

			Pawn: \`TE_SPRAY\`
		`,
		ru: `
			Россыпь моделей или спрайтов, брошенная в заданном направлении.

			Pawn: \`TE_SPRAY\`
		`,
	},
	'effects.playerSprites': {
		en: `
			Sprites flying out of a player's body.

			Pawn: \`TE_PLAYERSPRITES\`
		`,
		ru: `
			Спрайты, вылетающие из тела игрока.

			Pawn: \`TE_PLAYERSPRITES\`
		`,
	},
	'effects.particleBurst': {
		en: `
			A burst of particles in one colour of the game's palette.

			Pawn: \`TE_PARTICLEBURST\`
		`,
		ru: `
			Вспышка частиц одного цвета палитры игры.

			Pawn: \`TE_PARTICLEBURST\`
		`,
	},
	'effects.fireField': {
		en: `
			A field of fire sprites filling a square.

			Pawn: \`TE_FIREFIELD\`
		`,
		ru: `
			Поле огненных спрайтов, заполняющее квадрат.

			Pawn: \`TE_FIREFIELD\`
		`,
	},
	'effects.playerAttachment': {
		en: `
			A model attached above a player that goes where he goes.

			Pawn: \`TE_PLAYERATTACHMENT\`
		`,
		ru: `
			Модель над игроком, которая ходит вместе с ним.

			Pawn: \`TE_PLAYERATTACHMENT\`
		`,
	},
	'effects.killPlayerAttachments': {
		en: `
			Takes away every model attached to a player.

			Pawn: \`TE_KILLPLAYERATTACHMENTS\`
		`,
		ru: `
			Убирает все модели, прикреплённые к игроку.

			Pawn: \`TE_KILLPLAYERATTACHMENTS\`
		`,
	},
};
