// Sounds and played events to some players alone: entity.emitSound's `to`,
// startSound's and playbackEvent's `recipients`. The engine sends a sound or
// an event to a client only when his groupinfo meets the source's, when both
// have one (SV_Multicast, EV_Playback); for the one call the chosen players
// and the source are put in one group and everyone else in another, and every
// group goes back as it was right after - nothing else of the frame sees them.
//
// Included by module.cpp, before the hookchains, whose RH_SV_StartSound
// plays a sound with the choice of its listeners.

// The groups of ChosenGroups: high bits, apart from what a plugin sets.
#define GROUP_CHOSEN 0x40000000
#define GROUP_OTHER  0x20000000

/** The players' and the source's groups set for one call, and put back when it goes out of scope. */
struct ChosenGroups {
	bool on = false;
	edict_t *source = NULL;
	int sourceGroup = 0;
	int groups[CLIENT_SLOTS];

	/** Puts the chosen players (`chosen`, by id) and the source in one group, the other players in another. */
	void Set(const bool *chosen, edict_t *from)
	{
		on = true;
		source = from;
		sourceGroup = from ? from->v.groupinfo : 0;
		for (int id = 1; id < CLIENT_SLOTS && id <= gpGlobals->maxClients; id++) {
			edict_t *e = INDEXENT(id);
			groups[id] = e->v.groupinfo;
			e->v.groupinfo = chosen[id] ? GROUP_CHOSEN : GROUP_OTHER;
		}
		if (from)
			from->v.groupinfo = GROUP_CHOSEN;
		g_engfuncs.pfnSetGroupMask(0, GROUP_OP_AND);
	}

	/** Puts every group back as it was. */
	void Back()
	{
		if (!on)
			return;
		on = false;
		for (int id = 1; id < CLIENT_SLOTS && id <= gpGlobals->maxClients; id++)
			INDEXENT(id)->v.groupinfo = groups[id];
		if (source)
			source->v.groupinfo = sourceGroup;
	}

	~ChosenGroups()
	{
		Back();
	}
};

/** Whom the startSound listeners chose (event.recipients), by id; g_soundChosen once they have. */
static bool g_soundChosen = false;
static bool g_soundTo[CLIENT_SLOTS];

/** sound_to(ids, count) - startSound's recipients: the players the sound plays to. */
static void w_soundTo(wasm_exec_env_t env, int32_t ids, int32_t count)
{
	wasm_module_inst_t inst = Inst(env);
	if (count < 0 || (count > 0 && !wasm_runtime_validate_app_addr(inst, (uint64_t)ids, (uint64_t)count * 4)))
		return;
	const int32_t *id = count > 0 ? (const int32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)ids) : NULL;
	memset(g_soundTo, 0, sizeof(g_soundTo));
	for (int32_t i = 0; i < count; i++)
		if (id[i] > 0 && id[i] < CLIENT_SLOTS)
			g_soundTo[id[i]] = true;
	g_soundChosen = true;
}

/**
 * One startSound's choice of players, for the length of its hook: a sound
 * played from inside a listener makes its own and leaves this one's as it
 * was. Play() sets the groups for the sound's call when the listeners chose,
 * Back() puts them back once it is made, before the listeners after it.
 */
struct SoundChoice {
	bool outerChosen;
	bool outerTo[CLIENT_SLOTS];
	ChosenGroups groups;

	SoundChoice()
	{
		outerChosen = g_soundChosen;
		memcpy(outerTo, g_soundTo, sizeof(outerTo));
		g_soundChosen = false;
	}

	/** Whether the listeners chose; if so, the groups are set for the call that follows. */
	bool Play(edict_t *source)
	{
		if (!g_soundChosen)
			return false;
		groups.Set(g_soundTo, source);
		return true;
	}

	void Back()
	{
		groups.Back();
	}

	~SoundChoice()
	{
		g_soundChosen = outerChosen;
		memcpy(g_soundTo, outerTo, sizeof(outerTo));
	}
};

/**
 * sound_emit(entity, channel, sample, volume, attenuation, pitch, to) - a
 * sound from the entity: to everyone near, or (`to` a player) to him alone.
 * The volume and the attenuation come as an f32's bits: the natives table
 * takes a double only last.
 */
static void w_soundEmit(wasm_exec_env_t env, int32_t entity, int32_t channel, int32_t sample, int32_t volumeBits, int32_t attenuationBits, int32_t pitch, int32_t to)
{
	float volume, attenuation;
	memcpy(&volume, &volumeBits, sizeof(float));
	memcpy(&attenuation, &attenuationBits, sizeof(float));
	edict_t *e = (edict_t *)EdictOf(entity);
	if (!e)
		return;
	std::string path = AsString(Inst(env), sample);
	ChosenGroups groups;
	if (to > 0 && to < CLIENT_SLOTS) {
		bool chosen[CLIENT_SLOTS] = {};
		chosen[to] = true;
		groups.Set(chosen, e);
	}
	g_engfuncs.pfnEmitSound(e, channel, path.c_str(), volume, attenuation, 0, pitch);
}
