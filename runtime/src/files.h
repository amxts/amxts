// Files as bytes, for @amxts/core/fs: fs_read, fs_write and zip_inflate.
//
// A text file goes through AMX Mod X's file natives; bytes come here, read and
// written whole with the C library, a .bsp of megabytes in one call. A path is
// one of the game folder, and one that would leave it is refused (GamePath).
// zip_inflate is zlib's raw inflate - AMX Mod X's copy, built in by
// CMakeLists.txt - for unzip, which reads the archive itself.

#include "zlib.h"

/**
 * A path of the game folder (`maps/de_dust2.bsp`), as @amxts/core/fs takes
 * one, made absolute - or "" when it would leave the folder: an absolute
 * path, a drive, or a `..` among its parts.
 */
static std::string GamePath(const std::string &path)
{
	if (path.empty() || path[0] == '/' || path[0] == '\\' || path.find(':') != std::string::npos)
		return "";
	for (size_t start = 0;;) {
		size_t end = path.find_first_of("/\\", start);
		if (path.compare(start, end == std::string::npos ? std::string::npos : end - start, "..") == 0)
			return "";
		if (end == std::string::npos)
			break;
		start = end + 1;
	}
	return MF_BuildPathname("%s", path.c_str());
}

// fs_read(path, out, max) - a file's bytes: its size, `max` bytes of it copied
// to `out`; -1 when it cannot be opened or the path leaves the game folder.
static int32_t w_fs_read(wasm_exec_env_t env, int32_t name, int32_t out, int32_t max)
{
	std::string path = GamePath(AsString(Inst(env), name));
	FILE *file = path.empty() ? NULL : fopen(path.c_str(), "rb");
	if (!file)
		return -1;

	fseek(file, 0, SEEK_END);
	long size = ftell(file);
	int32_t copied = size < max ? (int32_t)size : max;
	if (out > 0 && copied > 0 && wasm_runtime_validate_app_addr(Inst(env), (uint64_t)out, (uint64_t)copied)) {
		fseek(file, 0, SEEK_SET);
		copied = (int32_t)fread(wasm_runtime_addr_app_to_native(Inst(env), (uint64_t)out), 1, (size_t)copied, file);
	}
	fclose(file);
	return (int32_t)size;
}

// fs_write(path, data, length, append) - writes bytes to a file, replacing it
// or at its end: 1, or 0 when it cannot be written or the path leaves the
// game folder.
static int32_t w_fs_write(wasm_exec_env_t env, int32_t name, int32_t data, int32_t length, int32_t append)
{
	wasm_module_inst_t inst = Inst(env);
	if (length < 0 || (length > 0 && !wasm_runtime_validate_app_addr(inst, (uint64_t)data, (uint64_t)length)))
		return 0;
	std::string path = GamePath(AsString(inst, name));
	FILE *file = path.empty() ? NULL : fopen(path.c_str(), append ? "ab" : "wb");
	if (!file)
		return 0;

	size_t written = length ? fwrite(wasm_runtime_addr_app_to_native(inst, (uint64_t)data), 1, (size_t)length, file) : 0;
	return fclose(file) == 0 && written == (size_t)length ? 1 : 0;
}

// zip_inflate(data, length, out, max) - raw deflate data, as a zip entry holds
// it, inflated into `out`: the bytes written, or -1 when the data is not
// whole deflate data or does not fit in `max`.
static int32_t w_zip_inflate(wasm_exec_env_t env, int32_t data, int32_t length, int32_t out, int32_t max)
{
	wasm_module_inst_t inst = Inst(env);
	if (length <= 0 || max < 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)data, (uint64_t)length)
	    || (max > 0 && !wasm_runtime_validate_app_addr(inst, (uint64_t)out, (uint64_t)max)))
		return -1;

	z_stream stream;
	memset(&stream, 0, sizeof(stream));
	// Negative window bits: raw deflate, with no zlib header around it.
	if (inflateInit2(&stream, -MAX_WBITS) != Z_OK)
		return -1;
	stream.next_in = (Bytef *)wasm_runtime_addr_app_to_native(inst, (uint64_t)data);
	stream.avail_in = (uInt)length;
	stream.next_out = max > 0 ? (Bytef *)wasm_runtime_addr_app_to_native(inst, (uint64_t)out) : NULL;
	stream.avail_out = (uInt)max;
	int result = inflate(&stream, Z_FINISH);
	int32_t written = max - (int32_t)stream.avail_out;
	inflateEnd(&stream);
	return result == Z_STREAM_END ? written : -1;
}
