// The coroutine a host keeps per parked async function - see coroutines.h.
//
// Separate from coroutines.h because a host's plugin record holds a map of
// these, and has to be declared before the functions that use it.
#pragma once

#include <stdint.h>
#include <vector>

// What running a coroutine ends with. Must match __CO_* in as/promise.ts.
#define CO_FINISHED 0
#define CO_PARKED   1
#define CO_TRAPPED  2
#define CO_DROPPED  3

// The size of a coroutine's Asyncify buffer. Must match __CO_BUFFER in
// as/promise.ts, which allocates it; here it is only said in a message.
#define CO_BUFFER    4096
// Arguments of an async function, as cells: as/promise.ts has room for 64.
#define CO_MAX_CELLS 64

/**
 * An async function's body, parked or running: what the host needs to call it
 * again through the table, and to put its shadow stack back where it was.
 */
struct Coroutine {
	int32_t               id;
	uint32_t              fn;      // its entry in the function table
	std::vector<uint32_t> cells;   // its arguments, as call_indirect takes them
	int32_t               buffer;  // Asyncify's buffer, in the plugin's memory
	uint32_t              base;    // __stack_pointer when it was started
	bool                  drop;    // it gave up: unwind it and never resume it
};
