# A Linux test server without the ReHLDS family: Valve's HLDS (app 90) with
# its own engine and game library, metamod-p, AMX Mod X 1.10 with its stock
# modules (Ham Sandwich, fakemeta, engine, fun, cstrike) and YaPB - no ReHLDS,
# no ReGameDLL, no ReAPI. What a server that never installed them runs.
#
#   docker build -t amxts-hlds-plain docker/hlds-plain
#
# `bun run test:server --linux --plain` starts a container of it as
# `--linux` does one of amxts-hlds (scripts/test-server.ts). modules.ini
# already names amxts_amxx; the module itself is not in the image.
FROM debian:bookworm-slim

# HLDS from Steam's current branch, the build SteamCMD installs when no branch
# is asked for - Valve's engine needs no older one. `--build-arg
# HLDS_BETA=steam_legacy` gives the build before the 25th anniversary update.
ARG HLDS_BETA=
ARG METAMOD_P=1.21p109
ARG AMXX=1.10.0-git5474
ARG YAPB=4.4.957

RUN dpkg --add-architecture i386 \
	&& apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		ca-certificates curl unzip xz-utils lib32gcc-s1 lib32stdc++6 libc6:i386 \
	&& rm -rf /var/lib/apt/lists/*

# App 90 is known to stop half way ("state is 0x... after update job"): it is
# asked again until it says it is fully installed.
RUN mkdir -p /opt/steamcmd && curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz -C /opt/steamcmd \
	&& for attempt in 1 2 3 4 5 6; do \
		/opt/steamcmd/steamcmd.sh +force_install_dir /hlds +login anonymous \
			+app_set_config 90 mod cstrike +app_update 90 ${HLDS_BETA:+-beta $HLDS_BETA} validate +quit | tee /tmp/steamcmd.log; \
		grep -q "Success! App '90' fully installed" /tmp/steamcmd.log && break; \
	done \
	&& grep -q "Success! App '90' fully installed" /tmp/steamcmd.log \
	&& mkdir -p /root/.steam/sdk32 && cp /opt/steamcmd/linux32/steamclient.so /root/.steam/sdk32/ \
	&& rm -rf /opt/steamcmd /root/Steam /root/.steam/steamcmd /tmp/steamcmd.log

# gdb, for the backtrace of a core dump the server leaves when it crashes
# (scripts/core-dumps.ts). After SteamCMD, so that its layer stays cached.
RUN apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends gdb \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /tmp/get

# metamod-p rather than Metamod-R: the Metamod an HLDS of Valve's alone has
# always run.
RUN mkdir -p /hlds/cstrike/addons/metamod \
	&& curl -fsSL "https://github.com/Bots-United/metamod-p/releases/download/v${METAMOD_P}/metamod-p-v${METAMOD_P}-linux_ubuntu1804.tar.xz" | tar -xJ -C /hlds/cstrike \
	&& sed -i 's|^gamedll_linux .*|gamedll_linux "addons/metamod/dlls/metamod.so"|' /hlds/cstrike/liblist.gam \
	&& for part in base cstrike; do \
		curl -fsSL "https://www.amxmodx.org/amxxdrop/1.10/amxmodx-${AMXX}-${part}-linux.tar.gz" | tar -xz -C /hlds/cstrike; \
	done \
	&& curl -fsSL "https://github.com/yapb/yapb/releases/download/${YAPB}/yapb-${YAPB}-linux.tar.xz" | tar -xJ -C /hlds/cstrike \
	&& printf 'linux addons/amxmodx/dlls/amxmodx_mm_i386.so\nlinux addons/yapb/bin/yapb.so\n' > /hlds/cstrike/addons/metamod/plugins.ini \
	&& printf 'amxts_amxx\n' > /hlds/cstrike/addons/amxmodx/configs/modules.ini \
	&& cd / && rm -rf /tmp/get

WORKDIR /hlds
ENV LD_LIBRARY_PATH=/hlds

# The arguments are the server's command line: `-game cstrike +map de_dust2 ...`.
ENTRYPOINT ["./hlds_linux"]
