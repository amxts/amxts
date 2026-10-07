// A plugin's Storage, kept by the module with no AMX Mod X module in the way:
// a map of text values by text key, each with the moment it was set, in
// memory while the server runs, and on disk as JSON in AMX Mod X's data
// folder, amxts/storage/<name>.json - written at most once a second while it
// changes, through a temporary file, and when the map ends. Every plugin that
// opens one name shares it, as AMX Mod X's nvault shares a vault.
//
// A name with no file yet takes what AMX Mod X's nvault kept under it, once:
// data/vault/<name>.vault, read in nVault's own layout - a magic number, a
// version, a count, then each entry's time, key and value.
//
// Included by module.cpp, after the client helpers.

struct StoredValue {
	std::string value;
	int64_t     time = 0;
};

struct Store {
	std::string name;
	std::string path;
	std::map<std::string, StoredValue> values;
	bool dirty = false;
};

static std::deque<Store> g_stores;
static float g_storesFlushed = 0;

/** AMX Mod X's data folder and `sub` in it, a full path. */
static std::string DataPath(const char *sub)
{
	std::string data = MF_GetLocalInfo("amxx_datadir", "addons/amxmodx/data");
	return MF_BuildPathname("%s/%s", data.c_str(), sub);
}

static std::string StoreFolder()
{
	return DataPath("amxts/storage");
}

/** Text as a JSON string, quoted. */
static void JsonQuote(std::string &out, const std::string &text)
{
	out += '"';
	for (unsigned char c : text) {
		switch (c) {
			case '"':  out += "\\\""; break;
			case '\\': out += "\\\\"; break;
			case '\n': out += "\\n"; break;
			case '\r': out += "\\r"; break;
			case '\t': out += "\\t"; break;
			default:
				if (c < 0x20) {
					char escaped[8];
					snprintf(escaped, sizeof(escaped), "\\u%04x", c);
					out += escaped;
				}
				else {
					out += (char)c;
				}
		}
	}
	out += '"';
}

/** A reader of the JSON the store writes: an object of keys to `[value, time]`. */
struct JsonReader {
	const std::string &text;
	size_t at = 0;
	bool ok = true;

	void Space()
	{
		while (at < text.size() && (unsigned char)text[at] <= ' ')
			at++;
	}

	bool Take(char c)
	{
		Space();
		if (at < text.size() && text[at] == c) {
			at++;
			return true;
		}
		return false;
	}

	std::string String()
	{
		std::string out;
		if (!Take('"')) {
			ok = false;
			return out;
		}
		while (at < text.size() && text[at] != '"') {
			char c = text[at++];
			if (c != '\\' || at >= text.size()) {
				out += c;
				continue;
			}
			char e = text[at++];
			switch (e) {
				case 'n': out += '\n'; break;
				case 'r': out += '\r'; break;
				case 't': out += '\t'; break;
				case 'b': out += '\b'; break;
				case 'f': out += '\f'; break;
				case 'u': {
					unsigned code = at + 4 <= text.size() ? (unsigned)strtoul(text.substr(at, 4).c_str(), NULL, 16) : 0;
					at += 4;
					// A code point as UTF-8; the store writes \u for control characters alone.
					if (code < 0x80) {
						out += (char)code;
					}
					else if (code < 0x800) {
						out += (char)(0xC0 | (code >> 6));
						out += (char)(0x80 | (code & 0x3F));
					}
					else {
						out += (char)(0xE0 | (code >> 12));
						out += (char)(0x80 | ((code >> 6) & 0x3F));
						out += (char)(0x80 | (code & 0x3F));
					}
					break;
				}
				default: out += e; break;
			}
		}
		if (!Take('"'))
			ok = false;
		return out;
	}

	int64_t Number()
	{
		Space();
		size_t start = at;
		while (at < text.size() && (isdigit((unsigned char)text[at]) || text[at] == '-'))
			at++;
		if (start == at)
			ok = false;
		return start < at ? strtoll(text.substr(start, at - start).c_str(), NULL, 10) : 0;
	}
};

static bool ReadFile(const std::string &path, std::string &out)
{
	FILE *file = fopen(path.c_str(), "rb");
	if (!file)
		return false;
	fseek(file, 0, SEEK_END);
	long size = ftell(file);
	fseek(file, 0, SEEK_SET);
	out.resize(size > 0 ? (size_t)size : 0);
	bool read = size <= 0 || fread(&out[0], 1, out.size(), file) == out.size();
	fclose(file);
	return read;
}

