// Temporary effects: beams, explosions, sprites, sparks, lights, tracers,
// blood - what the engine draws for a moment and forgets, sent as
// SVC_TEMPENTITY with the message's bytes written here.
//
// One function per effect, each with its own options: the fields are the
// effect's arguments in the plugin author's words. Times are seconds (the
// message's tenths are counted here); a colour is CSS hex; an entity, a
// player and a sprite are the facade's objects. Sizes the message holds as a
// byte - a beam's width, a sprite's scale - are the message's own numbers,
// which the words of each field explain. Effects that need a decal's index
// (TE_*DECAL, TE_MULTIGUNSHOT), the engine's tracer colours (TE_USERTRACER)
// or are a HUD message (TE_TEXTMESSAGE) are not here; the obsolete ones
// (TE_BEAM, TE_BEAMHOSE) are gone from the game.
//
// Who sees one is the second argument: everyone by default, `{ near }` the
// players who can see that point (MSG_PVS), `{ to }` one player. An effect is
// sent unreliably, as the game sends its own: a client that drops it misses a
// spark, where a reliable one filling up would drop him.
import { Player, Resource } from "./facade";
import { Entity, RenderMode } from "./entities";
import { message_begin, message_begin_f, message_end, write_angle_f, write_byte, write_coord_f, write_short } from "./natives";
import {
	MSG_BROADCAST, MSG_ONE_UNRELIABLE, MSG_PVS, SVC_TEMPENTITY,
	TE_ARMOR_RICOCHET, TE_BEAMCYLINDER, TE_BEAMDISK, TE_BEAMENTPOINT, TE_BEAMENTS, TE_BEAMFOLLOW, TE_BEAMPOINTS, TE_BEAMRING,
	TE_BEAMSPRITE, TE_BEAMTORUS, TE_BLOOD, TE_BLOODSPRITE, TE_BLOODSTREAM, TE_BOX, TE_BREAKMODEL, TE_BUBBLES, TE_BUBBLETRAIL,
	TE_DLIGHT, TE_ELIGHT, TE_EXPLODEMODEL, TE_EXPLOSION, TE_EXPLOSION2, TE_FIREFIELD, TE_FIZZ, TE_GLOWSPRITE, TE_GUNSHOT,
	TE_IMPLOSION, TE_KILLBEAM, TE_KILLPLAYERATTACHMENTS, TE_LARGEFUNNEL, TE_LAVASPLASH, TE_LIGHTNING, TE_LINE, TE_MODEL,
	TE_PARTICLEBURST, TE_PLAYERATTACHMENT, TE_PLAYERSPRITES, TE_PROJECTILE, TE_SHOWLINE, TE_SMOKE, TE_SPARKS, TE_SPRAY,
	TE_SPRITE, TE_SPRITETRAIL, TE_SPRITE_SPRAY, TE_STREAK_SPLASH, TE_TAREXPLOSION, TE_TELEPORT, TE_TRACER,
	TE_EXPLFLAG_NOADDITIVE, TE_EXPLFLAG_NODLIGHTS, TE_EXPLFLAG_NOSOUND, TE_EXPLFLAG_NOPARTICLES,
	TEFIRE_FLAG_ALLFLOAT, TEFIRE_FLAG_SOMEFLOAT, TEFIRE_FLAG_LOOP, TEFIRE_FLAG_ALPHA, TEFIRE_FLAG_PLANAR
} from "./constants";

/** The players who see an effect - the second argument of every `effects` function; everyone when it is left out. An effect is sent as the game sends its own: a player whose connection drops it misses it. */
export interface EffectRecipients {
	/**
	 * Only the players who can see this point, e.g. `{ near: grenade.origin }`.
	 *
	 * Pawn: `MSG_PVS`
	 */
	near?: number[];
	/**
	 * Only this player, e.g. `{ to: player }`.
	 *
	 * Pawn: `MSG_ONE_UNRELIABLE`
	 */
	to?: Player;
}

/** The options of `effects.gunshot`, `effects.sparks`, `effects.tarExplosion`, `effects.lavaSplash` and `effects.teleport`. */
export interface PointEffectOptions {
	/** The point the effect is at. */
	at: number[];
}

/** The options of `effects.tracer` and `effects.showLine`. */
export interface SegmentEffectOptions {
	/** The point the effect starts from. */
	start: number[];
	/** The point the effect ends at. */
	end: number[];
}

/** The options of `effects.killBeams`. */
export interface EntityEffectOptions {
	/** The entity whose beams go. */
	entity: Entity;
}

/** The options of `effects.killPlayerAttachments`. */
export interface PlayerEffectOptions {
	/** The player whose attached models go. */
	player: Player;
}

/** The options of `effects.beamPoints`. */
export interface BeamPointsOptions {
	/** The point the beam starts from. */
	start: number[];
	/** The point the beam ends at. */
	end: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The beam's width, `0` to `255`: `10` is one unit. */
	width: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
	/** The brightness, `0` to `255`; `255` by default. */
	alpha?: number;
	/** The beam's waver, `0` to `255`: `100` is one unit; `0` by default, a straight beam. */
	noise?: number;
	/** The sprite's frame the beam starts from; `0` by default. */
	frame?: number;
	/** The sprite's frame rate, in tenths of a frame a second; `0` by default. */
	frameRate?: number;
	/** The speed the sprite scrolls along the beam, in tenths of a unit a second; `0` by default. */
	speed?: number;
}

/** The options of `effects.beamEntityPoint`. */
export interface BeamEntityPointOptions {
	/** The entity the beam starts from; the beam follows it as it moves. */
	start: Entity;
	/** The point the beam ends at. */
	end: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The beam's width, `0` to `255`: `10` is one unit. */
	width: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
	/** The brightness, `0` to `255`; `255` by default. */
	alpha?: number;
	/** The beam's waver, `0` to `255`: `100` is one unit; `0` by default, a straight beam. */
	noise?: number;
	/** The sprite's frame the beam starts from; `0` by default. */
	frame?: number;
	/** The sprite's frame rate, in tenths of a frame a second; `0` by default. */
	frameRate?: number;
	/** The speed the sprite scrolls along the beam, in tenths of a unit a second; `0` by default. */
	speed?: number;
}

