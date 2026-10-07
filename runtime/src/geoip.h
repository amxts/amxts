// A player's country, read by the module from the MaxMind database AMX Mod X's
// geoip module reads - GeoLite2-Country.mmdb (or -City) in AMX Mod X's data
// folder - with no module of AMX Mod X in the way. The file's format is
// MaxMind's open "MaxMind DB" format: a binary search tree over the address's
// bits, then a data section of typed values, then the metadata. Only what a
// country needs is read: an IPv4 address's record, its country's ISO code and
// English name.
//
// Included by module.cpp, after the client helpers.

/** The database, read whole the first time it is asked; empty when there is none. */
struct GeoDatabase {
	std::vector<unsigned char> file;
	uint32_t nodes = 0;
	int      recordSize = 0;
	bool     ipv6 = false;
	size_t   tree = 0;     // the tree's size in bytes
	size_t   data = 0;     // where the data section starts
	uint32_t ipv4Start = 0;
	bool     asked = false;
};

static GeoDatabase g_geo;

// The value types of the format's data section.
enum GeoType { GEO_POINTER = 1, GEO_STRING = 2, GEO_DOUBLE = 3, GEO_BYTES = 4, GEO_UINT16 = 5, GEO_UINT32 = 6,
	GEO_MAP = 7, GEO_INT32 = 8, GEO_UINT64 = 9, GEO_UINT128 = 10, GEO_ARRAY = 11, GEO_BOOLEAN = 14, GEO_FLOAT = 15 };

/** A value's header in the data section at `at`: its type and size, and where its payload starts. */
struct GeoValue {
	int    type = 0;
	size_t size = 0;
	size_t payload = 0;
	bool   ok = false;
};

static uint32_t GeoNumber(const unsigned char *p, size_t n)
{
	uint32_t value = 0;
	for (size_t i = 0; i < n; i++)
		value = (value << 8) | p[i];
	return value;
}

/** Where the value at `at` is: there, or where the pointer there points, `base` being where pointers count from. */
static size_t GeoResolve(size_t base, size_t at)
{
	const std::vector<unsigned char> &f = g_geo.file;
	if (at >= f.size() || (f[at] >> 5) != GEO_POINTER)
		return at;
	unsigned char control = f[at];
	int ss = (control >> 3) & 3;
	uint32_t vvv = control & 7;
	static const uint32_t extra[4] = { 0, 2048, 526336, 0 };
	size_t bytes = ss + 1;
	if (at + 1 + bytes > f.size())
		return f.size();
	uint32_t pointer = ss == 3 ? GeoNumber(&f[at + 1], 4) : ((vvv << (8 * bytes)) | GeoNumber(&f[at + 1], bytes)) + extra[ss];
	return base + pointer;
}

/** The header of the value at `at`, a pointer followed: its type and size, and where its payload starts. */
static GeoValue GeoRead(size_t base, size_t at)
{
	GeoValue v;
	const std::vector<unsigned char> &f = g_geo.file;
	at = GeoResolve(base, at);
	if (at >= f.size())
		return v;
	unsigned char control = f[at++];
	int type = control >> 5;
	if (type == GEO_POINTER)
		return v;
	if (type == 0) {
		if (at >= f.size())
			return v;
		type = 7 + f[at++];
	}
	size_t size = control & 0x1f;
	if (size >= 29) {
		size_t bytes = size - 28;
		if (at + bytes > f.size())
			return v;
		size = (size == 29 ? 29 : size == 30 ? 285 : 65821) + GeoNumber(&f[at], bytes);
		at += bytes;
	}
	v.type = type;
	v.size = size;
	v.payload = at;
	v.ok = true;
	return v;
}

/** Where the value at `at` ends: a map's and an array's members walked, a pointer two to five bytes. */
static size_t GeoSkip(size_t base, size_t at, int depth = 0)
{
	const std::vector<unsigned char> &f = g_geo.file;
	if (at >= f.size() || depth > 32)
		return f.size();
	if ((f[at] >> 5) == GEO_POINTER)
		return at + 2 + ((f[at] >> 3) & 3);
	GeoValue v = GeoRead(base, at);
	if (!v.ok)
		return f.size();
	size_t end = v.payload;
	switch (v.type) {
		case GEO_MAP:
			for (size_t i = 0; i < v.size; i++)
				end = GeoSkip(base, GeoSkip(base, end, depth + 1), depth + 1);
			return end;
		case GEO_ARRAY:
			for (size_t i = 0; i < v.size; i++)
				end = GeoSkip(base, end, depth + 1);
			return end;
		case GEO_BOOLEAN:
			return end;
		default:
			return end + v.size;
	}
}

static std::string GeoText(const GeoValue &v)
{
	return v.ok && v.type == GEO_STRING && v.payload + v.size <= g_geo.file.size() ? std::string((const char *)&g_geo.file[v.payload], v.size) : "";
}

/** Where the value under `key` of the map at `at` is, a pointer followed; 0 when there is none. */
static size_t GeoMember(size_t base, size_t at, const char *key)
{
	GeoValue map = GeoRead(base, at);
	if (!map.ok || map.type != GEO_MAP)
		return 0;
	size_t cursor = map.payload;
	for (size_t i = 0; i < map.size && cursor < g_geo.file.size(); i++) {
		std::string name = GeoText(GeoRead(base, cursor));
		size_t value = GeoSkip(base, cursor);
		if (name == key)
			return GeoResolve(base, value);
		cursor = GeoSkip(base, value);
	}
	return 0;
}

