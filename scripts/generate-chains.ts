import type { HamFunction, HamParam } from './ham-functions';
// Generates runtime/src/hookchains.h: the module's own hooks of the game's
// functions - one per ReGameDLL and ReHLDS hookchain reapi's includes name,
// and one per Ham Sandwich function scripts/ham-functions.ts lists - so a
// game event goes from the game straight to the plugins' listeners, with no
// AMX Mod X forward in between.
//
// A hookchain's arguments are read off ReGameDLL's and ReHLDS's API headers
// (runtime/vendor, MIT), where each chain is a typedef:
//
//     typedef IHookChainClass<BOOL, class CBasePlayer, struct entvars_s *,
//         struct entvars_s *, float&, int> IReGameHook_CBasePlayer_TakeDamage;
//
// and the registry of every chain is a virtual function of
// IReGameHookchains or IRehldsHookchains, in the order of the vtable. The
// hook a chain gets hands its arguments to the listeners as cells, in the
// order reapi's include documents them - the order as/hooks.ts reads them
// in - and calls the next hook of the chain with what the listeners left.
// Every C++ type is written as one the module can declare without the
// game's own headers: an enum or a BOOL is an int, a class pointer a
// `void *`, a reference an address; each has the same ABI.
//
// A Ham Sandwich function is a virtual function of the entity's class. Its
// hook goes into the class's vtable, at the offset AMX Mod X's gamedata
// gives under the function's name, and is declared with the arguments
// ham-functions.ts lists: thiscall on Windows (__fastcall with a register
// to spare), the object first on Linux.
//
// Run: bun scripts/generate-chains.ts (after generate-wasm-api, which writes as/constants.ts)
import { readFileSync, writeFileSync } from 'node:fs';
import { HAM_FUNCTIONS } from './ham-functions';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r/g, '');
const regamedll = read('./runtime/vendor/regamedll/regamedll_api.h');
const rehlds = read('./runtime/vendor/rehlds/rehlds_api.h');
const constants = read('./as/constants.ts');

/** What an argument is to the listeners, and how the module turns it into a cell and back. */
type Role = 'int' | 'bool' | 'float' | 'floatRef' | 'text' | 'vector' | 'cbase' | 'pev' | 'edict' | 'client' | 'pointer';

interface CType {
	/** The type the module declares it as. */
	decl: string;
	role: Role;
}

const VOID: CType = { decl: 'void', role: 'int' };

/** The enums, BOOL, qboolean and 32-bit numbers of the headers: an int to the ABI. */
const INTS = new Set([
	'int',
	'unsigned int',
	'BOOL',
	'qboolean',
	'uint32',
	'ULONG',
	'size_t',
	'cmd_source_t',
	'sv_delta_s',
	'resourcetype_t',
	'WeaponIdType',
	'TeamName',
	'ScenarioEventEndRound',
	'RewardType',
	'PLAYER_ANIM',
	'ItemRestType',
	'ItemID',
	'GameEventType',
	'MenuChooseTeam',
	'VGUIMenu',
	'DeathMessageFlags',
	'KillRarity',
	'HitBoxGroup',
	'ArmouryItemPack',
	'AmmoType',
	'InventorySlotType',
]);

