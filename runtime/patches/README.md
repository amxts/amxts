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
- the i386 symbols the loader did not resolve, which LLVM spells with one
  underscore: the float and vector constant pools (`_real@...`, `_xmm@...`)
  and, on Windows, the 64-bit division helpers (`_alldiv`, `_aullrem`, ...);
- two build fixes for building `wamrc` against a prebuilt LLVM: a stub
  `LibXml2::LibXml2` target, and repointing `LLVMDebugInfoPDB`, whose
  exported target carries the DIA SDK path of the machine that built the
  LLVM release.
