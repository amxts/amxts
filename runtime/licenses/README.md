# Licenses of what the server kit carries

The server kit (`bun run serverkit`) and the release ship programs built from
other projects. Their licenses go with them: `bun run serverkit` copies this
folder into the kit as `addons/amxts/tools/licenses/`, with amxts' own
`LICENSE` beside them as `amxts-LICENSE`.

| file | project | in |
| --- | --- | --- |
| `AssemblyScript-LICENSE`, `AssemblyScript-NOTICE` | [AssemblyScript](https://github.com/AssemblyScript/assemblyscript) 0.28.20, **patched** (`runtime/patches/assemblyscript-0.28.20-amxts.patch`) - Apache-2.0 | `amxts-compile` |
| `Binaryen-LICENSE` | [Binaryen](https://github.com/WebAssembly/binaryen), the version AssemblyScript 0.28.20 depends on - Apache-2.0 | `amxts-compile` |
| `Bun-LICENSE.md` | [Bun](https://github.com/oven-sh/bun) 1.4.2, the runtime `bun build --compile` puts in - MIT, with the libraries it links statically | `amxts-compile` |
| `WAMR-LICENSE` | [WAMR](https://github.com/bytecodealliance/wasm-micro-runtime) 2.4.5, **patched** (`runtime/patches/wamr-2.4.5-amxts.patch`) - Apache-2.0 with LLVM exceptions | `wamrc`, the `amxts_amxx` module |
| `AMXX-LICENSE.txt`, `GPL-3.0.txt` | [AMX Mod X](https://github.com/alliedmodders/amxmodx) - GPL-3.0-or-later with AMX Mod X's exceptions: its module SDK is linked into the module and its includes build the natives' image the module carries, so the module is distributed under GPL-3.0-or-later (its sources in this repository are MIT) | the `amxts_amxx` module |
| `ReGameDLL-LICENSE`, `ReHLDS-LICENSE` | [ReGameDLL_CS](https://github.com/rehlds/ReGameDLL_CS) and [ReHLDS](https://github.com/rehlds/ReHLDS) - MIT: the module's hooks of their hookchains are generated from their API headers (`runtime/vendor`) | the `amxts_amxx` module |
| `curl-COPYING` | [curl](https://curl.se) 8.22.0, linked into the module statically for `fetch` - the curl license (MIT-style) | the `amxts_amxx` module |
| `mbedTLS-LICENSE` | [Mbed TLS](https://github.com/Mbed-TLS/mbedtls) 3.6.7, linked into the module statically for HTTPS, FTPS and SFTP - Apache-2.0 (or GPL-2.0-or-later) | the `amxts_amxx` module |
| `libssh2-COPYING` | [libssh2](https://libssh2.org) 1.11.1, linked into the module statically for SFTP - BSD-3-Clause | the `amxts_amxx` module |
| `MPL-2.0.txt` | Mozilla's list of certificate authorities, as [curl publishes it](https://curl.se/docs/caextract.html), carried inside the module for HTTPS - MPL-2.0 | the `amxts_amxx` module |
| `LLVM-LICENSE.TXT` | [LLVM](https://github.com/llvm/llvm-project) 18.1.8, linked into `wamrc` statically - Apache-2.0 with LLVM exceptions | `wamrc` |

The npm packages carry them too. `@amxts/core` has this folder, AMX Mod X's
includes (`amxmodx/base/include`, under `AMXX-LICENSE.txt`), and the patched
AssemblyScript in `runtime/deps/assemblyscript` with its own `LICENSE` and
`NOTICE` and those of Binaryen and long beside them; `@amxts/wamrc-<system>`
has `WAMR-LICENSE` and `LLVM-LICENSE.TXT` beside its `wamrc`.

The patches are the record of what amxts changes in AssemblyScript and WAMR.
When one of these projects moves to another release, its license here is
taken again from that release.
