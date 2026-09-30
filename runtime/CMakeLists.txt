cmake_minimum_required(VERSION 3.20)
project(amxts_runtime CXX C)

set(AMXX "${CMAKE_CURRENT_SOURCE_DIR}/deps/amxmodx" CACHE PATH "AMX Mod X's source, for the module SDK (public/)")

# The engine. A plugin arrives as a .aot file that wamrc compiled for i386, so
# the runtime only needs the AOT loader — no interpreter, no JIT. Both sides
# must come from the same WAMR release or the loader reports "unknown binary
# version"; CONTRIBUTING.md has the clone and the patch.
set(WAMR_ROOT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/deps/wamr" CACHE PATH "The patched WAMR 2.4.5 checkout")
if(WIN32)
	set(WAMR_BUILD_PLATFORM "windows")
else()
	set(WAMR_BUILD_PLATFORM "linux")
endif()
set(WAMR_BUILD_TARGET "X86_32")
set(WAMR_BUILD_INTERP 0)
set(WAMR_BUILD_AOT 1)
set(WAMR_BUILD_JIT 0)
set(WAMR_BUILD_LIBC_BUILTIN 0)
set(WAMR_BUILD_LIBC_WASI 0)
set(WAMR_BUILD_MULTI_MODULE 0)
include("${WAMR_ROOT_DIR}/build-scripts/runtime_lib.cmake")

add_library(amxts_amxx SHARED
	src/module.cpp
	"${AMXX}/public/sdk/amxxmodule.cpp"
	${WAMR_RUNTIME_LIB_SOURCE}
)

target_include_directories(amxts_amxx PRIVATE
	src
	"${AMXX}/public"
	"${AMXX}/public/sdk"
)

set_target_properties(amxts_amxx PROPERTIES PREFIX "")

if(WIN32)
	# amxts_amxx.dll
	set_target_properties(amxts_amxx PROPERTIES OUTPUT_NAME "amxts_amxx")
	target_link_libraries(amxts_amxx PRIVATE ws2_32 ntdll)
else()
	# amxts_amxx_i386.so: AMX Mod X on Linux looks a module up as
	# <name>_amxx_i386.so, where modules.ini says `amxts_amxx` or `amxts`.
	# i386: WAMR's build scripts add -m32 for X86_32. libstdc++ and libgcc go
	# in statically, because the one beside hlds_linux is older than ours;
	# glibc stays the system's, and is why this is built on an old one.
	# src/exports.map keeps every symbol but AMX Mod X's entry points inside.
	# _FILE_OFFSET_BITS=64: an i386 stat() fails with EOVERFLOW on a file
	# whose inode number needs 64 bits - XFS, btrfs, a Docker bind mount -
	# and the watcher would never see a plugin change there.
	set_target_properties(amxts_amxx PROPERTIES OUTPUT_NAME "amxts_amxx_i386")
	target_compile_options(amxts_amxx PRIVATE -m32 -fvisibility=hidden -fno-strict-aliasing -Wno-unused-parameter)
	target_compile_definitions(amxts_amxx PRIVATE HAVE_STDINT_H _FILE_OFFSET_BITS=64)
	target_link_options(amxts_amxx PRIVATE -m32 -static-libstdc++ -static-libgcc -Wl,--exclude-libs,ALL -Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/src/exports.map -Wl,--no-undefined)
	target_link_libraries(amxts_amxx PRIVATE pthread dl m)
endif()

if(MSVC)
	target_compile_definitions(amxts_amxx PRIVATE _CRT_SECURE_NO_WARNINGS HAVE_STDINT_H)
	target_compile_options(amxts_amxx PRIVATE /wd4996)
endif()