/** A C++ type of the headers as the module declares it. */
function typeOf(raw: string, where: string): CType {
	const type = raw.replace(/\s+/g, ' ').replace(/ ?([*&]) ?/g, '$1').replace(/^(?:class|struct|enum) /, '').trim();
	if (type === 'void') return VOID;
	if (type === 'bool') return { decl: 'bool', role: 'bool' };
	if (type === 'float') return { decl: 'float', role: 'float' };
	if (type === 'float&') return { decl: 'float &', role: 'floatRef' };
	if (/^(?:unsigned )?(?:short|char)$/.test(type)) return { decl: type, role: 'int' };
	if (/^(?:const )?char\*$/.test(type)) return { decl: 'const char *', role: 'text' };
	if (type === 'Vector&' || type === 'const Vector&') return { decl: 'Vector &', role: 'vector' };
	if (type === 'vec_t*' || type === 'const float*') return { decl: 'float *', role: 'vector' };
	if (type === 'entvars_s*' || type === 'entvars_t*') return { decl: 'entvars_t *', role: 'pev' };
	if (type === 'edict_s*' || type === 'edict_t*') return { decl: 'edict_t *', role: 'edict' };
	if (type === 'IGameClient*') return { decl: 'IGameClient *', role: 'client' };
	if (/^C(?:Base\w*|Grenade|WeaponBox|Gib)\*$/.test(type)) return { decl: 'void *', role: 'cbase' };
	if (type === 'uint64') return { decl: 'unsigned long long', role: 'int' };
	// An enum, a BOOL, a qboolean, a 32-bit number: an int to the ABI.
	if (INTS.has(type)) return { decl: 'int', role: 'int' };
	// Anything else by its address: a trace, a buffer, a network address.
	if (/[*&]$/.test(type) || type === 'ENTITYINIT') return { decl: 'void *', role: 'pointer' };
	throw new Error(`${where}: no way to hand over the type \`${raw}\` (scripts/generate-chains.ts)`);
}

interface Chain {
	/** reapi's constant, RG_... or RH_... */
	constant: string;
	id: number;
	/** The registry's name, a virtual function of the API's hookchains. */
	name: string;
	rehlds: boolean;
	/** The template: IHookChain, IHookChainClass or IVoidHookChain. */
	shape: string;
	ret: CType;
	/** The C++ parameters, `this` first for a class's chain. */
	params: CType[];
	/** Each cell the listeners get: the C++ parameter it is, or the player a movement chain is about. */
	cells: { role: Role; from: number | 'pmovePlayer' | 'ppmovePlayer' }[];
}

/** Each chain's typedef in a header: its template, return type, class and arguments. */
function typedefs(header: string, prefix: string) {
	const found = new Map<string, { shape: string; parts: string[] }>();
	for (const m of header.matchAll(new RegExp(`typedef (IHookChain|IHookChainClass|IVoidHookChain)<([^;]*)> ${prefix}_(\\w+);`, 'g'))) {
		found.set(m[3], { shape: m[1], parts: m[2].split(',').map(s => s.trim()).filter(Boolean) });
	}
	return found;
}

/** The registries in the vtable's order. */
function registries(header: string, cls: string) {
	const body = header.slice(header.indexOf(`class ${cls} {`), header.indexOf('};', header.indexOf(`class ${cls} {`)));
	return [...body.matchAll(/virtual \w+ ?\* ?(\w+)\(\) = 0;/g)].map(m => m[1]);
}

const games = { types: typedefs(regamedll, 'IReGameHook'), order: registries(regamedll, 'IReGameHookchains') };
const engines = { types: typedefs(rehlds, 'IRehldsHook'), order: registries(rehlds, 'IRehldsHookchains') };

/**
 * The chains whose reapi arguments are not the C++ ones one for one: the
 * player a movement chain is about, which reapi adds last (from the
 * playermove the game moves him with), and what reapi leaves out.
 */
const CELLS: Record<string, Chain['cells']> = {
	PM_Move: [{ role: 'int', from: 'ppmovePlayer' }],
	PM_LadderMove: [{ role: 'pointer', from: 0 }, { role: 'int', from: 'pmovePlayer' }],
	PM_WaterJump: [{ role: 'int', from: 'pmovePlayer' }],
	PM_CheckWaterJump: [{ role: 'int', from: 'pmovePlayer' }],
	PM_Jump: [{ role: 'int', from: 'pmovePlayer' }],
	PM_Duck: [{ role: 'int', from: 'pmovePlayer' }],
	PM_UnDuck: [{ role: 'int', from: 'pmovePlayer' }],
	PM_PlayStepSound: [{ role: 'int', from: 0 }, { role: 'float', from: 1 }, { role: 'int', from: 'pmovePlayer' }],
	PM_AirAccelerate: [{ role: 'vector', from: 0 }, { role: 'float', from: 1 }, { role: 'float', from: 2 }, { role: 'int', from: 'pmovePlayer' }],
	SV_WriteFullClientUpdate: [{ role: 'client', from: 0 }, { role: 'text', from: 1 }, { role: 'client', from: 4 }],
	SV_EmitPings: [{ role: 'client', from: 0 }],
	EV_Precache: [{ role: 'text', from: 1 }],
};