/** The options of `effects.beamEntities` and `effects.beamRing`. */
export interface BeamEntitiesOptions {
	/** The entity the beam starts from; the beam follows it as it moves. */
	start: Entity;
	/** The entity the beam ends at; the beam follows it as it moves. */
	end: Entity;
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The beam's width, `0` to `255`: `10` is one unit. */
	width: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
	/** The brightness, `0` to `255`; `255` by default. */
	alpha?: number;
	/** The beam's waver, `0` to `255`: `100` is one unit; `0` by default, a straight beam. */
	noise?: number;
	/** The sprite's frame the beam starts from; `0` by default. */
	frame?: number;
	/** The sprite's frame rate, in tenths of a frame a second; `0` by default. */
	frameRate?: number;
	/** The speed the sprite scrolls along the beam, in tenths of a unit a second; `0` by default. */
	speed?: number;
}

/** The options of `effects.beamCylinder`, `effects.beamDisk` and `effects.beamTorus`. */
export interface BeamCircleOptions {
	/** The circle's centre. */
	at: number[];
	/** The circle's radius at the end of its life, in units. */
	radius: number;
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The beam's width, `0` to `255`: `10` is one unit. */
	width: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
	/** The brightness, `0` to `255`; `255` by default. */
	alpha?: number;
	/** The beam's waver, `0` to `255`: `100` is one unit; `0` by default, a straight beam. */
	noise?: number;
	/** The sprite's frame the beam starts from; `0` by default. */
	frame?: number;
	/** The sprite's frame rate, in tenths of a frame a second; `0` by default. */
	frameRate?: number;
	/** The speed the sprite scrolls along the beam, in tenths of a unit a second; `0` by default. */
	speed?: number;
}

/** The options of `effects.beamFollow`. */
export interface BeamFollowOptions {
	/** The entity the trail follows - a grenade, a player. */
	entity: Entity;
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The lifetime of each piece of the trail, in seconds, up to `25.5`. */
	life: number;
	/** The beam's width, `0` to `255`: `10` is one unit. */
	width: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
	/** The brightness, `0` to `255`; `255` by default. */
	alpha?: number;
}

/** The options of `effects.beamSprite`. */
export interface BeamSpriteOptions {
	/** The point the beam starts from. */
	start: number[];
	/** The point the beam ends at, where the end sprite is. */
	end: number[];
	/** The beam's sprite, as `server.precache` returned it. */
	sprite: Resource;
	/** The sprite at the beam's end, as `server.precache` returned it. */
	endSprite: Resource;
}

/** The options of `effects.lightning`. */
export interface LightningOptions {
	/** The point the bolt starts from. */
	start: number[];
	/** The point the bolt ends at. */
	end: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The beam's width, `0` to `255`: `10` is one unit. */
	width: number;
	/** The beam's waver, `0` to `255`: `100` is one unit; `0` by default, a straight beam. */
	noise?: number;
}

/** The options of `effects.explosion`. */
export interface ExplosionOptions {
	/** The point the effect is at. */
	at: number[];
	/** The explosion's sprite, e.g. `sprites/zerogxplode.spr`, as `server.precache` returned it. */
	sprite: Resource;
	/** The sprite's size, `0` to `255`: `10` is its own size; `10` by default. */
	scale?: number;
	/** The sprite's frames a second; `15` by default. */
	frameRate?: number;
	/** Whether the sprite is drawn glowing, added to what is behind it; `true` by default, `false` draws it opaque. */
	additive?: boolean;
	/** Whether the explosion lights up the world around it; `true` by default. */
	lights?: boolean;
	/** Whether the explosion is heard; `true` by default. */
	sound?: boolean;
	/** Whether the explosion throws out particles; `true` by default. */
	particles?: boolean;
}

/** The options of `effects.smoke`. */
export interface SmokeOptions {
	/** The point the effect is at. */
	at: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The sprite's size, `0` to `255`: `10` is its own size; `10` by default. */
	scale?: number;
	/** The sprite's frames a second; `10` by default. */
	frameRate?: number;
}

/** The options of `effects.particleExplosion`. */
export interface ParticleExplosionOptions {
	/** The point the effect is at. */
	at: number[];
	/** The first colour of the game's palette the particles take, `0` to `255`; `0` by default. */
	palette?: number;
	/** The number of the palette's colours from there on the particles take; `16` by default. */
	colors?: number;
}

/** The options of `effects.implosion`. */
export interface ImplosionOptions {
	/** The point the tracers fly into. */
	at: number[];
	/** The distance the tracers start from, in units, up to `255`. */
	radius: number;
	/** The number of tracers, `0` to `255`. */
	count: number;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
}

/** The options of `effects.spriteTrail`. */
export interface SpriteTrailOptions {
	/** The point the effect starts from. */
	start: number[];
	/** The point the effect ends at. */
	end: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The number of sprites, `0` to `255`. */
	count: number;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The sprite's size, `0` to `255`: `10` is its own size; `10` by default. */
	scale?: number;
	/** The sprites' speed along the line, `0` to `255`: `1` is ten units a second; `10` by default. */
	speed?: number;
	/** The spread of the sprites' speeds, `0` to `255`: `1` is ten units a second; `10` by default. */
	randomness?: number;
}

/** The options of `effects.sprite`. */
export interface SpriteOptions {
	/** The point the effect is at. */
	at: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The sprite's size, `0` to `255`: `10` is its own size; `10` by default. */
	scale?: number;
	/** The brightness, `0` to `255`; `255` by default. */
	alpha?: number;
}

/** The options of `effects.glowSprite`. */
export interface GlowSpriteOptions {
	/** The point the effect is at. */
	at: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The sprite's size, `0` to `255`: `10` is its own size; `10` by default. */
	scale?: number;
	/** The brightness, `0` to `255`; `255` by default. */
	alpha?: number;
}

/** The options of `effects.streakSplash`. */
export interface StreakSplashOptions {
	/** The point the effect is at. */
	at: number[];
	/** The direction the spray goes, a vector: its length is not read. */
	direction: number[];
	/** The number of tracers, up to `32767`. */
	count: number;
	/** The tracers' speed, in units a second. */
	speed: number;
	/** The spread of the tracers' speeds, in units a second; `0` by default. */
	randomness?: number;
	/** The tracers' colour in the game's palette, `0` to `255`; `5` by default, yellow sparks. */
	palette?: number;
}

