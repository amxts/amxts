// A failed call's stack, in the plugin's TypeScript.
//
// wamrc compiles a plugin with WAMR's small frames (scripts/compile.ts,
// STACK_FLAGS): each function's frame keeps its wasm index and the byte
// offset of the call it is in - of the trap, for the frame that trapped. The
// plugin carries the way back to its source inside the .aot, the custom
// section `amxts.map` (scripts/source-map.ts): the files, the functions'
// names by index, and the source map's mappings from an offset to a file,
// line and column. Nothing of this runs until an error is printed: a trap's
// frames are kept by WAMR (wasm_runtime_take_trap_frames, the WAMR patch), an
// abort's - a `throw` nobody catches, `x!` on null - by w_abort while they
// are live, an Error's by stack_frames when it is made; the map is read
// when they are put into words.
//
//   [amxts] myplugin: TypeError: Cannot read properties of null
//       at buyItem (plugins/myplugin/shop.ts:42:5)
//         42 |   const price = item!.price;
//       at onSelect (plugins/myplugin/shop.ts:88:7)
//
// The source line is shown for the first frame of the author's own code -
// not under node_modules/ - when its file is found: in the project's folder a
// dev build names, or beside the plugin - in a folder above the .ts or the
// .aot, the links followed. A plugin without a map prints the message alone.

#define STACK_SECTION "amxts.map"
#define STACK_DEPTH   64     // frames read of a failed call
#define STACK_SHOWN   16     // calls a stack names

/** A plugin's map, read from its section. */
struct StackMap {
	std::string              root;
	std::vector<std::string> files;
	uint32_t                 first;
	std::vector<std::string> functions;
	std::string              mappings;
};

/** A frame: the function's wasm index, and the offset of its call or trap. */
struct StackFrame {
	uint32_t func;
	uint32_t offset;
};

/** The map a plugin carries; false when it has none. */
static bool ReadStackMap(wasm_module_t module, StackMap &map)
{
	uint32_t length = 0;
	const uint8_t *section = module ? wasm_runtime_get_custom_section(module, STACK_SECTION, &length) : NULL;
	if (!section)
		return false;

	std::vector<std::string> lines;
	const char *at = (const char *)section, *end = at + length;
	while (at < end) {
		const char *eol = (const char *)memchr(at, '\n', end - at);
		if (!eol) eol = end;
		lines.push_back(std::string(at, eol));
		at = eol + 1;
	}

	unsigned files = 0, first = 0, count = 0;
	if (lines.size() < 3 || lines[0] != "amxts-map 1" || lines[1].compare(0, 5, "root ") != 0
	    || sscanf(lines[2].c_str(), "files %u", &files) != 1 || lines.size() < 6 + (size_t)files
	    || sscanf(lines[3 + files].c_str(), "functions %u %u", &first, &count) != 2
	    || lines.size() < 6 + (size_t)files + count)
		return false;

	map.root = lines[1].substr(5);
	map.files.assign(lines.begin() + 3, lines.begin() + 3 + files);
	map.first = first;
	map.functions.assign(lines.begin() + 4 + files, lines.begin() + 4 + files + count);
	map.mappings = lines[5 + files + count];
	return true;
}

/** A place in the TypeScript; file -1 for none. */
struct StackPlace {
	int file, line, column;
};

/**
 * Where the code at `offset` came from: the last mapping at or before it.
 * The mappings are a source map's - base64 VLQ, each field relative to the
 * one before it - with the column a byte offset into the wasm.
 */