const chains: Chain[] = [];
for (const m of constants.matchAll(/^export const (R[GH])_(\w+): i32 = (\d+);/gm)) {
	const rehldsChain = m[1] === 'RH';
	const api = rehldsChain ? engines : games;
	const found = api.types.get(m[2]);
	if (!found) throw new Error(`${m[1]}_${m[2]}: no hookchain ${m[2]} in ${rehldsChain ? 'ReHLDS' : 'ReGameDLL'}'s API header (runtime/vendor)`);
	if (!api.order.includes(m[2])) throw new Error(`${m[2]}: no registry for it in the API's hookchains`);
	const parts = [...found.parts];
	const ret = found.shape === 'IVoidHookChain' ? VOID : typeOf(parts.shift()!, m[2]);
	// The class a class's chain is about is its first argument, `this`.
	const self: CType[] = found.shape === 'IHookChainClass' && parts.shift() ? [{ decl: 'void *', role: 'cbase' }] : [];
	const params = [...self, ...parts.map(part => typeOf(part, m[2]))];
	const cells = CELLS[m[2]] ?? params.map((p, i) => ({ role: p.role, from: i }));
	chains.push({ constant: `${m[1]}_${m[2]}`, id: Number(m[3]), name: m[2], rehlds: rehldsChain, shape: found.shape, ret, params, cells });
}

const ROLE_CONSTANT: Record<Role, string> = {
	int: 'ROLE_INT',
	bool: 'ROLE_BOOL',
	float: 'ROLE_FLOAT',
	floatRef: 'ROLE_FLOAT_REF',
	text: 'ROLE_TEXT',
	vector: 'ROLE_VECTOR',
	cbase: 'ROLE_CBASE',
	pev: 'ROLE_PEV',
	edict: 'ROLE_EDICT',
	client: 'ROLE_CLIENT',
	pointer: 'ROLE_POINTER',
};

const ROLE_SUFFIX: Record<Role, string> = {
	int: 'Int',
	bool: 'Bool',
	float: 'Float',
	floatRef: 'FloatRef',
	text: 'Text',
	vector: 'Vec',
	cbase: 'Cbase',
	pev: 'Pev',
	edict: 'Edict',
	client: 'Client',
	pointer: 'Pointer',
};

/** A cell's value going in: `call.<Role>(i, <expression>)`. */
function push(role: Role, i: number, value: string, decl: string) {
	// What is held by its address, the address: a reference's or a by-value Vector's own.
	if ((role === 'floatRef' || role === 'vector') && !decl.endsWith('*')) return `call.${ROLE_SUFFIX[role]}(${i}, &${value});`;
	return `call.${ROLE_SUFFIX[role]}(${i}, ${value});`;
}

/** A parameter going on to the next hook: what the listeners left in its cell, or as it came. */
function pass(role: Role, cell: number, value: string, decl: string) {
	switch (role) {
		case 'int': return `(${decl})call.cells[${cell}]`;
		case 'bool': return `call.cells[${cell}] != 0`;
		case 'float': return `call.FloatAt(${cell})`;
		case 'floatRef':
		case 'vector':
		case 'client':
			return value;
		case 'pointer': return `(${decl})call.PointerAt(${cell}, ${value})`;
		default: return `call.${ROLE_SUFFIX[role]}At(${cell}, ${value})`;
	}
}

/** How the module answers for the function from the call's result. */
function answer(ret: CType) {
	switch (ret.role) {
		case 'bool': return 'call.result != 0';
		case 'float': return 'call.ResultFloat()';
		case 'text': return 'call.ResultText()';
		case 'vector': return '*call.ResultVectorRef()';
		case 'cbase': return 'call.CbaseAt(-1, NULL)';
		case 'edict': return 'call.EdictAt(-1, NULL)';
		case 'pev': return 'call.PevAt(-1, NULL)';
		case 'pointer': return `(${ret.decl})call.PointerAt(-1, NULL)`;
		default: return `(${ret.decl})call.result`;
	}
}

