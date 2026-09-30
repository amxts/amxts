# @amxts/wamrc-linux-x64

`wamrc`, the ahead-of-time compiler of [WAMR](https://github.com/bytecodealliance/wasm-micro-runtime)
2.4.5 with the amxts patch, built for Linux x64: it turns a plugin's
WebAssembly into the machine code an amxts server loads.

[`@amxts/core`](https://www.npmjs.com/package/@amxts/core) installs it as
an optional dependency - a package manager takes the one for its own system
and skips the others - and `amxts build` finds it there. There is nothing
to set up.

`wamrc` is under WAMR's license, Apache-2.0 with LLVM exceptions
(`WAMR-LICENSE`), with LLVM 18.1.8 linked in (`LLVM-LICENSE.TXT`). What
the patch changes is in the core's package, `runtime/patches/`.
