#!/bin/sh
# The amxts-server image's start: lays a mounted project over the game folder,
# writes the settings the environment gives into server.cfg, and starts
# hlds_linux. Everything it does is undone by removing the container.
#
# /project, when mounted, is an amxts project:
#
#   dist/              the built plugins (`npx amxts build --os linux`) and
#                      their plugins.ini - the server's amxts plugin list
#   addons/            over the game's addons/: modules (.so), Pawn plugins
#   configs/           over addons/amxmodx/configs/
#   data/              over addons/amxmodx/data/ (data/lang/*.txt)
#   maps/ models/ sound/ sprites/ gfx/ overviews/ resource/
#                      over the game folder's own
#   motd.txt           the message of the day; without it there is none
#
# dist/ is linked: the module reads the plugins where they are, so a plugin
# built again on the host is reloaded by the running server. The rest is
# copied, at every start: the engine and AMX Mod X are i386 without
# large-file support, and their stat() fails with EOVERFLOW on the 64-bit
# inode numbers of a bind mount ("_stat on file ... which appeared to exist
# failed", then a map "not found on server" or a model it cannot load).
# Without /project the server runs addons/amxts/plugins.ini.
set -eu

GAME=/hlds/cstrike
PROJECT=/project

# A folder of the project over one of the server's.
copy_tree() {
	[ -d "$1" ] || return 0
	mkdir -p "$2"
	cp -rf "$1/." "$2/"
	echo "amxts-server: $1 -> $2"
}

# A line a file must have, moved to its end.
keep_line() {
	file=$1 line=$2
	touch "$file"
	grep -vx "[[:space:]]*$line[[:space:]]*" "$file" > "$file.tmp" || true
	printf '%s\n' "$line" >> "$file.tmp"
	mv "$file.tmp" "$file"
}

LIST=
if [ -d "$PROJECT" ]; then
	if [ -f "$PROJECT/dist/plugins.ini" ]; then
		# The project's list, with its plugins beside it: the module looks for
		# a list's plugins in plugins/ next to it.
		mkdir -p "$GAME/addons/amxts/project"
		ln -sfn "$PROJECT/dist" "$GAME/addons/amxts/project/plugins"
		ln -sf "$PROJECT/dist/plugins.ini" "$GAME/addons/amxts/project/plugins.ini"
		LIST=addons/amxts/project/plugins.ini
		echo "amxts-server: plugins from $PROJECT/dist: $(grep -v '^[;#]' "$PROJECT/dist/plugins.ini" | tr -s '\r\n' ' ')"
	else
		echo "amxts-server: $PROJECT has no dist/plugins.ini - build it with \`npx amxts build --os linux\`"
	fi
	copy_tree "$PROJECT/addons" "$GAME/addons"
	copy_tree "$PROJECT/configs" "$GAME/addons/amxmodx/configs"
	copy_tree "$PROJECT/data" "$GAME/addons/amxmodx/data"
	for dir in maps models sound sprites gfx overviews resource; do
		copy_tree "$PROJECT/$dir" "$GAME/$dir"
	done
fi

# The window a player sees on joining: the project's motd.txt, or none -
# never HLDS's stock one.
if [ -f "$PROJECT/motd.txt" ]; then
	cp -f "$PROJECT/motd.txt" "$GAME/motd.txt"
	echo "amxts-server: $PROJECT/motd.txt -> $GAME/motd.txt"
else
	rm -f "$GAME/motd.txt"
fi

keep_line "$GAME/addons/amxmodx/configs/modules.ini" reapi
keep_line "$GAME/addons/amxmodx/configs/modules.ini" amxts_amxx

# server.cfg runs after the command line, so what the environment sets goes
# into it - over the lines of the same name.
RCON_PASSWORD=${RCON_PASSWORD:-}
if [ -z "$RCON_PASSWORD" ]; then
	RCON_PASSWORD=$(tr -dc 'a-z0-9' < /dev/urandom | head -c 16)
	echo "amxts-server: rcon_password $RCON_PASSWORD (set RCON_PASSWORD to choose one)"
fi
cfg="$GAME/server.cfg"
sed -E '/^[[:space:]]*(hostname|rcon_password|sv_lan)[[:space:]]/d' "$cfg" > "$cfg.tmp"
{
	printf 'hostname "%s"\n' "$SERVER_NAME"
	printf 'rcon_password "%s"\n' "$RCON_PASSWORD"
	printf 'sv_lan %s\n' "$SV_LAN"
} >> "$cfg.tmp"
mv "$cfg.tmp" "$cfg"

cd /hlds
set -- +maxplayers "$MAXPLAYERS" +map "$MAP" "$@"
if [ -n "$LIST" ]; then set -- +localinfo amxts_plugins "$LIST" "$@"; fi
set -- -game cstrike +ip 0.0.0.0 +port "$PORT" -insecure -noipx +sv_lan "$SV_LAN" "$@"
echo "amxts-server: ./hlds_linux $*"
exec ./hlds_linux "$@"