/** The original's answer kept as the call's result. */
function kept(ret: CType, value: string) {
	switch (ret.role) {
		case 'bool': return `call.Returned(${value} ? 1 : 0);`;
		case 'float': return `call.ReturnedFloat(${value});`;
		case 'text': return `call.ReturnedText(${value});`;
		case 'vector': return `call.ReturnedVectorRef(&${value});`;
		case 'cbase': return `call.Returned(CellOfCbase(${value}));`;
		case 'edict': return `call.Returned(CellOfEdict(${value}));`;
		case 'pev': return `call.Returned(CellOfPev(${value}));`;
		case 'pointer': return `call.Returned((cell)(intptr_t)${value});`;
		default: return `call.Returned((cell)${value});`;
	}
}

const chainBlocks: string[] = [];
const chainTable: string[] = [];

chains.forEach((chain, index) => {
	const { name, ret, params, cells } = chain;
	const args = params.map(p => p.decl);
	const isClass = chain.shape === 'IHookChainClass';
	const chainType = chain.shape === 'IVoidHookChain'
		? `re::IVoidHookChain<${args.join(', ')}>`
		: isClass
			? `re::IHookChainClass<${[ret.decl, 'void', ...args.slice(1)].join(', ')}>`
			: `re::IHookChain<${[ret.decl, ...args].join(', ')}>`;
	const registryType = chainType.replace(/HookChain(Class)?</, 'HookChainRegistry$1<');
	const declared = params.map((p, i) => `${p.decl.endsWith('&') || p.decl.endsWith('*') ? p.decl : `${p.decl} `}a${i}`);
	const roles = cells.map(c => ROLE_CONSTANT[c.role]).join(', ');
	const pushes = cells.map((c, i) => {
		if (c.from === 'pmovePlayer') return `call.Int(${i}, PmovePlayer(NULL));`;
		if (c.from === 'ppmovePlayer') return `call.Int(${i}, PmovePlayer((playermove_t *)a0));`;
		return push(c.role, i, `a${c.from}`, params[c.from].decl);
	});
	const cellOf = new Map(cells.map((c, i) => [c.from, i]));
	const next = params.map((p, i) => {
		const cell = cellOf.get(i);
		return cell === undefined ? `a${i}` : pass(p.role, cell, `a${i}`, p.decl);
	});
	const call = `chain->callNext(${next.join(', ')})`;
	chainBlocks.push([
		`// ${chain.constant}`,
		`typedef ${registryType} ChainRegistry_${index};`,
		`static ${ret.decl === 'void' ? 'void ' : ret.decl.endsWith('*') ? ret.decl : `${ret.decl} `}Chain_${index}(${[`${chainType} *chain`, ...declared].join(', ')})`,
		`{`,
		`\tstatic const unsigned char roles[] = { ${roles || '0'} };`,
		`\tChainCall call(g_chainPoints[${index}], roles, ${cells.length});`,
		...pushes.map(line => `\t${line}`),
		`\tif (call.Pre())`,
		ret.decl === 'void' ? `\t\t${call};` : `\t\t${kept(ret, call)}`,
		`\tcall.Post();`,
		...(ret.decl === 'void' ? [] : [`\treturn ${answer(ret)};`]),
		`}`,
		`static void Attach_${index}(bool on)`,
		`{`,
		`\tChainRegistry_${index} *registry = (ChainRegistry_${index} *)${chain.rehlds ? 'g_rehldsChains' : 'g_regameChains'}->${name}();`,
		`\tif (on) registry->registerHook(Chain_${index}, CHAIN_PRIORITY);`,
		`\telse registry->unregisterHook(Chain_${index});`,
		`}`,
	].join('\n'));
	chainTable.push(`\t{ ${chain.id}, "${chain.constant}", ${chain.rehlds ? 'true' : 'false'}, Attach_${index} },`);
});

// ---------------------------------------------------------------- Ham Sandwich