/** What AMX Mod X's nvault kept under `name`, once: its layout read, nothing of it copied. */
static void ImportVault(Store &store)
{
	std::string data = MF_GetLocalInfo("amxx_datadir", "addons/amxmodx/data");
	std::string file;
	if (!ReadFile(MF_BuildPathname("%s/vault/%s.vault", data.c_str(), store.name.c_str()), file))
		return;
	const unsigned char *p = (const unsigned char *)file.data();
	size_t size = file.size(), at = 0;
	auto u32 = [&](uint32_t &v) { if (at + 4 > size) return false; memcpy(&v, p + at, 4); at += 4; return true; };
	auto u16 = [&](uint16_t &v) { if (at + 2 > size) return false; memcpy(&v, p + at, 2); at += 2; return true; };
	uint32_t magic = 0, count = 0;
	uint16_t version = 0;
	if (!u32(magic) || magic != 0x6E564C54 || !u16(version) || !u32(count))
		return;
	for (uint32_t i = 0; i < count; i++) {
		uint32_t stamp = 0;
		uint16_t valueLength = 0;
		if (!u32(stamp) || at >= size)
			break;
		uint8_t keyLength = p[at++];
		if (!u16(valueLength) || at + keyLength + valueLength > size)
			break;
		StoredValue &v = store.values[std::string((const char *)p + at, keyLength)];
		v.value.assign((const char *)p + at + keyLength, valueLength);
		v.time = stamp;
		at += keyLength + valueLength;
	}
	store.dirty = !store.values.empty();
	if (store.dirty)
		MF_PrintSrvConsole("[amxts] storage %s: took %u entries from AMX Mod X's nvault (data/vault/%s.vault)\n", store.name.c_str(), (unsigned)store.values.size(), store.name.c_str());
}

static void LoadStore(Store &store)
{
	std::string text;
	if (!ReadFile(store.path, text)) {
		ImportVault(store);
		return;
	}
	JsonReader r{ text };
	if (!r.Take('{'))
		r.ok = false;
	bool first = true;
	while (r.ok && !r.Take('}')) {
		if (!first && !r.Take(','))
			r.ok = false;
		first = false;
		std::string key = r.String();
		if (!r.Take(':') || !r.Take('['))
			r.ok = false;
		StoredValue v;
		v.value = r.String();
		if (!r.Take(','))
			r.ok = false;
		v.time = r.Number();
		if (!r.Take(']'))
			r.ok = false;
		if (r.ok)
			store.values[key] = v;
	}
	if (!r.ok)
		MF_PrintSrvConsole("[amxts] storage %s: %s is not the storage's JSON - read as far as it is\n", store.name.c_str(), store.path.c_str());
}

/** Writes a store that changed: to a temporary file, then over the old one, so a crash leaves one or the other whole. */
static void SaveStore(Store &store)
{
	if (!store.dirty)
		return;
	store.dirty = false;
	std::string out = "{\n";
	bool first = true;
	for (const auto &entry : store.values) {
		out += first ? "\t" : ",\n\t";
		first = false;
		JsonQuote(out, entry.first);
		out += ": [";
		JsonQuote(out, entry.second.value);
		out += ", " + std::to_string((long long)entry.second.time) + "]";
	}
	out += "\n}\n";

	// The folders on the way, each named whole: a path through one not made yet does not resolve.
	std::string parent = DataPath("amxts"), folder = StoreFolder();
#ifdef _WIN32
	CreateDirectoryA(parent.c_str(), NULL);
	CreateDirectoryA(folder.c_str(), NULL);
#else
	mkdir(parent.c_str(), 0755);
	mkdir(folder.c_str(), 0755);
#endif
	std::string temporary = store.path + ".part";
	FILE *file = fopen(temporary.c_str(), "wb");
	if (!file || fwrite(out.data(), 1, out.size(), file) != out.size()) {
		if (file)
			fclose(file);
		MF_PrintSrvConsole("[amxts] storage %s: %s cannot be written\n", store.name.c_str(), store.path.c_str());
		return;
	}
	fclose(file);
#ifdef _WIN32
	MoveFileExA(temporary.c_str(), store.path.c_str(), MOVEFILE_REPLACE_EXISTING);
#else
	rename(temporary.c_str(), store.path.c_str());
#endif
}

