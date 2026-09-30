# A Linux test server: HLDS (app 90) with ReHLDS, ReGameDLL, Metamod-R,
# AMX Mod X 1.10, ReAPI and YaPB - the builds the Windows test server runs,
# where a Linux release of the same one exists.
#
#   docker build -t amxts-hlds docker/hlds
#
# `bun run test:server --linux` starts a container of it, copies the amxts
# module under test and the suites in, and runs them over rcon
# (scripts/test-server.ts). modules.ini already names amxts_amxx; the module
# itself is not in the image.
FROM debian:bookworm-slim

ARG REHLDS=3.15.0.896
ARG REGAMEDLL=5.30.0.814
ARG METAMOD=1.3.0.149
ARG AMXX=1.10.0-git5474
ARG REAPI=5.29.0.358
ARG YAPB=4.4.957

RUN dpkg --add-architecture i386 \
	&& apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		ca-certificates curl unzip xz-utils lib32gcc-s1 lib32stdc++6 libc6:i386 \
	&& rm -rf /var/lib/apt/lists/*

# HLDS itself, from the steam_legacy branch: ReHLDS replaces the engine of
# the build before the 25th anniversary update, and on the current branch's
# libsteam_api.so it stops at "undefined symbol: SteamGameServer_Init".
# App 90 is known to stop half way ("state is 0x... after update job"): it is
# asked again until it says it is fully installed.
RUN mkdir -p /opt/steamcmd && curl -fsSL https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz | tar -xz -C /opt/steamcmd \
	&& for attempt in 1 2 3 4 5 6; do \
		/opt/steamcmd/steamcmd.sh +force_install_dir /hlds +login anonymous \
			+app_set_config 90 mod cstrike +app_update 90 -beta steam_legacy validate +quit | tee /tmp/steamcmd.log; \
		grep -q "Success! App '90' fully installed" /tmp/steamcmd.log && break; \
	done \
	&& grep -q "Success! App '90' fully installed" /tmp/steamcmd.log \
	&& mkdir -p /root/.steam/sdk32 && cp /opt/steamcmd/linux32/steamclient.so /root/.steam/sdk32/ \
	&& rm -rf /opt/steamcmd /root/Steam /root/.steam/steamcmd /tmp/steamcmd.log

WORKDIR /tmp/get

RUN curl -fsSLo rehlds.zip "https://github.com/rehlds/ReHLDS/releases/download/${REHLDS}/rehlds-bin-${REHLDS}.zip" \
	&& unzip -q rehlds.zip -d rehlds && cp -r rehlds/bin/linux32/. /hlds/ \
	&& curl -fsSLo regamedll.zip "https://github.com/rehlds/ReGameDLL_CS/releases/download/${REGAMEDLL}/regamedll-bin-${REGAMEDLL}.zip" \
	&& unzip -q regamedll.zip -d regamedll && cp -r regamedll/bin/linux32/cstrike/. /hlds/cstrike/ \
	&& curl -fsSLo metamod.zip "https://github.com/rehlds/Metamod-R/releases/download/${METAMOD}/metamod-bin-${METAMOD}.zip" \
	&& unzip -q metamod.zip -d metamod && mkdir -p /hlds/cstrike/addons/metamod \
	&& cp metamod/addons/metamod/metamod_i386.so /hlds/cstrike/addons/metamod/ \
	&& sed -i 's|^gamedll_linux .*|gamedll_linux "addons/metamod/metamod_i386.so"|' /hlds/cstrike/liblist.gam \
	&& for part in base cstrike; do \
		curl -fsSL "https://www.amxmodx.org/amxxdrop/1.10/amxmodx-${AMXX}-${part}-linux.tar.gz" | tar -xz -C /hlds/cstrike; \
	done \
	&& curl -fsSLo reapi.zip "https://github.com/rehlds/ReAPI/releases/download/${REAPI}/reapi-bin-${REAPI}.zip" \
	&& unzip -q reapi.zip -d reapi && cp reapi/addons/amxmodx/modules/reapi_amxx_i386.so /hlds/cstrike/addons/amxmodx/modules/ \
	&& curl -fsSL "https://github.com/yapb/yapb/releases/download/${YAPB}/yapb-${YAPB}-linux.tar.xz" | tar -xJ -C /hlds/cstrike \
	&& printf 'linux addons/amxmodx/dlls/amxmodx_mm_i386.so\nlinux addons/yapb/bin/yapb.so\n' > /hlds/cstrike/addons/metamod/plugins.ini \
	&& printf 'reapi\namxts_amxx\n' > /hlds/cstrike/addons/amxmodx/configs/modules.ini \
	&& cd / && rm -rf /tmp/get

WORKDIR /hlds
ENV LD_LIBRARY_PATH=/hlds

# The arguments are the server's command line: `-game cstrike +map de_dust2 ...`.
ENTRYPOINT ["./hlds_linux"]
