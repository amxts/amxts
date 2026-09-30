# The Linux toolchain: the amxts_amxx_i386.so module (gcc -m32) and wamrc
# (x86-64, against a prebuilt LLVM 18).
#
#   docker build -t amxts-build docker/build
#
# Ubuntu 18.04 for its glibc 2.27: what is built here runs on the servers,
# and a binary asks for the glibc it was linked against or newer. The LLVM
# release package is built on 18.04 too. scripts/linux-build.ts drives it.
FROM ubuntu:18.04

ARG CMAKE_VERSION=3.30.5
ARG LLVM_VERSION=18.1.8

RUN apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
		ca-certificates curl git xz-utils make python3 \
		gcc g++ gcc-multilib g++-multilib \
	&& rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-x86_64.tar.gz" \
	| tar -xz -C /opt \
	&& ln -s /opt/cmake-${CMAKE_VERSION}-linux-x86_64/bin/* /usr/local/bin/

# Only what wamrc links against: the headers, the static libraries and the
# CMake package - not clang, lld or the tools, which are most of the 1 GB.
RUN curl -fsSL "https://github.com/llvm/llvm-project/releases/download/llvmorg-${LLVM_VERSION}/clang+llvm-${LLVM_VERSION}-x86_64-linux-gnu-ubuntu-18.04.tar.xz" \
	| tar -xJ -C /opt --wildcards --no-anchored '*/include/*' '*/lib/*.a' '*/lib/cmake/llvm/*' '*/bin/llvm-config' \
	&& mv /opt/clang+llvm-${LLVM_VERSION}-x86_64-linux-gnu-ubuntu-18.04 /opt/llvm

# The package's CMake exports name every tool it was built with, and CMake
# refuses a package whose files are missing: each tool left out above becomes
# an empty file, each shared library an empty one, which --as-needed drops
# from wamrc (it is linked against every library the package exports).
RUN gcc -shared -o /tmp/empty.so -x c /dev/null \
	&& grep -ho '"${_IMPORT_PREFIX}/[^"]*"' /opt/llvm/lib/cmake/llvm/LLVMExports-*.cmake \
		| sed 's|"${_IMPORT_PREFIX}|/opt/llvm|; s|"$||' | sort -u \
		| while read -r file; do \
			[ -e "$file" ] && continue; \
			mkdir -p "$(dirname "$file")"; \
			case "$file" in *.so|*.so.*) cp /tmp/empty.so "$file" ;; *) touch "$file" ;; esac; \
		done

# LLVM's support library links zlib and terminfo.
RUN apt-get update \
	&& DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends zlib1g-dev libtinfo-dev \
	&& rm -rf /var/lib/apt/lists/*

ENV LLVM_DIR=/opt/llvm/lib/cmake/llvm
WORKDIR /work