/** Every store that changed written, at most once a second; `now` writes them at once (the map's end). */
static void FlushStores(bool now)
{
	if (!now && gpGlobals->time >= g_storesFlushed && gpGlobals->time < g_storesFlushed + 1.0f)
		return;
	g_storesFlushed = gpGlobals->time;
	for (Store &store : g_stores)
		SaveStore(store);
}

static Store *StoreOf(int32_t handle)
{
	return handle >= 0 && (size_t)handle < g_stores.size() ? &g_stores[handle] : NULL;
}

/** store_open(name) - the store of that name, loaded the first time; its handle, -1 for a name that is no file name. */
static int32_t w_storeOpen(wasm_exec_env_t env, int32_t name)
{
	std::string wanted = AsString(Inst(env), name);
	if (wanted.empty() || wanted.find_first_of("/\\:*?\"<>|") != std::string::npos)
		return -1;
	for (size_t i = 0; i < g_stores.size(); i++)
		if (g_stores[i].name == wanted)
			return (int32_t)i;
	g_stores.push_back(Store());
	Store &store = g_stores.back();
	store.name = wanted;
	store.path = StoreFolder() + "/" + wanted + ".json";
	LoadStore(store);
	return (int32_t)g_stores.size() - 1;
}

/** store_get(handle, key, out, max) - a value as UTF-8 and its whole length (more than max: ask again with room); -1 for none. */
static int32_t w_storeGet(wasm_exec_env_t env, int32_t handle, int32_t key, int32_t out, int32_t max)
{
	Store *store = StoreOf(handle);
	if (!store)
		return -1;
	auto found = store->values.find(AsString(Inst(env), key));
	if (found == store->values.end())
		return -1;
	const std::string &value = found->second.value;
	if ((int32_t)value.size() > max)
		return (int32_t)value.size();
	return WriteBytes(Inst(env), out, max, value.c_str());
}

/** store_set(handle, key, value) - sets a value, now its time. */
static void w_storeSet(wasm_exec_env_t env, int32_t handle, int32_t key, int32_t value)
{
	Store *store = StoreOf(handle);
	if (!store)
		return;
	StoredValue &v = store->values[AsString(Inst(env), key)];
	v.value = AsString(Inst(env), value);
	v.time = (int64_t)time(NULL);
	store->dirty = true;
}

/** store_delete(handle, key) - 1 when the key was there. */
static int32_t w_storeDelete(wasm_exec_env_t env, int32_t handle, int32_t key)
{
	Store *store = StoreOf(handle);
	if (!store || !store->values.erase(AsString(Inst(env), key)))
		return 0;
	store->dirty = true;
	return 1;
}

/** store_count(handle) - how many keys. */
static int32_t w_storeCount(wasm_exec_env_t env, int32_t handle)
{
	(void)env;
	Store *store = StoreOf(handle);
	return store ? (int32_t)store->values.size() : 0;
}

/** store_keys(handle, out, max) - every key, each ended by a zero byte; their whole length (more than max: ask again with room). */
static int32_t w_storeKeys(wasm_exec_env_t env, int32_t handle, int32_t out, int32_t max)
{
	Store *store = StoreOf(handle);
	if (!store)
		return 0;
	std::string keys;
	for (const auto &entry : store->values) {
		keys += entry.first;
		keys += '\0';
	}
	if ((int32_t)keys.size() > max)
		return (int32_t)keys.size();
	wasm_module_inst_t inst = Inst(env);
	if (!keys.empty() && !wasm_runtime_validate_app_addr(inst, (uint64_t)out, (uint64_t)keys.size()))
		return 0;
	if (!keys.empty())
		memcpy(wasm_runtime_addr_app_to_native(inst, (uint64_t)out), keys.data(), keys.size());
	return (int32_t)keys.size();
}

/** store_prune(handle, before) - removes what was set before that moment (seconds since 1970); how many went. */
static int32_t w_storePrune(wasm_exec_env_t env, int32_t handle, double before)
{
	(void)env;
	Store *store = StoreOf(handle);
	if (!store)
		return 0;
	int32_t removed = 0;
	for (auto it = store->values.begin(); it != store->values.end();) {
		if ((double)it->second.time < before) {
			it = store->values.erase(it);
			removed++;
		}
		else {
			++it;
		}
	}
	store->dirty = store->dirty || removed > 0;
	return removed;
}