/** A Ham Sandwich argument as the game's function takes it. */
function hamParam(p: HamParam): CType {
	if (p.native === 'entvars') return { decl: 'entvars_t *', role: 'pev' };
	if (p.native === 'pointer') return p.kind === 'vector' ? { decl: 'Vector *', role: 'vector' } : { decl: 'void *', role: 'pointer' };
	switch (p.kind) {
		case 'entity':
		case 'player':
		case 'weapon':
			return { decl: 'void *', role: 'cbase' };
		case 'float': return { decl: 'float', role: 'float' };
		case 'vector': return { decl: 'Vector', role: 'vector' };
		case 'string': return { decl: 'const char *', role: 'text' };
		default: return { decl: 'int', role: 'int' };
	}
}

/** What a Ham Sandwich function returns. A BOOL the game may answer as a C++ bool is read by its low byte. */
function hamAnswer(f: HamFunction): CType {
	switch (f.answer) {
		case 'none': return VOID;
		case 'float': return { decl: 'float', role: 'float' };
		case 'entity': return { decl: 'void *', role: 'cbase' };
		case 'string': return { decl: 'const char *', role: 'text' };
		case 'vector': return { decl: 'Vector', role: 'vector' };
		case 'bool': return { decl: 'int', role: 'bool' };
		default: return { decl: 'int', role: 'int' };
	}
}

/** The gamedata's name of a Ham Sandwich function's offset: `takedamage`, `cstrike_item_candrop`. */
const hamKey = (ham: string) => ham.replace(/^Ham_/, '').replace(/^CS_/, 'cstrike_').toLowerCase();

const hamIds = new Map([...constants.matchAll(/^export const (Ham_\w+): i32 = (\d+);/gm)].map(m => [m[1], Number(m[2])]));

const hamBlocks: string[] = [];
const hamTable: string[] = [];

HAM_FUNCTIONS.forEach((f, index) => {
	const id = hamIds.get(f.ham);
	if (id === undefined) throw new Error(`${f.ham}: not in as/constants.ts`);
	const params = f.params.map(hamParam);
	const ret = hamAnswer(f);
	const vectorAnswer = ret.decl === 'Vector';
	const declared = params.map((p, i) => `${p.decl.endsWith('*') ? p.decl : `${p.decl} `}a${i + 1}`);
	const types = params.map(p => p.decl);
	const roles = ['ROLE_CBASE', ...params.map(p => ROLE_CONSTANT[p.role])].join(', ');
	const pushes = [`call.Cbase(0, self);`, ...params.map((p, i) => push(p.role, i + 1, `a${i + 1}`, p.decl))];
	const next = params.map((p, i) => pass(p.role, i + 1, `a${i + 1}`, p.decl));
	const original = `point->original`;
	// The original's answer, and how the hook's own answer is given.
	let signature: string;
	let callOriginal: string;
	let keep: string;
	let give: string[];
	if (vectorAnswer) {
		// A Vector is answered through an address the caller passes: first
		// on the stack after `this` on Windows, first of all on Linux, where
		// the declared Vector does it.
		signature = [
			`#ifdef _WIN32`,
			`static Vector *__fastcall Ham_${index}(${['void *self, int, Vector *out', ...declared].join(', ')})`,
			`#else`,
			`static Vector Ham_${index}(${['void *self', ...declared].join(', ')})`,
			`#endif`,
		].join('\n');
		callOriginal = [
			`#ifdef _WIN32`,
			`\t\t{ Vector v; ((Vector *(__fastcall *)(${['void *', 'int', 'Vector *', ...types].join(', ')}))${original})(${['self', '0', '&v', ...next].join(', ')}); call.ReturnedVector(v); }`,
			`#else`,
			`\t\tcall.ReturnedVector(((Vector (*)(${['void *', ...types].join(', ')}))${original})(${['self', ...next].join(', ')}));`,
			`#endif`,
		].join('\n');
		keep = '';
		give = [
			`#ifdef _WIN32`,
			`\tcall.ResultVector(out);`,
			`\treturn out;`,
			`#else`,
			`\tVector v;`,
			`\tcall.ResultVector(&v);`,
			`\treturn v;`,
			`#endif`,
		];
	} else {
		const retDecl = ret.decl === 'void' ? 'void ' : ret.decl.endsWith('*') ? ret.decl : `${ret.decl} `;
		signature = `static ${retDecl}HAM_CC Ham_${index}(${['HAM_SELF', ...declared].join(', ')})`;
		const fn = `((${ret.decl} (HAM_CC *)(${['HAM_SELF', ...types].join(', ')}))${original})(${['HAM_PASS', ...next].join(', ')})`;
		const masked = ret.role === 'bool' ? `(${fn} & 0xFF)` : fn;
		callOriginal = ret.decl === 'void' ? `\t\t${fn};` : `\t\t${kept(ret.role === 'bool' ? { decl: 'int', role: 'int' } : ret, masked)}`;
		keep = '';
		give = ret.decl === 'void' ? [] : [`\treturn ${answer(ret.role === 'bool' ? { decl: 'int', role: 'int' } : ret)};`];
	}
	hamBlocks.push([
		`// ${f.ham}`,
		signature,
		`{`,
		`\tstatic const unsigned char roles[] = { ${roles} };`,
		`\tHookPoint *point = HamPoint(${index}, self);`,
		`\tChainCall call(*point, roles, ${params.length + 1});`,
		`\tcall.quiet = HamQuiet(${index}, self);`,
		...pushes.map(line => `\t${line}`),
		`\tif (call.Pre())`,
		callOriginal,
		...(keep ? [keep] : []),
		`\tcall.Post();`,
		...give,
		`}`,
	].join('\n'));
	hamTable.push(`\t{ ${id}, "${hamKey(f.ham)}", (void *)Ham_${index} },`);
});