/** The options of `effects.dynamicLight`. */
export interface DynamicLightOptions {
	/** The point the light shines from. */
	at: number[];
	/** The light's reach, in units, up to `2550`. */
	radius: number;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
	/** The speed the light shrinks at, in units a second; `0` by default, not at all. */
	decay?: number;
}

/** The options of `effects.entityLight`. */
export interface EntityLightOptions {
	/** The entity the light follows. */
	entity: Entity;
	/** The point the light starts at. */
	at: number[];
	/** The light's reach, in units. */
	radius: number;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
	/** The speed the light shrinks at, in units a second; `0` by default, not at all. */
	decay?: number;
}

/** The options of `effects.line`. */
export interface LineOptions {
	/** The point the effect starts from. */
	start: number[];
	/** The point the effect ends at. */
	end: number[];
	/** The effect's lifetime, in seconds. */
	life: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
}

/** The options of `effects.box`. */
export interface BoxOptions {
	/** The box's lower corner. */
	mins: number[];
	/** The box's upper corner. */
	maxs: number[];
	/** The effect's lifetime, in seconds. */
	life: number;
	/** The colour in CSS hex, e.g. `"#0096ff"` or `"#09f"`; white by default. */
	color?: string;
}

/** The options of `effects.largeFunnel`. */
export interface LargeFunnelOptions {
	/** The funnel's bottom. */
	at: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** `true`: the sprites fly out of the funnel rather than into it. */
	reverse?: boolean;
}

/** The options of `effects.blood` and `effects.bloodStream`. */
export interface BloodOptions {
	/** The point the effect is at. */
	at: number[];
	/** The direction the spray goes, a vector: its length is not read. */
	direction: number[];
	/** The spray's speed, `0` to `255`. */
	speed: number;
	/** The blood's colour in the game's palette, `0` to `255`: `247` (the default) is red, `195` yellow. */
	palette?: number;
}

/** The options of `effects.fizz`. */
export interface FizzOptions {
	/** The entity the bubbles rise in - a brush, such as water. */
	entity: Entity;
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The bubbles' density, `0` to `255`. */
	density: number;
}

/** The sound a model makes as it bounces, one of `"none"`, `"shell"` or `"shotgunShell"`. */
export type BounceSound = "none" | "shell" | "shotgunShell";

/** The options of `effects.model`. */
export interface ModelOptions {
	/** The point the effect is at. */
	at: number[];
	/** The starting velocity, in units a second. */
	velocity: number[];
	/** The model to draw - a `.mdl` or a sprite - as `server.precache` returned it. */
	model: Resource;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The model's starting turn around the vertical, in degrees; `0` by default. */
	yaw?: number;
	/** The sound the model makes as it bounces, one of `"none"` (the default), `"shell"` or `"shotgunShell"`. */
	sound?: BounceSound;
}

/** The options of `effects.explodeModel`. */
export interface ExplodeModelOptions {
	/** The point the effect is at. */
	at: number[];
	/** The pieces' speed, in units a second. */
	speed: number;
	/** The model to draw - a `.mdl` or a sprite - as `server.precache` returned it. */
	model: Resource;
	/** The number of pieces, up to `32767`. */
	count: number;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
}

/** The material a broken thing was made of - the sound its pieces make: one of `"none"`, `"glass"`, `"metal"`, `"flesh"`, `"wood"` or `"concrete"`. */
export type BreakMaterial = "none" | "glass" | "metal" | "flesh" | "wood" | "concrete";

/** The options of `effects.breakModel`. */
export interface BreakModelOptions {
	/** The centre of the box the pieces fly out of. */
	at: number[];
	/** The box's size along each axis, in units. */
	size: number[];
	/** The starting velocity, in units a second. */
	velocity: number[];
	/** The model to draw - a `.mdl` or a sprite - as `server.precache` returned it. */
	model: Resource;
	/** The number of pieces, `0` to `255`. */
	count: number;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The spread of the pieces' speeds, `0` to `255`: `1` is ten units a second; `0` by default. */
	randomness?: number;
	/** The material the pieces sound as, one of `"none"` (the default), `"glass"`, `"metal"`, `"flesh"`, `"wood"` or `"concrete"`. */
	material?: BreakMaterial;
	/** `true`: the pieces trail smoke. */
	smoke?: boolean;
	/** `true`: the pieces are drawn see-through. */
	transparent?: boolean;
}

/** The options of `effects.spriteSpray`. */
export interface SpriteSprayOptions {
	/** The point the effect is at. */
	at: number[];
	/** The starting velocity, in units a second. */
	velocity: number[];
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The number of pieces, `0` to `255`. */
	count: number;
	/** The sprites' speed, `0` to `255`. */
	speed: number;
	/** The spread of the sprites' directions, `0` to `255`; `0` by default. */
	noise?: number;
}

/** The options of `effects.armorRicochet`. */
export interface ArmorRicochetOptions {
	/** The point the effect is at. */
	at: number[];
	/** The sprite's size, `0` to `255`: `10` is its own size; `10` by default. */
	scale?: number;
}

/** The options of `effects.bubbles` and `effects.bubbleTrail`. */
export interface BubblesOptions {
	/** One corner of the box, or one end of the line, the bubbles appear in. */
	start: number[];
	/** The other corner of the box, or the other end of the line. */
	end: number[];
	/** The height the bubbles rise to, in units. */
	height: number;
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The number of bubbles, `0` to `255`. */
	count: number;
	/** The bubbles' speed, in units a second. */
	speed: number;
}

/** The options of `effects.bloodSprite`. */
export interface BloodSpriteOptions {
	/** The point the effect is at. */
	at: number[];
	/** The sprite of the drops that fall, e.g. `sprites/bloodspray.spr`, as `server.precache` returned it. */
	spray: Resource;
	/** The sprite of the blot that stays a moment, e.g. `sprites/blood.spr`, as `server.precache` returned it. */
	drop: Resource;
	/** The sprite's size, `0` to `255`: `10` is its own size; `10` by default. */
	scale?: number;
	/** The blood's colour in the game's palette, `0` to `255`: `247` (the default) is red, `195` yellow. */
	palette?: number;
}