/** An unsigned number member of the map at `at`; 0 when there is none. */
static uint32_t GeoUnsigned(size_t base, size_t at, const char *key)
{
	size_t member = GeoMember(base, at, key);
	GeoValue v = member ? GeoRead(base, member) : GeoValue();
	return v.ok && v.size <= 4 && (v.type == GEO_UINT16 || v.type == GEO_UINT32) ? GeoNumber(&g_geo.file[v.payload], v.size) : 0;
}

static uint32_t GeoRecord(uint32_t node, int side)
{
	const unsigned char *p = &g_geo.file[(size_t)node * g_geo.recordSize / 4];
	switch (g_geo.recordSize) {
		case 24: return GeoNumber(p + side * 3, 3);
		case 28: return side == 0 ? (((uint32_t)(p[3] & 0xF0)) << 20) | GeoNumber(p, 3) : (((uint32_t)(p[3] & 0x0F)) << 24) | GeoNumber(p + 4, 3);
		default: return GeoNumber(p + side * 4, 4);
	}
}

/** Opens the database the first time: AMX Mod X's data folder's GeoLite2-Country.mmdb, else GeoLite2-City.mmdb. */
static bool GeoOpen()
{
	if (g_geo.asked)
		return !g_geo.file.empty();
	g_geo.asked = true;

	std::string folder = MF_GetLocalInfo("amxx_datadir", "addons/amxmodx/data");
	for (const char *name : { "GeoLite2-Country.mmdb", "GeoLite2-City.mmdb" }) {
		FILE *file = fopen(MF_BuildPathname("%s/%s", folder.c_str(), name), "rb");
		if (!file)
			continue;
		fseek(file, 0, SEEK_END);
		g_geo.file.resize((size_t)ftell(file));
		fseek(file, 0, SEEK_SET);
		bool read = !g_geo.file.empty() && fread(&g_geo.file[0], 1, g_geo.file.size(), file) == g_geo.file.size();
		fclose(file);
		if (read)
			break;
		g_geo.file.clear();
	}
	if (g_geo.file.empty()) {
		MF_PrintSrvConsole("[amxts] no GeoLite2-Country.mmdb in AMX Mod X's data folder: player.country is null\n");
		return false;
	}

	// The metadata: after the last "\xAB\xCD\xEFMaxMind.com", a map.
	static const char marker[] = "\xAB\xCD\xEF" "MaxMind.com";
	const std::vector<unsigned char> &f = g_geo.file;
	size_t meta = 0;
	for (size_t i = f.size() >= 14 ? f.size() - 14 : 0; i > 0 && !meta; i--)
		if (!memcmp(&f[i], marker, 14))
			meta = i + 14;
	g_geo.nodes = meta ? GeoUnsigned(meta, meta, "node_count") : 0;
	g_geo.recordSize = meta ? (int)GeoUnsigned(meta, meta, "record_size") : 0;
	g_geo.ipv6 = meta && GeoUnsigned(meta, meta, "ip_version") == 6;
	size_t tree = (size_t)g_geo.nodes * g_geo.recordSize / 4;
	if (!g_geo.nodes || (g_geo.recordSize != 24 && g_geo.recordSize != 28 && g_geo.recordSize != 32) || tree + 16 >= f.size()) {
		MF_PrintSrvConsole("[amxts] the GeoIP database is not a MaxMind DB file: player.country is null\n");
		g_geo.file.clear();
		return false;
	}
	g_geo.tree = tree;
	g_geo.data = tree + 16;

	// An IPv4 address in an IPv6 tree is ::a.b.c.d: 96 zero bits first.
	uint32_t node = 0;
	for (int i = 0; g_geo.ipv6 && i < 96 && node < g_geo.nodes; i++)
		node = GeoRecord(node, 0);
	g_geo.ipv4Start = node;
	return true;
}

#define GEO_CODE 1
#define GEO_NAME 2

/** An IPv4 address's country: its ISO code or its English name; "" when the database has none for it. */
static std::string GeoCountry(const char *ip, int what)
{
	unsigned a, b, c, d;
	if (!ip || sscanf(ip, "%u.%u.%u.%u", &a, &b, &c, &d) != 4 || a > 255 || b > 255 || c > 255 || d > 255 || !GeoOpen())
		return "";
	uint32_t address = (a << 24) | (b << 16) | (c << 8) | d;
	uint32_t node = g_geo.ipv4Start;
	for (int bit = 31; bit >= 0 && node < g_geo.nodes; bit--)
		node = GeoRecord(node, (address >> bit) & 1);
	if (node <= g_geo.nodes)
		return "";
	size_t record = g_geo.data + (node - g_geo.nodes - 16);
	if (record >= g_geo.file.size())
		return "";

	size_t country = GeoMember(g_geo.data, record, "country");
	if (!country)
		return "";
	if (what == GEO_CODE)
		return GeoText(GeoRead(g_geo.data, GeoMember(g_geo.data, country, "iso_code")));
	size_t names = GeoMember(g_geo.data, country, "names");
	size_t english = names ? GeoMember(g_geo.data, names, "en") : 0;
	return english ? GeoText(GeoRead(g_geo.data, english)) : "";
}

/** geo_country(ip, what, out, max) - an address's country, its ISO code or name, as UTF-8; -1 when it has none. */
static int32_t w_geoCountry(wasm_exec_env_t env, int32_t ip, int32_t what, int32_t out, int32_t max)
{
	std::string country = GeoCountry(AsString(Inst(env), ip).c_str(), what);
	return country.empty() ? -1 : WriteBytes(Inst(env), out, max, country.c_str());
}