static StackPlace PlaceOf(const StackMap &map, uint32_t offset)
{
	static const char digits[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	StackPlace found = { -1, 0, 0 };
	int32_t state[4] = { 0, 0, 0, 0 };
	const char *at = map.mappings.c_str();

	while (*at) {
		int fields = 0;
		int32_t value = 0, shift = 0;
		for (; *at && *at != ',' && *at != ';'; at++) {
			const char *digit = strchr(digits, *at);
			if (!digit) return found;
			int32_t bits = (int32_t)(digit - digits);
			value += (bits & 31) << shift;
			if (bits & 32) {
				shift += 5;
				continue;
			}
			if (fields < 4) state[fields] += value & 1 ? -(value >> 1) : value >> 1;
			fields++;
			value = 0;
			shift = 0;
		}
		if (*at) at++;
		if ((uint32_t)state[0] > offset)
			break;
		if (fields >= 4 && state[1] >= 0 && (size_t)state[1] < map.files.size()) {
			StackPlace place = { state[1], state[2] + 1, state[3] + 1 };
			found = place;
		}
		else if (fields == 1) {
			found.file = -1;
		}
	}
	return found;
}

/** The folder a path is in; empty at the top. */
static std::string FolderOf(const std::string &path)
{
	size_t slash = path.find_last_of("/\\");
	return slash == std::string::npos ? std::string() : path.substr(0, slash);
}

/** A path with its links followed, made absolute. */
static std::string RealPath(const std::string &path)
{
#ifdef _WIN32
	char *real = _fullpath(NULL, path.c_str(), 0);
#else
	char *real = realpath(path.c_str(), NULL);
#endif
	std::string out = real ? real : path;
	free(real);
	return out;
}

/** Line `line` of `path` - tabs as two spaces, cut at 160 characters; false when there is none. */
static bool ReadLine(const std::string &path, int line, std::string &text)
{
	FILE *f = fopen(path.c_str(), "rb");
	if (!f)
		return false;
	int at = 1, c;
	text.clear();
	while ((c = fgetc(f)) != EOF) {
		if (c == '\n') {
			if (at == line) break;
			at++;
			continue;
		}
		if (at == line && c != '\r' && text.size() < 160)
			text += c == '\t' ? std::string("  ") : std::string(1, (char)c);
	}
	fclose(f);
	return at == line;
}

/**
 * The source line of a place, from the first copy of its file found: in the
 * project's folder the map names, else in a folder above the plugin's .ts or
 * .aot.
 */
static bool SourceLine(const Plugin &p, const StackMap &map, const std::string &file, int line, std::string &text)
{
	std::vector<std::string> folders;
	if (!map.root.empty())
		folders.push_back(map.root);
	const std::string plugin = RealPath(p.source.empty() ? p.path : p.source);
	for (std::string folder = FolderOf(plugin); !folder.empty(); folder = FolderOf(folder))
		folders.push_back(folder);

	for (size_t i = 0; i < folders.size(); i++)
		if (ReadLine(folders[i] + "/" + file, line, text))
			return true;
	return false;
}

/**
 * `frames`, innermost first, as the lines of a stack - nothing without a
 * map. The host's own functions (imports) are passed over, and so is every
 * frame above the last of the hood's error handling (an empty name): the
 * frame below it is where the error was made.
 */
static std::vector<std::string> StackLines(const Plugin &p, const StackFrame *frames, uint32_t count)
{
	std::vector<std::string> lines;
	StackMap map;
	if (!count || !ReadStackMap(p.module, map))
		return lines;

	uint32_t from = 0;
	for (uint32_t i = 0; i < count; i++)
		if (frames[i].func >= map.first && frames[i].func - map.first < map.functions.size()
		    && map.functions[frames[i].func - map.first].empty())
			from = i + 1;

	bool shownSource = false;
	char buffer[64];
	for (uint32_t i = from; i < count && lines.size() < STACK_SHOWN; i++) {
		if (frames[i].func < map.first)
			continue;
		uint32_t at = frames[i].func - map.first;
		std::string name;
		if (at < map.functions.size()) {
			name = map.functions[at];
		}
		else {
			snprintf(buffer, sizeof(buffer), "wasm-function[%u]", frames[i].func);
			name = buffer;
		}

		StackPlace place = PlaceOf(map, frames[i].offset);
		if (place.file < 0) {
			lines.push_back("    at " + name);
			continue;
		}
		const std::string &file = map.files[place.file];
		snprintf(buffer, sizeof(buffer), ":%d:%d)", place.line, place.column);
		lines.push_back("    at " + name + " (" + file + buffer);

		std::string source;
		if (!shownSource && file.compare(0, 13, "node_modules/") != 0 && SourceLine(p, map, file, place.line, source)) {
			snprintf(buffer, sizeof(buffer), "      %d | ", place.line);
			lines.push_back(buffer + source);
			shownSource = true;
		}
	}
	return lines;
}

// What an abort said, and the frames it left - live while it ran, unlike a
// trap's: the call it ends is reported next (Failed).
static std::string             g_abortText;
static std::string             g_abortWhere;
static std::vector<StackFrame> g_abortFrames;
static bool                    g_aborted = false;

/** The frames of the call running in `env` now, innermost first. */
static std::vector<StackFrame> LiveFrames(wasm_exec_env_t env, uint32_t max)
{
	std::vector<WASMCApiFrame> buffer(max);
	char err[128];
	uint32_t count = wasm_copy_callstack(env, &buffer[0], max, 0, err, sizeof(err));
	std::vector<StackFrame> frames;
	for (uint32_t i = 0; i < count; i++) {
		StackFrame frame = { buffer[i].func_index, buffer[i].func_offset };
		frames.push_back(frame);
	}
	return frames;
}

/**
 * abort(message, file, line, column) - AssemblyScript's own.
 *
 * It is what a `throw` nobody catches, an out-of-range index, a null
 * dereference or a failed assertion ends in. The call ends with it rather
 * than the server - WAMR's exception is set, and whoever made the call
 * reports it (Failed) with the message and the frames kept here.
 */
static void w_abort(wasm_exec_env_t env, int32_t msg, int32_t file, int32_t line, int32_t column)
{
	wasm_module_inst_t inst = Inst(env);

	std::string text = msg ? AsString(inst, msg) : "";
	std::string where = file ? AsString(inst, file) : "?";
	char place[32];
	snprintf(place, sizeof(place), ":%d:%d", line, column);

	g_abortText = text.empty() ? "assertion failed" : text;
	g_abortWhere = where + place;
	g_abortFrames = LiveFrames(env, STACK_DEPTH);
	g_aborted = true;

	wasm_runtime_set_exception(inst, "aborted");
}

/** A failed call: what it said, and its stack a call a line. */
struct Failure {
	std::string              message;
	std::vector<std::string> lines;
};

/**
 * What the failed call of the plugin at `index` left: `ex` is the exception
 * - WAMR's, or what instantiating said. A trap's message is WAMR's, as a
 * WebAssembly RuntimeError; an abort's its own, with its place when there is
 * no stack to show it. The exception of `inst` is cleared, and what the
 * abort kept.
 */
static Failure TakeFailure(int index, wasm_module_inst_t inst, const char *ex)
{
	bool aborted = g_aborted && ex && strcmp(ex, "Exception: aborted") == 0;

	std::vector<StackFrame> frames;
	if (aborted) {
		frames = g_abortFrames;
	}
	else if (inst) {
		WASMCApiFrame buffer[STACK_DEPTH];
		uint32_t count = wasm_runtime_take_trap_frames(inst, buffer, STACK_DEPTH);
		for (uint32_t i = 0; i < count; i++) {
			StackFrame frame = { buffer[i].func_index, buffer[i].func_offset };
			frames.push_back(frame);
		}
	}

	Failure failure;
	if (aborted)
		failure.message = g_abortText;
	else if (ex && strncmp(ex, "Exception: ", 11) == 0)
		failure.message = std::string("RuntimeError: ") + (ex + 11);
	else
		failure.message = ex ? ex : "call failed";

	if (index >= 0 && (size_t)index < g_plugins.size())
		failure.lines = StackLines(g_plugins[index], frames.empty() ? NULL : &frames[0], (uint32_t)frames.size());
	if (aborted && failure.lines.empty())
		failure.message += " (" + g_abortWhere + ")";

	if (inst)
		wasm_runtime_clear_exception(inst);
	g_aborted = false;
	g_abortFrames.clear();
	return failure;
}

/** A failure on the console: "[amxts] name: message<context>", then its stack. */
static void PrintFailure(int index, const Failure &failure, const char *context = "")
{
	MF_PrintSrvConsole("[amxts] %s: %s%s\n", PluginName(index), failure.message.c_str(), context);
	for (size_t i = 0; i < failure.lines.size(); i++)
		MF_PrintSrvConsole("%s\n", failure.lines[i].c_str());
}

/** The failed call of the plugin at `index`, in `inst`, on the console. */
static void Failed(int index, wasm_module_inst_t inst, const char *context = "")
{
	PrintFailure(index, TakeFailure(index, inst, wasm_runtime_get_exception(inst)), context);
}

/**
 * stack_frames(out, max): the frames of the running call - the plugin's own
 * functions' index and offset, two cells each - for an Error being made
 * (as/facade.ts, ModuleStack); how many.
 */
static int32_t w_stack_frames(wasm_exec_env_t env, int32_t out, int32_t max)
{
	wasm_module_inst_t inst = Inst(env);
	if (max <= 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)out, (uint64_t)max * 8))
		return 0;

	// The hood's own call on top - this import, and the function that called
	// it, whatever the optimiser inlined into it - is not where the error was made.
	wasm_module_t module = wasm_runtime_get_module(inst);
	uint32_t imports = 0;
	for (int32_t i = 0, n = wasm_runtime_get_import_count(module); i < n; i++) {
		wasm_import_t import;
		wasm_runtime_get_import_type(module, i, &import);
		if (import.kind == WASM_IMPORT_EXPORT_KIND_FUNC)
			imports++;
	}
	std::vector<StackFrame> frames = LiveFrames(env, (uint32_t)max + 2);
	size_t from = 0;
	while (from < frames.size() && frames[from].func < imports)
		from++;
	from++;

	uint32_t *cells = (uint32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)out);
	int32_t count = 0;
	for (size_t i = from; i < frames.size() && count < max; i++, count++) {
		cells[count * 2] = frames[i].func;
		cells[count * 2 + 1] = frames[i].offset;
	}
	return count;
}

/**
 * stack_text(frames, count, out, max): frames stack_frames kept, as the
 * lines of a stack - UTF-8, up to `max` bytes at `out`; their length.
 */
static int32_t w_stack_text(wasm_exec_env_t env, int32_t at, int32_t count, int32_t out, int32_t max)
{
	wasm_module_inst_t inst = Inst(env);
	int index = PluginOf(inst);
	if (count <= 0 || index < 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)at, (uint64_t)count * 8))
		return 0;

	const uint32_t *cells = (const uint32_t *)wasm_runtime_addr_app_to_native(inst, (uint64_t)at);
	std::vector<StackFrame> frames;
	for (int32_t i = 0; i < count; i++) {
		StackFrame frame = { cells[i * 2], cells[i * 2 + 1] };
		frames.push_back(frame);
	}
	std::vector<std::string> lines = StackLines(g_plugins[index], &frames[0], (uint32_t)frames.size());
	std::string text;
	for (size_t i = 0; i < lines.size(); i++)
		text += (i ? "\n" : "") + lines[i];
	int32_t length = CopyText(inst, text, out, max);
	return length < max ? length : max;
}
