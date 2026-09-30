#ifndef MODULECONFIG_H
#define MODULECONFIG_H

#define MODULE_NAME    "amxts Runtime"
#define MODULE_VERSION "0.1"
#define MODULE_AUTHOR  "amxts"
#define MODULE_URL     ""
#define MODULE_LOGTAG  "AMXTS"
#define MODULE_LIBRARY "amxts"
#define MODULE_LIBCLASS ""
#define MODULE_DATE __DATE__
#define MODULE_RELOAD_ON_MAPCHANGE

// ponytail: metamod is not needed — events arrive through the host plugin's
// forwards. Enable USE_METAMOD only if engine-level hooks become necessary.
#define FN_AMXX_ATTACH OnAmxxAttach
#define FN_AMXX_DETACH OnAmxxDetach

#endif