/** The hookchains of one API as the module declares them: every registry in the vtable's order. */
function hookchainsClass(cls: string, order: string[]) {
	return [
		`class ${cls} {`,
		`public:`,
		`\tvirtual ~${cls}() {}`,
		...order.map(name => `\tvirtual void *${name}() = 0;`),
		`};`,
	].join('\n');
}

writeFileSync('./runtime/src/hookchains-api.h', `// GENERATED by scripts/generate-chains.ts - do not edit
// Source: runtime/vendor/regamedll/regamedll_api.h, runtime/vendor/rehlds/rehlds_api.h
// (ReGameDLL's and ReHLDS's API headers, MIT - runtime/vendor/*/LICENSE),
// as/constants.ts (reapi's chain numbers), scripts/ham-functions.ts.
//
// ReGameDLL's and ReHLDS's API as far as the module's hooks need it: the
// hookchains' templates and registries, and how to reach them.
#pragma once

namespace re {

template <typename t_ret, typename... t_args>
class IHookChain {
protected:
	virtual ~IHookChain() {}

public:
	virtual t_ret callNext(t_args... args) = 0;
	virtual t_ret callOriginal(t_args... args) = 0;
};

template <typename t_ret, typename t_class, typename... t_args>
class IHookChainClass {
protected:
	virtual ~IHookChainClass() {}

public:
	virtual t_ret callNext(t_class *, t_args... args) = 0;
	virtual t_ret callOriginal(t_class *, t_args... args) = 0;
};

template <typename... t_args>
class IVoidHookChain {
protected:
	virtual ~IVoidHookChain() {}

public:
	virtual void callNext(t_args... args) = 0;
	virtual void callOriginal(t_args... args) = 0;
};

template <typename t_ret, typename... t_args>
class IHookChainRegistry {
public:
	typedef t_ret (*hookfunc_t)(IHookChain<t_ret, t_args...> *, t_args...);
	virtual void registerHook(hookfunc_t hook, int priority) = 0;
	virtual void unregisterHook(hookfunc_t hook) = 0;
};

template <typename t_ret, typename t_class, typename... t_args>
class IHookChainRegistryClass {
public:
	typedef t_ret (*hookfunc_t)(IHookChainClass<t_ret, t_class, t_args...> *, t_class *, t_args...);
	virtual void registerHook(hookfunc_t hook, int priority) = 0;
	virtual void unregisterHook(hookfunc_t hook) = 0;
};

template <typename... t_args>
class IVoidHookChainRegistry {
public:
	typedef void (*hookfunc_t)(IVoidHookChain<t_args...> *, t_args...);
	virtual void registerHook(hookfunc_t hook, int priority) = 0;
	virtual void unregisterHook(hookfunc_t hook) = 0;
};

${hookchainsClass('IReGameHookchains', games.order)}

${hookchainsClass('IRehldsHookchains', engines.order)}

/** ReGameDLL's API, as far as the module calls it. */
class IReGameApi {
public:
	virtual ~IReGameApi() {}
	virtual int GetMajorVersion() = 0;
	virtual int GetMinorVersion() = 0;
	virtual const void *GetFuncs() = 0;
	virtual IReGameHookchains *GetHookchains() = 0;
	virtual void *GetGameRules() = 0;
	virtual void *GetWeaponInfo(int weaponID) = 0;
	virtual void *GetWeaponInfo(const char *weaponName) = 0;
	virtual playermove_t *GetPlayerMove() = 0;
};

}  // namespace re

#define REGAMEDLL_API_VERSION_MAJOR ${regamedll.match(/#define REGAMEDLL_API_VERSION_MAJOR (\d+)/)![1]}
#define REGAMEDLL_API_VERSION_MINOR ${regamedll.match(/#define REGAMEDLL_API_VERSION_MINOR (\d+)/)![1]}
#define VRE_GAMEDLL_API_VERSION "${regamedll.match(/#define VRE_GAMEDLL_API_VERSION "(\w+)"/)![1]}"
#define CHAINS_REHLDS_MAJOR ${rehlds.match(/#define REHLDS_API_VERSION_MAJOR (\d+)/)![1]}
#define CHAINS_REHLDS_MINOR ${rehlds.match(/#define REHLDS_API_VERSION_MINOR (\d+)/)![1]}

`);

