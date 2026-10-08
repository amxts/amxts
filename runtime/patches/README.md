# Patches against vendored dependencies

`runtime/deps/` is git-ignored, so what amxts changes inside a vendored
dependency lives here as a patch and is applied after a fresh clone.
`CONTRIBUTING.md` has the clone, apply and build steps.

## Licenses

A patch is a change to its upstream's source, and is under the upstream's
license, not this repository's MIT:

| patch | upstream | license |
| --- | --- | --- |
| `assemblyscript-0.28.20-amxts.patch` | [AssemblyScript](https://github.com/AssemblyScript/assemblyscript) | Apache-2.0 |
| `wamr-2.4.5-amxts.patch` | [WAMR](https://github.com/bytecodealliance/wasm-micro-runtime) | Apache-2.0 with LLVM exceptions |

Apache-2.0 asks that modified files say they were changed, and that a copy
of the license goes with a distribution: the patches are the record of what
amxts changes, and a package that ships a patched compiler - the server kit
(`bun run serverkit`) bundles both - has to carry each upstream's `LICENSE`
and say the compiler is patched. It does: `runtime/licenses` goes into the
kit as `addons/amxts/tools/licenses`, with Binaryen's, Bun's and LLVM's
(`runtime/licenses/README.md`).

## assemblyscript-0.28.20-amxts.patch

Applies to AssemblyScript at tag `v0.28.20`, over `src/` and `std/`. It is
what lets a plugin be plain TypeScript: `number` as JavaScript's number,
unions of string literals, closures, optional properties and `undefined`,
`?.`, `??`, destructuring, `Record` and index signatures with `in`, `delete`,
`Object.keys` and `for...in`, `try`/`catch`/`finally`, typed `JSON`, text joined
with a number by `+`, `async`/`await`, overloads, object types in place,
return types read off the body, `Date` in the server's time zone.

It also tunes the runtime (`std/assembly/rt/`) for a plugin, which makes
many small objects over a small live heap: a small block freed (up to 124
bytes) goes on a list of its size, and the next allocation of that size
takes it without TLSF's search, split or merge; and the incremental collector
starts a cycle only once the heap has doubled and grown 1 MB more
(`ASC_GC_IDLEGAP`), not 1 KB, since a cycle visits every root and every
live object. `ASC_GC_STRESS` steps the collector on every allocation, for
the tests of what the shadow stack keeps.

And it makes a plugin's many small calls cheaper:

- a function that can reach no collection - no allocation, no import (a
  native may call back into the plugin) other than one marked `@leaf`, no
  call through a function value - keeps no shadow-stack frame, and a call
  to it no slots for its arguments; in one that can, a local gets a slot
  only if it holds a value across such a call (`src/passes/shadowstack.ts`);
- the check for an error on its way to a catch after a call is kept only
  where the callee may throw, which is known once the whole program is
  compiled;
- a variable a closure captured is read and written in place, not through
  a call.

And it allocates less:

- an array subclass can keep its elements in its own object (`new
  Array(length, true)` leaves it without a buffer for the subclass to point
  at room of its own, as `Vector` does): one allocation, its own buffer
  until it grows past that room;
- an object that never leaves the function that makes it - its fields read
  and written there, its address given only to an import that keeps none or
  to a function that keeps none of it - is made in that function's part of
  the shadow stack, with the header of a static object the collector never
  frees (`src/passes/stackobjects.ts`, run by the build on the optimized
  module, `makeStackObjects`). Which parameters a function keeps is worked
  out for the whole program first: stored into the heap or a global,
  returned, captured, given on to a function or an import that keeps it.
  An object literal is made where it is written, not by a call, and an
  array literal is one allocation, its elements in its own object, so
  `player.showHud(text, { color: [255, 40, 40] })` allocates nothing; an
  object stored into another made in the same frame stays there with it.
  The collector reads the references in such an object when it reads the
  stack, so a store into one needs no barrier; a function an async
  function's coroutine may park in is left alone;
- null stored into a reference field is a plain store, without the
  collector's barrier, and a field that starts at zero is not written again
  in a constructor: the incremental runtime's allocation is zeroed;
- a constructor inlined as a super call does not check again whether
  `this` was allocated.

After changing `src/` or `std/` in `runtime/deps/assemblyscript`, rebuild it
and write the patch back from there:

```sh
git diff -- src std > ../../patches/assemblyscript-0.28.20-amxts.patch
```

## wamr-2.4.5-amxts.patch

Applies to WAMR at tag `WAMR-2.4.5`. The tag matters: the AOT file format is
versioned, and a module built from one release cannot load an `.aot` that
`wamrc` from another produced - `AOT module load failed: unknown binary
version`.

- `--native-signatures=<file>` in `wamrc`, which compiles a call to a listed
  native as a direct call;
- the warning about a signature that disagrees with its import, which WAMR
  compiles out of its own compiler;
- on i386, a double made a 64-bit integer with saturation (`i64.trunc_sat_f64_s`,
  what every number made a cell becomes) through SSE2 when it fits in 32 bits,
  and through the x87 only when it does not;
- on i386 with SSE2, a double made a 32-bit integer with saturation
  (`i32.trunc_sat_f64_s`, what a `%` checks its numbers are whole with) as
  `cvttsd2si` itself: only its answer for NaN and a number out of range,
  `0x80000000`, takes the branch that saturates, not three branches around
  every conversion;
- the i386 symbols the loader did not resolve, which LLVM spells with one
  underscore: the float and vector constant pools (`_real@...`, `_xmm@...`)
  and, on Windows, the 64-bit division helpers (`_alldiv`, `_aullrem`, ...);
- `wasm_runtime_take_trap_frames`: the frames a trap left, for the module to
  print its own way rather than WAMR printing them to stdout;
- `wasm_runtime_memory_view`: where the plugin's memory is and its size, in
  one call, for a native's thunk that reads and writes it;
- a direct call (`wasm_runtime_direct_entry`, `_begin`, `_end`): the machine
  code of an AOT function, which the module calls itself with the C types of
  its parameters - what `wasm_runtime_call_wasm` does on every call, less
  what it asks of a function it has not seen; the frame and the trap are
  handled as that call handles them. `_begin` is written into the module's
  call by the link-time optimisation of either compiler (`__forceinline`,
  `always_inline`);
- two build fixes for building `wamrc` against a prebuilt LLVM: a stub
  `LibXml2::LibXml2` target, and repointing `LLVMDebugInfoPDB`, whose
  exported target carries the DIA SDK path of the machine that built the
  LLVM release.