/** The options of `effects.projectile`. */
export interface ProjectileOptions {
	/** The point the effect is at. */
	at: number[];
	/** The starting velocity, in units a second. */
	velocity: number[];
	/** The model to draw - a `.mdl` or a sprite - as `server.precache` returned it. */
	model: Resource;
	/** The projectile's lifetime, in whole seconds, up to `255`. */
	life: number;
	/** The player the projectile passes through; left out, it hits anyone. */
	owner?: Player;
}

/** The options of `effects.spray`. */
export interface SprayOptions {
	/** The point the effect is at. */
	at: number[];
	/** The direction the spray goes, a vector: its length is not read. */
	direction: number[];
	/** The model to draw - a `.mdl` or a sprite - as `server.precache` returned it. */
	model: Resource;
	/** The number of pieces, `0` to `255`. */
	count: number;
	/** The pieces' speed, `0` to `255`. */
	speed: number;
	/** The spread of the pieces' directions, `0` to `255`; `0` by default. */
	noise?: number;
	/** The pieces' render mode, as an entity's `renderMode`; `"normal"` by default. */
	renderMode?: RenderMode;
}

/** The options of `effects.playerSprites`. */
export interface PlayerSpritesOptions {
	/** The player the sprites come out of. */
	player: Player;
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The number of sprites, `0` to `255`. */
	count: number;
	/** The spread of the sprites' sizes, in percent; `0` by default, all the same. */
	variance?: number;
}

/** The options of `effects.particleBurst`. */
export interface ParticleBurstOptions {
	/** The point the effect is at. */
	at: number[];
	/** The burst's radius, in units. */
	radius: number;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The particles' colour in the game's palette, `0` to `255`; `0` by default. */
	palette?: number;
}

/** The share of a fire field's sprites that drift upwards, one of `"none"`, `"some"` (half of them) or `"all"`. */
export type FireRise = "none" | "some" | "all";

/** The look of a fire field's sprites, one of `"opaque"`, `"alpha"` (half see-through) or `"additive"` (glowing). */
export type FireBlend = "opaque" | "alpha" | "additive";

/** The options of `effects.fireField`. */
export interface FireFieldOptions {
	/** The field's centre. */
	at: number[];
	/** Half the side of the square the fire fills, in units. */
	radius: number;
	/** The sprite to draw, as `server.precache` returned it. */
	sprite: Resource;
	/** The number of sprites, `0` to `255`. */
	count: number;
	/** The effect's lifetime, in seconds, up to `25.5`. */
	life: number;
	/** The share of the sprites that drift upwards, one of `"none"` (the default), `"some"` or `"all"`. */
	rise?: FireRise;
	/** The sprites' look, one of `"opaque"` (the default), `"alpha"` or `"additive"`. */
	blend?: FireBlend;
	/** `true`: the sprites play at 15 frames a second; otherwise once over their lifetime. */
	loop?: boolean;
	/** `true`: every sprite starts at the same height, a flat field rather than a cube. */
	flat?: boolean;
}

/** The options of `effects.playerAttachment`. */
export interface PlayerAttachmentOptions {
	/** The player the model is attached to. */
	player: Player;
	/** The model to draw - a `.mdl` or a sprite - as `server.precache` returned it. */
	model: Resource;
	/** The effect's lifetime, in seconds. */
	life: number;
	/** The model's height above the player's origin, in units; `0` by default. */
	offset?: number;
}

// TE_FIREFIELD's additive flag, which the include does not carry.
const TEFIRE_FLAG_ADDITIVE = 32;

// The palette's blood red, the colour the game bleeds in.
const BLOOD_RED = 247;

// The render modes in their numbers' order, as TE_SPRAY takes one.
const RENDER_MODES: RenderMode[] = ["normal", "color", "texture", "glow", "alpha", "additive"];

// TE_BREAKMODEL's materials and their flags (hlsdk's BREAK_*): the sound the pieces make.
const BREAK_MATERIALS: BreakMaterial[] = ["glass", "metal", "flesh", "wood", "concrete"];
const BREAK_FLAGS: i32[] = [0x01, 0x02, 0x04, 0x08, 0x40];

/** The message to whoever the effect is for, its type written. */
function begin(type: i32, recipients: EffectRecipients): void {
	const player = recipients.to;
	const near = recipients.near;
	if (player != null) message_begin(MSG_ONE_UNRELIABLE, SVC_TEMPENTITY, [0, 0, 0], player.id);
	else if (near != null) message_begin_f(MSG_PVS, SVC_TEMPENTITY, near, 0);
	else message_begin(MSG_BROADCAST, SVC_TEMPENTITY, [0, 0, 0], 0);
	write_byte(type);
}

/** Whether every file the effect draws is precached; one that is not is said in the console and the effect is not sent. */
function precached(resources: Resource[]): bool {
	for (let i = 0; i < resources.length; i++) {
		const resource = resources[i];
		if (resource.index > 0) continue;
		console.error(`effects: "${resource.path}" is not precached`);
		return false;
	}
	return true;
}

function byte(value: number): void {
	write_byte(<i32>Math.max(0.0, Math.min(255.0, Math.round(value))));
}

function short(value: number): void {
	write_short(<i32>Math.max(-32768.0, Math.min(32767.0, Math.round(value))));
}

function coords(point: number[]): void {
	for (let i = 0; i < 3; i++) write_coord_f(i < point.length ? point[i] : 0.0);
}

function color(hex: string): void {
	const digits = hex.startsWith("#") ? hex.slice(1) : hex;
	const full = digits.length == 3 ? `${digits[0]}${digits[0]}${digits[1]}${digits[1]}${digits[2]}${digits[2]}` : digits;
	const parsed = I32.parseInt(full, 16);
	// Read back, a colour is the same digits: "0x12" or "12gg34" is not one.
	const value = full.length == 6 && parsed.toString(16).padStart(6, "0") == full.toLowerCase() ? parsed : -1;
	if (value < 0) console.error(`effects: "${hex}" is not a colour - write it as "#0096ff"`);
	const rgb = value < 0 ? 0xffffff : value;
	write_byte((rgb >> 16) & 0xff);
	write_byte((rgb >> 8) & 0xff);
	write_byte(rgb & 0xff);
}

