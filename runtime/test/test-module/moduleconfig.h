// A module of the server suites' own (testmodule.cpp), built beside the amxts
// module and never shipped.
#ifndef MODULECONFIG_H
#define MODULECONFIG_H

#define MODULE_NAME     "amxts test module"
#define MODULE_VERSION  "1.0"
#define MODULE_AUTHOR   "amxts"
#define MODULE_URL      ""
#define MODULE_LOGTAG   "TESTMODULE"
#define MODULE_LIBRARY  "testmodule"
#define MODULE_LIBCLASS ""
#define MODULE_DATE     __DATE__

#define FN_AMXX_ATTACH        OnAmxxAttach
#define FN_AMXX_PLUGINSLOADED OnPluginsLoaded

#endif
