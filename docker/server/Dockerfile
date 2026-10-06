# A Linux game server with amxts: HLDS (app 90, steam_legacy) with ReHLDS,
# ReGameDLL, Metamod-R, AMX Mod X 1.10 and ReAPI, and amxts on it - the
# module, which needs no plugin of AMX Mod X's, and the server kit, whose
# compiler builds a .ts plugin on the server. A project's plugins, configs
# and files come from the folder mounted at /project, at every start
# (start.sh).
#
#   docker run --rm -it -p 27015:27015/udp -v <project>:/project ghcr.io/amxts/server
#
# CI publishes it for every release as ghcr.io/amxts/server:<version> and
# :latest (.github/workflows/publish.yml), built with the release's Linux
# server kit. `bun run server:image` builds it from a checkout under the name
# of the checkout's version, after `bun run build:linux`. The kit is a build
# context of its own, `kit` - dist-server/linux, which `bun run serverkit
# --os linux` assembles:
#
#   docker build -t ghcr.io/amxts/server:<version> --build-context kit=dist-server/linux docker/server
#
# Two stages: everything is downloaded and unpacked in the first, and the
# second - the image - is a slim Debian with the 32-bit C libraries hlds_linux
# needs and the server's folder, nothing else. The test server (docker/hlds)
# is another image: it has bots and no amxts.

FROM debian:bookworm-slim AS get

ARG REHLDS=3.15.0.896
ARG REGAMEDLL=5.30.0.814
ARG METAMOD=1.3.0.149
ARG AMXX=1.10.0-git5474
ARG REAPI=5.29.0.358

RUN apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		ca-certificates curl unzip lib32gcc-s1 \
	&& rm -rf /var/lib/apt/lists/*

# HLDS from the steam_legacy branch: ReHLDS replaces the engine of the build
# before the 25th anniversary update, and on the current branch's
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
	&& cp /opt/steamcmd/linux32/steamclient.so /steamclient.so

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
	&& printf 'linux addons/amxmodx/dlls/amxmodx_mm_i386.so\n' > /hlds/cstrike/addons/metamod/plugins.ini \
	&& printf 'reapi\namxts_amxx\n' >> /hlds/cstrike/addons/amxmodx/configs/modules.ini

# What a server does not run: SteamCMD's state, the 64-bit Steam libraries
# (hlds_linux is 32-bit), and AMX Mod X's compiler and plugin sources.
RUN rm -rf /hlds/steamapps /hlds/linux64 /hlds/cstrike/addons/amxmodx/scripting

# amxts: the module - modules.ini names it above - and addons/amxts with the
# compiler. AMX Mod X's plugins.ini has no line for amxts: the module needs
# no plugin.
COPY --from=kit addons/amxts /hlds/cstrike/addons/amxts
COPY --from=kit addons/amxmodx/modules/amxts_amxx_i386.so /hlds/cstrike/addons/amxmodx/modules/
RUN chmod 755 /hlds/cstrike/addons/amxts/tools/amxts-compile /hlds/cstrike/addons/amxts/tools/wamrc

FROM debian:bookworm-slim

# The version, the commit and the date are added by the build that publishes
# it.
LABEL org.opencontainers.image.title="amxts server" \
	org.opencontainers.image.description="A Counter-Strike 1.6 server with amxts: HLDS, ReHLDS, ReGameDLL, Metamod-R, AMX Mod X and ReAPI; a project mounted at /project" \
	org.opencontainers.image.source="https://github.com/amxts/amxts" \
	org.opencontainers.image.url="https://amxts.github.io"

# The 32-bit C and C++ libraries hlds_linux and the modules link against; the
# CA roots Steam's client connects with; tini, so that the server is not
# process 1 and a stop signal reaches it.
RUN dpkg --add-architecture i386 \
	&& apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		ca-certificates lib32gcc-s1 lib32stdc++6 libc6:i386 tini \
	&& rm -rf /var/lib/apt/lists/* \
	&& useradd --create-home --uid 1000 hlds

COPY --from=get --chown=hlds:hlds /hlds /hlds
# SteamCMD's steamclient.so, not the one in /hlds: with that one the server
# stops at "Unable to initialize Steam".
COPY --from=get --chown=hlds:hlds /steamclient.so /home/hlds/.steam/sdk32/steamclient.so
COPY --chmod=755 start.sh /usr/local/bin/amxts-server

USER hlds
WORKDIR /hlds
ENV LD_LIBRARY_PATH=/hlds \
	MAP=de_dust2 \
	MAXPLAYERS=16 \
	PORT=27015 \
	SERVER_NAME="amxts server" \
	SV_LAN=1
EXPOSE 27015/udp

# Arguments after the image name go to the end of hlds_linux's command line:
# `+mp_timelimit 0`, `-pingboost 3`.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/amxts-server"]