/** What every beam but the follow and the lightning takes after its ends. */
function beam(sprite: Resource, frame: number, frameRate: number, life: number, width: number, noise: number, hex: string, alpha: number, speed: number): void {
	write_short(<i32>sprite.index);
	byte(frame);
	byte(frameRate);
	byte(life * 10.0);
	byte(width);
	byte(noise);
	color(hex);
	byte(alpha);
	byte(speed);
	message_end();
}

function beamCircle(type: i32, options: BeamCircleOptions, to: EffectRecipients): void {
	if (!precached([options.sprite])) return;
	const at = options.at;
	begin(type, to);
	coords(at);
	coords([at[0], at[1], at[2] + options.radius]);
	beam(options.sprite, options.frame ?? 0, options.frameRate ?? 0, options.life, options.width, options.noise ?? 0, options.color ?? "#ffffff", options.alpha ?? 255, options.speed ?? 0);
}

function point(type: i32, options: PointEffectOptions, to: EffectRecipients): void {
	begin(type, to);
	coords(options.at);
	message_end();
}

function segment(type: i32, options: SegmentEffectOptions, to: EffectRecipients): void {
	begin(type, to);
	coords(options.start);
	coords(options.end);
	message_end();
}

function sprayBlood(type: i32, options: BloodOptions, to: EffectRecipients): void {
	begin(type, to);
	coords(options.at);
	coords(options.direction);
	byte(options.palette ?? BLOOD_RED);
	byte(options.speed);
	message_end();
}

function riseBubbles(type: i32, options: BubblesOptions, to: EffectRecipients): void {
	if (!precached([options.sprite])) return;
	begin(type, to);
	coords(options.start);
	coords(options.end);
	write_coord_f(options.height);
	write_short(<i32>options.sprite.index);
	byte(options.count);
	write_coord_f(options.speed);
	message_end();
}

/**
 * Temporary effects - beams, explosions, sprites, sparks, lights, blood - the game draws for a moment and forgets. One function per effect; the options are its arguments, the second argument who sees it:
 *
 * ```ts
 * const shock = server.precache("sprites/shockwave.spr");
 *
 * effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60, color: "#0096ff", alpha: 200 }, { near: here });
 * effects.sparks({ at: here });                          // everyone
 * effects.beamFollow({ entity: grenade, sprite: shock, life: 1, width: 5 }, { to: player });
 * ```
 *
 * Times are in seconds, a colour is CSS hex, a sprite or a model is what `server.precache` returned. An effect whose file is not precached is not sent, with a line in the console.
 *
 * Pawn: `message_begin(..., SVC_TEMPENTITY)`, `TE_*`
 */
