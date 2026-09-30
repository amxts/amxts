# The coroutine scheduler under WAMR AOT i386, without a game server - see host.cpp.
# Built with the runtime's own WAMR flags (runtime/CMakeLists.txt):
#
#   cmake -A Win32 -S runtime/test/async-wamr -B runtime/test/async-wamr/build
#   cmake --build runtime/test/async-wamr/build --config Release
cmake_minimum_required(VERSION 3.20)
project(amxts_async_wamr CXX C)

set(RUNTIME "${CMAKE_CURRENT_SOURCE_DIR}/../..")
set(WAMR_ROOT_DIR "${RUNTIME}/deps/wamr")
set(WAMR_BUILD_PLATFORM "windows")
set(WAMR_BUILD_TARGET "X86_32")
set(WAMR_BUILD_INTERP 0)
set(WAMR_BUILD_AOT 1)
set(WAMR_BUILD_JIT 0)
set(WAMR_BUILD_LIBC_BUILTIN 0)
set(WAMR_BUILD_LIBC_WASI 0)
set(WAMR_BUILD_MULTI_MODULE 0)
include("${WAMR_ROOT_DIR}/build-scripts/runtime_lib.cmake")

add_executable(host host.cpp ${WAMR_RUNTIME_LIB_SOURCE})
target_include_directories(host PRIVATE "${RUNTIME}/src")
target_link_libraries(host PRIVATE ws2_32 ntdll)

if(MSVC)
	target_compile_definitions(host PRIVATE _CRT_SECURE_NO_WARNINGS HAVE_STDINT_H)
	target_compile_options(host PRIVATE /wd4996)
endif()
