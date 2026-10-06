# ReGameDLL's and ReHLDS's API headers

The headers the module's hooks of the game's functions are generated from
(`scripts/generate-chains.ts`, which writes `runtime/src/hookchains.h` and
`hookchains-api.h`). They are read, not compiled.

| folder | project | files | commit |
| --- | --- | --- | --- |
| `regamedll/` | [ReGameDLL_CS](https://github.com/rehlds/ReGameDLL_CS) - MIT (`regamedll/LICENSE`) | `regamedll/public/regamedll/regamedll_api.h`, `hookchains.h` | `4a50c42e85fd3778c2b7d24731c7d30c83bbab01` (API 5.30) |
| `rehlds/` | [ReHLDS](https://github.com/rehlds/ReHLDS) - MIT (`rehlds/LICENSE`) | `rehlds/public/rehlds/rehlds_api.h`, `hookchains.h`, `rehlds_interfaces.h` | `550f2d62f13f4ebeb029c1d9d1c212133202611d` (API 3.15) |

Their API versions are the ones ReAPI 5.29 (`includes/sources.json`) is
built against, whose includes number the chains a plugin names. The module
asks the server's ReGameDLL and ReHLDS for the same major version and at
least the same minor. When ReAPI's includes move to another release, these
are taken again at the commit of its API versions.