export namespace effects {
	/**
	 * A beam between two points.
	 *
	 * Pawn: `TE_BEAMPOINTS`
	 */
	export function beamPoints(options: BeamPointsOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_BEAMPOINTS, to);
		coords(options.start);
		coords(options.end);
		beam(options.sprite, options.frame ?? 0, options.frameRate ?? 0, options.life, options.width, options.noise ?? 0, options.color ?? "#ffffff", options.alpha ?? 255, options.speed ?? 0);
	}

	/**
	 * A beam from an entity to a point; its start follows the entity.
	 *
	 * Pawn: `TE_BEAMENTPOINT`
	 */
	export function beamEntityPoint(options: BeamEntityPointOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_BEAMENTPOINT, to);
		write_short(<i32>options.start.id);
		coords(options.end);
		beam(options.sprite, options.frame ?? 0, options.frameRate ?? 0, options.life, options.width, options.noise ?? 0, options.color ?? "#ffffff", options.alpha ?? 255, options.speed ?? 0);
	}

	/**
	 * A beam between two entities, following both.
	 *
	 * Pawn: `TE_BEAMENTS`
	 */
	export function beamEntities(options: BeamEntitiesOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_BEAMENTS, to);
		write_short(<i32>options.start.id);
		write_short(<i32>options.end.id);
		beam(options.sprite, options.frame ?? 0, options.frameRate ?? 0, options.life, options.width, options.noise ?? 0, options.color ?? "#ffffff", options.alpha ?? 255, options.speed ?? 0);
	}

	/**
	 * A ring of beam between two entities: they are its diameter.
	 *
	 * Pawn: `TE_BEAMRING`
	 */
	export function beamRing(options: BeamEntitiesOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_BEAMRING, to);
		write_short(<i32>options.start.id);
		write_short(<i32>options.end.id);
		beam(options.sprite, options.frame ?? 0, options.frameRate ?? 0, options.life, options.width, options.noise ?? 0, options.color ?? "#ffffff", options.alpha ?? 255, options.speed ?? 0);
	}

	/**
	 * A cylinder of beam that grows from a point to `radius` over its life - a shockwave on the ground:
	 *
	 * ```ts
	 * effects.beamCylinder({ at: here, radius: 385, sprite: shock, life: 0.4, width: 60, color: "#0096ff", alpha: 200 }, { near: here });
	 * ```
	 *
	 * Pawn: `TE_BEAMCYLINDER`
	 */
	export function beamCylinder(options: BeamCircleOptions, to: EffectRecipients = {}): void {
		beamCircle(TE_BEAMCYLINDER, options, to);
	}

	/**
	 * A disk of beam that grows from a point to `radius` over its life.
	 *
	 * Pawn: `TE_BEAMDISK`
	 */
	export function beamDisk(options: BeamCircleOptions, to: EffectRecipients = {}): void {
		beamCircle(TE_BEAMDISK, options, to);
	}

	/**
	 * A ring of beam facing the viewer that grows from a point to `radius` over its life.
	 *
	 * Pawn: `TE_BEAMTORUS`
	 */
	export function beamTorus(options: BeamCircleOptions, to: EffectRecipients = {}): void {
		beamCircle(TE_BEAMTORUS, options, to);
	}

	/**
	 * A trail behind a moving entity - a grenade, a player - until it stops:
	 *
	 * ```ts
	 * effects.beamFollow({ entity: grenade, sprite: trail, life: 1, width: 5, color: "#0096ff", alpha: 200 });
	 * ```
	 *
	 * Pawn: `TE_BEAMFOLLOW`
	 */
	export function beamFollow(options: BeamFollowOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_BEAMFOLLOW, to);
		write_short(<i32>options.entity.id);
		write_short(<i32>options.sprite.index);
		byte(options.life * 10.0);
		byte(options.width);
		color(options.color ?? "#ffffff");
		byte(options.alpha ?? 255);
		message_end();
	}

	/**
	 * A beam between two points with a sprite at its end.
	 *
	 * Pawn: `TE_BEAMSPRITE`
	 */
	export function beamSprite(options: BeamSpriteOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite, options.endSprite])) return;
		begin(TE_BEAMSPRITE, to);
		coords(options.start);
		coords(options.end);
		write_short(<i32>options.sprite.index);
		write_short(<i32>options.endSprite.index);
		message_end();
	}

	/**
	 * A bolt between two points: a beam of fewer options.
	 *
	 * Pawn: `TE_LIGHTNING`
	 */
	export function lightning(options: LightningOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_LIGHTNING, to);
		coords(options.start);
		coords(options.end);
		byte(options.life * 10.0);
		byte(options.width);
		byte(options.noise ?? 0);
		write_short(<i32>options.sprite.index);
		message_end();
	}

	/**
	 * Takes away every beam attached to an entity.
	 *
	 * Pawn: `TE_KILLBEAM`
	 */
	export function killBeams(options: EntityEffectOptions, to: EffectRecipients = {}): void {
		begin(TE_KILLBEAM, to);
		write_short(<i32>options.entity.id);
		message_end();
	}

	/**
	 * An explosion: a sprite, two lights, flying particles and the sound, rising slowly.
	 *
	 * Pawn: `TE_EXPLOSION`
	 */
	export function explosion(options: ExplosionOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		let flags = 0;
		if (!(options.additive ?? true)) flags |= TE_EXPLFLAG_NOADDITIVE;
		if (!(options.lights ?? true)) flags |= TE_EXPLFLAG_NODLIGHTS;
		if (!(options.sound ?? true)) flags |= TE_EXPLFLAG_NOSOUND;
		if (!(options.particles ?? true)) flags |= TE_EXPLFLAG_NOPARTICLES;
		begin(TE_EXPLOSION, to);
		coords(options.at);
		write_short(<i32>options.sprite.index);
		byte(options.scale ?? 10);
		byte(options.frameRate ?? 15);
		write_byte(flags);
		message_end();
	}

	/**
	 * A burst of dark particles with a sound.
	 *
	 * Pawn: `TE_TAREXPLOSION`
	 */
	export function tarExplosion(options: PointEffectOptions, to: EffectRecipients = {}): void {
		point(TE_TAREXPLOSION, options, to);
	}

	/**
	 * A burst of particles in colours of the game's palette, with a sound.
	 *
	 * Pawn: `TE_EXPLOSION2`
	 */
	export function particleExplosion(options: ParticleExplosionOptions, to: EffectRecipients = {}): void {
		begin(TE_EXPLOSION2, to);
		coords(options.at);
		byte(options.palette ?? 0);
		byte(options.colors ?? 16);
		message_end();
	}

	/**
	 * A puff of smoke: a see-through sprite rising.
	 *
	 * Pawn: `TE_SMOKE`
	 */
	export function smoke(options: SmokeOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_SMOKE, to);
		coords(options.at);
		write_short(<i32>options.sprite.index);
		byte(options.scale ?? 10);
		byte(options.frameRate ?? 10);
		message_end();
	}

	/**
	 * Tracers flying into a point.
	 *
	 * Pawn: `TE_IMPLOSION`
	 */
	export function implosion(options: ImplosionOptions, to: EffectRecipients = {}): void {
		begin(TE_IMPLOSION, to);
		coords(options.at);
		byte(options.radius);
		byte(options.count);
		byte(options.life * 10.0);
		message_end();
	}

	/**
	 * A bullet's hit: particles and a ricochet's sound.
	 *
	 * Pawn: `TE_GUNSHOT`
	 */
	export function gunshot(options: PointEffectOptions, to: EffectRecipients = {}): void {
		point(TE_GUNSHOT, options, to);
	}

	/**
	 * Sparks falling from a point.
	 *
	 * Pawn: `TE_SPARKS`
	 */
	export function sparks(options: PointEffectOptions, to: EffectRecipients = {}): void {
		point(TE_SPARKS, options, to);
	}

	/**
	 * A bullet off armour: a quick spark and a ricochet's sound.
	 *
	 * Pawn: `TE_ARMOR_RICOCHET`
	 */
	export function armorRicochet(options: ArmorRicochetOptions, to: EffectRecipients = {}): void {
		begin(TE_ARMOR_RICOCHET, to);
		coords(options.at);
		byte(options.scale ?? 10);
		message_end();
	}

	/**
	 * A splash of particles, as from lava.
	 *
	 * Pawn: `TE_LAVASPLASH`
	 */
	export function lavaSplash(options: PointEffectOptions, to: EffectRecipients = {}): void {
		point(TE_LAVASPLASH, options, to);
	}

	/**
	 * A splash of particles, as at a teleport.
	 *
	 * Pawn: `TE_TELEPORT`
	 */
	export function teleport(options: PointEffectOptions, to: EffectRecipients = {}): void {
		point(TE_TELEPORT, options, to);
	}

	/**
	 * A tracer flying from one point to another.
	 *
	 * Pawn: `TE_TRACER`
	 */
	export function tracer(options: SegmentEffectOptions, to: EffectRecipients = {}): void {
		segment(TE_TRACER, options, to);
	}

	/**
	 * A line of particles between two points that stays 30 seconds.
	 *
	 * Pawn: `TE_SHOWLINE`
	 */
	export function showLine(options: SegmentEffectOptions, to: EffectRecipients = {}): void {
		segment(TE_SHOWLINE, options, to);
	}

	/**
	 * A shower of tracers in a direction.
	 *
	 * Pawn: `TE_STREAK_SPLASH`
	 */
	export function streakSplash(options: StreakSplashOptions, to: EffectRecipients = {}): void {
		begin(TE_STREAK_SPLASH, to);
		coords(options.at);
		coords(options.direction);
		byte(options.palette ?? 5);
		short(options.count);
		short(options.speed);
		short(options.randomness ?? 0);
		message_end();
	}

	/**
	 * A glowing sprite that plays once.
	 *
	 * Pawn: `TE_SPRITE`
	 */
	export function sprite(options: SpriteOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_SPRITE, to);
		coords(options.at);
		write_short(<i32>options.sprite.index);
		byte(options.scale ?? 10);
		byte(options.alpha ?? 255);
		message_end();
	}

	/**
	 * A glowing sprite that stays a while.
	 *
	 * Pawn: `TE_GLOWSPRITE`
	 */
	export function glowSprite(options: GlowSpriteOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_GLOWSPRITE, to);
		coords(options.at);
		write_short(<i32>options.sprite.index);
		byte(options.life * 10.0);
		byte(options.scale ?? 10);
		byte(options.alpha ?? 255);
		message_end();
	}

	/**
	 * A line of glowing sprites that fly off it, fall and fade.
	 *
	 * Pawn: `TE_SPRITETRAIL`
	 */
	export function spriteTrail(options: SpriteTrailOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_SPRITETRAIL, to);
		coords(options.start);
		coords(options.end);
		write_short(<i32>options.sprite.index);
		byte(options.count);
		byte(options.life * 10.0);
		byte(options.scale ?? 10);
		byte(options.speed ?? 10);
		byte(options.randomness ?? 10);
		message_end();
	}

	/**
	 * A spray of see-through sprites.
	 *
	 * Pawn: `TE_SPRITE_SPRAY`
	 */
	export function spriteSpray(options: SpriteSprayOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_SPRITE_SPRAY, to);
		coords(options.at);
		coords(options.velocity);
		write_short(<i32>options.sprite.index);
		byte(options.count);
		byte(options.speed);
		byte(options.noise ?? 0);
		message_end();
	}

	/**
	 * A funnel of sprites flying into a point, or out of it.
	 *
	 * Pawn: `TE_LARGEFUNNEL`
	 */
	export function largeFunnel(options: LargeFunnelOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_LARGEFUNNEL, to);
		coords(options.at);
		write_short(<i32>options.sprite.index);
		write_short(options.reverse ? 1 : 0);
		message_end();
	}

	/**
	 * Bubbles rising inside a brush entity, such as water.
	 *
	 * Pawn: `TE_FIZZ`
	 */
	export function fizz(options: FizzOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_FIZZ, to);
		write_short(<i32>options.entity.id);
		write_short(<i32>options.sprite.index);
		byte(options.density);
		message_end();
	}

	/**
	 * Bubbles rising from a box.
	 *
	 * Pawn: `TE_BUBBLES`
	 */
	export function bubbles(options: BubblesOptions, to: EffectRecipients = {}): void {
		riseBubbles(TE_BUBBLES, options, to);
	}

	/**
	 * Bubbles rising from a line.
	 *
	 * Pawn: `TE_BUBBLETRAIL`
	 */
	export function bubbleTrail(options: BubblesOptions, to: EffectRecipients = {}): void {
		riseBubbles(TE_BUBBLETRAIL, options, to);
	}

	/**
	 * A light that lights up the world around a point.
	 *
	 * Pawn: `TE_DLIGHT`
	 */
	export function dynamicLight(options: DynamicLightOptions, to: EffectRecipients = {}): void {
		begin(TE_DLIGHT, to);
		coords(options.at);
		byte(options.radius / 10.0);
		color(options.color ?? "#ffffff");
		byte(options.life * 10.0);
		byte((options.decay ?? 0) / 10.0);
		message_end();
	}

	/**
	 * A light on an entity that lights up entities only, not the world.
	 *
	 * Pawn: `TE_ELIGHT`
	 */
	export function entityLight(options: EntityLightOptions, to: EffectRecipients = {}): void {
		begin(TE_ELIGHT, to);
		write_short(<i32>options.entity.id);
		coords(options.at);
		write_coord_f(options.radius);
		color(options.color ?? "#ffffff");
		byte(options.life * 10.0);
		write_coord_f(options.decay ?? 0);
		message_end();
	}

	/**
	 * A coloured line between two points.
	 *
	 * Pawn: `TE_LINE`
	 */
	export function line(options: LineOptions, to: EffectRecipients = {}): void {
		begin(TE_LINE, to);
		coords(options.start);
		coords(options.end);
		short(options.life * 10.0);
		color(options.color ?? "#ffffff");
		message_end();
	}

	/**
	 * The edges of a box in colour.
	 *
	 * Pawn: `TE_BOX`
	 */
	export function box(options: BoxOptions, to: EffectRecipients = {}): void {
		begin(TE_BOX, to);
		coords(options.mins);
		coords(options.maxs);
		short(options.life * 10.0);
		color(options.color ?? "#ffffff");
		message_end();
	}

	/**
	 * A spray of blood particles.
	 *
	 * Pawn: `TE_BLOOD`
	 */
	export function blood(options: BloodOptions, to: EffectRecipients = {}): void {
		sprayBlood(TE_BLOOD, options, to);
	}

	/**
	 * A stream of blood particles.
	 *
	 * Pawn: `TE_BLOODSTREAM`
	 */
	export function bloodStream(options: BloodOptions, to: EffectRecipients = {}): void {
		sprayBlood(TE_BLOODSTREAM, options, to);
	}

	/**
	 * Blood as the game draws a hit: drops that fall and a blot that stays a moment.
	 *
	 * Pawn: `TE_BLOODSPRITE`
	 */
	export function bloodSprite(options: BloodSpriteOptions, to: EffectRecipients = {}): void {
		if (!precached([options.spray, options.drop])) return;
		begin(TE_BLOODSPRITE, to);
		coords(options.at);
		write_short(<i32>options.spray.index);
		write_short(<i32>options.drop.index);
		byte(options.palette ?? BLOOD_RED);
		byte(options.scale ?? 10);
		message_end();
	}

	/**
	 * A model thrown from a point that bounces - a shell out of a gun.
	 *
	 * Pawn: `TE_MODEL`
	 */
	export function model(options: ModelOptions, to: EffectRecipients = {}): void {
		if (!precached([options.model])) return;
		const sound = options.sound ?? "none";
		begin(TE_MODEL, to);
		coords(options.at);
		coords(options.velocity);
		write_angle_f(options.yaw ?? 0);
		write_short(<i32>options.model.index);
		write_byte(sound == "shell" ? 1 : sound == "shotgunShell" ? 2 : 0);
		byte(options.life * 10.0);
		message_end();
	}

	/**
	 * Pieces of a model flying out of a point in every direction.
	 *
	 * Pawn: `TE_EXPLODEMODEL`
	 */
	export function explodeModel(options: ExplodeModelOptions, to: EffectRecipients = {}): void {
		if (!precached([options.model])) return;
		begin(TE_EXPLODEMODEL, to);
		coords(options.at);
		write_coord_f(options.speed);
		write_short(<i32>options.model.index);
		short(options.count);
		byte(options.life * 10.0);
		message_end();
	}

	/**
	 * Pieces flying out of a box - something broken:
	 *
	 * ```ts
	 * effects.breakModel({ at: box.origin, size: [16, 16, 16], velocity: [0, 0, 50], model: gibs, count: 8, life: 2, material: "glass" });
	 * ```
	 *
	 * Pawn: `TE_BREAKMODEL`
	 */
	export function breakModel(options: BreakModelOptions, to: EffectRecipients = {}): void {
		if (!precached([options.model])) return;
		const material = BREAK_MATERIALS.indexOf(options.material ?? "none");
		let flags = material >= 0 ? BREAK_FLAGS[material] : 0;
		if (options.smoke) flags |= 0x10;
		if (options.transparent) flags |= 0x20;
		begin(TE_BREAKMODEL, to);
		coords(options.at);
		coords(options.size);
		coords(options.velocity);
		byte(options.randomness ?? 0);
		write_short(<i32>options.model.index);
		byte(options.count);
		byte(options.life * 10.0);
		write_byte(flags);
		message_end();
	}

	/**
	 * A model flying like a nail that hits players.
	 *
	 * Pawn: `TE_PROJECTILE`
	 */
	export function projectile(options: ProjectileOptions, to: EffectRecipients = {}): void {
		if (!precached([options.model])) return;
		const owner = options.owner;
		begin(TE_PROJECTILE, to);
		coords(options.at);
		coords(options.velocity);
		write_short(<i32>options.model.index);
		byte(options.life);
		write_byte(owner != null ? <i32>owner.id : 0);
		message_end();
	}

	/**
	 * A shower of models or sprites thrown in a direction.
	 *
	 * Pawn: `TE_SPRAY`
	 */
	export function spray(options: SprayOptions, to: EffectRecipients = {}): void {
		if (!precached([options.model])) return;
		begin(TE_SPRAY, to);
		coords(options.at);
		coords(options.direction);
		write_short(<i32>options.model.index);
		byte(options.count);
		byte(options.speed);
		byte(options.noise ?? 0);
		write_byte(max(RENDER_MODES.indexOf(options.renderMode ?? "normal"), 0));
		message_end();
	}

	/**
	 * Sprites flying out of a player's body.
	 *
	 * Pawn: `TE_PLAYERSPRITES`
	 */
	export function playerSprites(options: PlayerSpritesOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		begin(TE_PLAYERSPRITES, to);
		write_short(<i32>options.player.id);
		write_short(<i32>options.sprite.index);
		byte(options.count);
		byte(options.variance ?? 0);
		message_end();
	}

	/**
	 * A burst of particles in one colour of the game's palette.
	 *
	 * Pawn: `TE_PARTICLEBURST`
	 */
	export function particleBurst(options: ParticleBurstOptions, to: EffectRecipients = {}): void {
		begin(TE_PARTICLEBURST, to);
		coords(options.at);
		short(options.radius);
		byte(options.palette ?? 0);
		byte(options.life * 10.0);
		message_end();
	}

	/**
	 * A field of fire sprites filling a square.
	 *
	 * Pawn: `TE_FIREFIELD`
	 */
	export function fireField(options: FireFieldOptions, to: EffectRecipients = {}): void {
		if (!precached([options.sprite])) return;
		const rise = options.rise ?? "none";
		const blend = options.blend ?? "opaque";
		let flags = rise == "all" ? TEFIRE_FLAG_ALLFLOAT : rise == "some" ? TEFIRE_FLAG_SOMEFLOAT : 0;
		if (blend == "alpha") flags |= TEFIRE_FLAG_ALPHA;
		if (blend == "additive") flags |= TEFIRE_FLAG_ADDITIVE;
		if (options.loop) flags |= TEFIRE_FLAG_LOOP;
		if (options.flat) flags |= TEFIRE_FLAG_PLANAR;
		begin(TE_FIREFIELD, to);
		coords(options.at);
		short(options.radius);
		write_short(<i32>options.sprite.index);
		byte(options.count);
		write_byte(flags);
		byte(options.life * 10.0);
		message_end();
	}

	/**
	 * A model attached above a player that goes where he goes.
	 *
	 * Pawn: `TE_PLAYERATTACHMENT`
	 */
	export function playerAttachment(options: PlayerAttachmentOptions, to: EffectRecipients = {}): void {
		if (!precached([options.model])) return;
		begin(TE_PLAYERATTACHMENT, to);
		write_byte(<i32>options.player.id);
		write_coord_f(options.offset ?? 0);
		write_short(<i32>options.model.index);
		short(options.life * 10.0);
		message_end();
	}

	/**
	 * Takes away every model attached to a player.
	 *
	 * Pawn: `TE_KILLPLAYERATTACHMENTS`
	 */
	export function killPlayerAttachments(options: PlayerEffectOptions, to: EffectRecipients = {}): void {
		begin(TE_KILLPLAYERATTACHMENTS, to);
		write_byte(<i32>options.player.id);
		message_end();
	}
}