writeFileSync('./runtime/src/hookchains.h', `// GENERATED by scripts/generate-chains.ts - do not edit
// Source: runtime/vendor/regamedll/regamedll_api.h, runtime/vendor/rehlds/rehlds_api.h
// (ReGameDLL's and ReHLDS's API headers, MIT - runtime/vendor/*/LICENSE),
// as/constants.ts (reapi's chain numbers), scripts/ham-functions.ts.
//
// The module's hook of each hookchain and Ham Sandwich function. Included by
// runtime/src/gamehooks.h, which has ChainCall and HookPoint.
#pragma once

#define CHAIN_COUNT ${chains.length}
static HookPoint g_chainPoints[CHAIN_COUNT];

${chainBlocks.join('\n\n')}

struct ChainInfo {
	int         id;        // reapi's number, which hook() takes
	const char *name;
	bool        rehlds;    // ReHLDS's, else ReGameDLL's
	void      (*attach)(bool on);
};

static const ChainInfo g_chainInfo[CHAIN_COUNT] = {
${chainTable.join('\n')}
};

#ifdef _WIN32
#define HAM_CC __fastcall
#define HAM_SELF void *self, int
#define HAM_PASS self, 0
#else
#define HAM_CC
#define HAM_SELF void *self
#define HAM_PASS self
#endif

#define HAM_COUNT ${HAM_FUNCTIONS.length}

static HookPoint *HamPoint(int ham, void *self);
static bool HamQuiet(int ham, void *self);

${hamBlocks.join('\n\n')}

struct HamInfo {
	int         id;        // the Ham_* constant, which ham() takes
	const char *key;       // the offset's name in the gamedata
	void       *hook;
};

static const HamInfo g_hamInfo[HAM_COUNT] = {
${hamTable.join('\n')}
};
`);

console.log(`runtime/src/hookchains.h, hookchains-api.h: ${chains.length} hookchains (${chains.filter(c => !c.rehlds).length} ReGameDLL, ${chains.filter(c => c.rehlds).length} ReHLDS), ${HAM_FUNCTIONS.length} Ham Sandwich functions`);
