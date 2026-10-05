#!/bin/sh
# Builds the Linux half of amxts inside the amxts-build image
# (scripts/build-linux.ts runs it):
#
#   /src    the repository, read-only - runtime/ with the generated
#           natives.h and embedded.h (`bun run generate` first) and the
#           compiled host plugin, host.h (`bun run host`)
#   /work   the checkouts and build folders, kept between runs
#   /out    what comes out: amxts_amxx_i386.so and wamrc
#
# SANITIZE=1 builds the module under AddressSanitizer and UBSan instead, in a
# build folder of its own, and puts the 32-bit runtimes it links against
# (libasan.so.4, libubsan.so.0) beside it: the test server preloads them.
#
# WAMR is cloned at the tag the patch is for and patched here, as
# CONTRIBUTING.md does it on Windows; the module and wamrc come
# from that one checkout. The AMX Mod X SDK is pinned to a commit.
set -eu

WAMR_TAG=WAMR-2.4.5
AMXX_COMMIT=${AMXX_COMMIT:-$(cat /src/docker/build/amxmodx.commit)}
JOBS=${JOBS:-2}
SANITIZE=${SANITIZE:-}

# /work may hold checkouts made by another user - CI restores it from its
# cache as the runner's user, while this runs as root - and git refuses a
# repository it does not own unless told it is safe.
git config --global --add safe.directory '*'

cd /work

if [ ! -d wamr/.git ]; then
	git clone -q --depth 1 --branch "$WAMR_TAG" https://github.com/bytecodealliance/wasm-micro-runtime wamr
fi
# Patched afresh every run: the patch in the repository is the truth.
git -C wamr checkout -q -- .
git -C wamr apply /src/runtime/patches/wamr-2.4.5-amxts.patch

if [ ! -d amxmodx/.git ] || [ "$(git -C amxmodx rev-parse HEAD)" != "$AMXX_COMMIT" ]; then
	rm -rf amxmodx
	git init -q amxmodx
	git -C amxmodx fetch -q --depth 1 https://github.com/alliedmodders/amxmodx "$AMXX_COMMIT"
	git -C amxmodx checkout -q FETCH_HEAD
fi

echo "== wamrc"
# glibc stays dynamic, everything else goes in: the server that runs this
# may not have the libtinfo or libstdc++ this image has.
cmake -S wamr/wamr-compiler -B build-wamrc -DCMAKE_BUILD_TYPE=Release \
	-DWAMR_BUILD_WITH_CUSTOM_LLVM=1 -DLLVM_DIR="$LLVM_DIR" \
	"-DCMAKE_EXE_LINKER_FLAGS=-Wl,--as-needed -static-libstdc++ -static-libgcc" \
	-DZLIB_LIBRARY=/usr/lib/x86_64-linux-gnu/libz.a \
	-DTerminfo_LIBRARIES=/usr/lib/x86_64-linux-gnu/libtinfo.a > /dev/null
cmake --build build-wamrc -j "$JOBS" -- --no-print-directory 2>&1 | grep -E "error|Error" || true
test -x build-wamrc/wamrc

echo "== amxts_amxx_i386.so${SANITIZE:+ (sanitized)}"
# Sanitized: the module's own C++ only (module.cpp and the SDK's
# amxxmodule.cpp) - WAMR and the network libraries are C and stay as they are.
# Not UBSan's vptr check: the module's typeinfo is its own (hidden, static
# libstdc++), so every call on an AMX Mod X object, IGameConfig's, would fail it.
module=build-module
flags=
if [ -n "$SANITIZE" ]; then
	module=build-module-sanitize
	flags="-fsanitize=address,undefined -fno-sanitize=vptr -fno-omit-frame-pointer -g"
fi
cmake -S /src/runtime -B "$module" -DCMAKE_BUILD_TYPE=Release \
	-DAMXX=/work/amxmodx -DWAMR_ROOT_DIR=/work/wamr \
	"-DCMAKE_CXX_FLAGS=$flags" "-DCMAKE_SHARED_LINKER_FLAGS=$flags" > /dev/null
cmake --build "$module" -j "$JOBS" -- --no-print-directory 2>&1 | grep -E "error|Error" || true
test -f "$module/amxts_amxx_i386.so"

cp -L build-wamrc/wamrc /out/wamrc
cp "$module/amxts_amxx_i386.so" /out/amxts_amxx_i386.so
chmod 755 /out/wamrc /out/amxts_amxx_i386.so
if [ -n "$SANITIZE" ]; then
	cp -L /usr/lib32/libasan.so.4 /usr/lib32/libubsan.so.0 /out/
	# The server opens libraries with RTLD_DEEPBIND: one opened so frees with
	# libc's free what ASan's malloc gave it, and the server stops on the
	# first map. Preloaded after ASan, this opens every library without it.
	cat > nodeepbind.c <<-'EOF'
	#define _GNU_SOURCE
	#include <dlfcn.h>
	void *dlopen(const char *file, int flags) {
		static void *(*next)(const char *, int);
		if (!next) next = (void *(*)(const char *, int))dlsym(RTLD_NEXT, "dlopen");
		return next(file, flags & ~RTLD_DEEPBIND);
	}
	EOF
	gcc -m32 -shared -fPIC -O2 -o /out/libnodeepbind.so nodeepbind.c -ldl
fi

# What a server needs: glibc 2.17 or newer for the module, 2.27 for wamrc.
echo "== done"
for file in /out/amxts_amxx_i386.so /out/wamrc; do
	glibc=$(objdump -T "$file" | grep -oE 'GLIBC_[0-9.]+' | sort -Vu | tail -1)
	echo "$(basename "$file") $(stat -c %s "$file") bytes, needs $glibc"
done
