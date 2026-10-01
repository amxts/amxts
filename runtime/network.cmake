# The network client's libraries: libcurl over mbedTLS, with libssh2 for
# SFTP, built static for the module and linked into it, so a server installs
# one file. curl speaks HTTP and HTTPS for fetch, and FTP, FTPS and SFTP for
# a module that wants them; nothing else is built in. mbedTLS is the TLS
# library because it is the smallest that builds 32-bit with MSVC and gcc
# alike and serves libssh2's crypto too. The certificate authorities are
# Mozilla's list, as curl publishes it, carried inside the module: a server's
# own store may be missing (a slim container) or not filled in (Windows
# fetches its roots on demand).
#
# Each library is an ExternalProject built in Release whatever the module's
# configuration, with the module's compiler and, on Linux, -m32 and -fPIC.
# The archives are pinned by version and sha256 and downloaded on the first
# build; what they make lands in <build>/net.
include(ExternalProject)

set(NET_MBEDTLS_VERSION 3.6.7)
set(NET_MBEDTLS_SHA256 a7e8bcbec0e6f761b4af24f25677626b35f762f68eef79c08677a363212d11f6)
set(NET_LIBSSH2_VERSION 1.11.1)
set(NET_LIBSSH2_SHA256 9954cb54c4f548198a7cbebad248bdc87dd64bd26185708a294b2b50771e3769)
set(NET_CURL_VERSION 8.22.0)
set(NET_CURL_SHA256 f7ef3ae8a22e521f289803fe93543eb64c329b58aa73a9e224dfd915a2a5f4f7)
set(NET_CACERT_DATE 2026-09-25)
set(NET_CACERT_SHA256 a41b5d356aea97a529fe27e0f7316d2f9d946d75927476cf9cf1b90637d00505)

set(NET "${CMAKE_CURRENT_BINARY_DIR}/net")
set(NET_LIB "${NET}/lib")

# Compiled for size: the network waits far longer than this code runs.
if(MSVC)
	set(NET_C_FLAGS "")
	set(NET_C_RELEASE "/O1 /DNDEBUG")
	set(NET_LIBFILE "${NET_LIB}/<name>.lib")
else()
	set(NET_C_FLAGS "-m32 -ffunction-sections -fdata-sections")
	set(NET_C_RELEASE "-Os -DNDEBUG")
	set(NET_LIBFILE "${NET_LIB}/lib<name>.a")
endif()

# What every library is configured with.
set(NET_ARGS
	-DCMAKE_BUILD_TYPE=Release
	-DCMAKE_INSTALL_PREFIX=${NET}
	-DCMAKE_INSTALL_LIBDIR=lib
	-DCMAKE_PREFIX_PATH=${NET}
	-DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
	-DCMAKE_C_FLAGS=${NET_C_FLAGS}
	-DCMAKE_C_FLAGS_RELEASE=${NET_C_RELEASE}
	-DCMAKE_POSITION_INDEPENDENT_CODE=ON
	-DCMAKE_POLICY_DEFAULT_CMP0091=NEW
	-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreadedDLL
	-DBUILD_SHARED_LIBS=OFF
	-DBUILD_TESTING=OFF
)
set(NET_BUILD ${CMAKE_COMMAND} --build <BINARY_DIR> --config Release)
set(NET_INSTALL ${CMAKE_COMMAND} --build <BINARY_DIR> --config Release --target install)

function(net_file name out)
	string(REPLACE "<name>" "${name}" file "${NET_LIBFILE}")
	set(${out} "${file}" PARENT_SCOPE)
endfunction()

net_file(mbedtls NET_MBEDTLS)
net_file(mbedx509 NET_MBEDX509)
net_file(mbedcrypto NET_MBEDCRYPTO)
if(MSVC)
	net_file(libssh2 NET_LIBSSH2)
	net_file(libcurl NET_CURL)
else()
	net_file(ssh2 NET_LIBSSH2)
	net_file(curl NET_CURL)
endif()

# mbedTLS as a client of TLS 1.2 and 1.3 only: no server side, no DTLS, no
# self-test, no ciphers and curves the web and SSH do not use. Appended to
# its config before it is built, so curl and libssh2 read the same.
set(NET_MBEDTLS_OFF
	MBEDTLS_SELF_TEST MBEDTLS_VERSION_FEATURES MBEDTLS_NET_C MBEDTLS_TIMING_C
	MBEDTLS_SSL_SRV_C MBEDTLS_SSL_CACHE_C MBEDTLS_SSL_COOKIE_C MBEDTLS_SSL_TICKET_C
	MBEDTLS_SSL_PROTO_DTLS MBEDTLS_SSL_DTLS_ANTI_REPLAY MBEDTLS_SSL_DTLS_HELLO_VERIFY
	MBEDTLS_SSL_DTLS_CLIENT_PORT_REUSE MBEDTLS_SSL_DTLS_CONNECTION_ID
	MBEDTLS_KEY_EXCHANGE_PSK_ENABLED MBEDTLS_KEY_EXCHANGE_DHE_PSK_ENABLED
	MBEDTLS_KEY_EXCHANGE_ECDHE_PSK_ENABLED MBEDTLS_KEY_EXCHANGE_RSA_PSK_ENABLED
	MBEDTLS_KEY_EXCHANGE_ECJPAKE_ENABLED MBEDTLS_ECJPAKE_C
	MBEDTLS_CAMELLIA_C MBEDTLS_ARIA_C MBEDTLS_DES_C MBEDTLS_NIST_KW_C MBEDTLS_LMS_C
	MBEDTLS_PKCS7_C MBEDTLS_X509_CSR_PARSE_C MBEDTLS_X509_CSR_WRITE_C
	MBEDTLS_X509_CRT_WRITE_C MBEDTLS_X509_CREATE_C
	MBEDTLS_ECP_DP_SECP192R1_ENABLED MBEDTLS_ECP_DP_SECP224R1_ENABLED
	MBEDTLS_ECP_DP_SECP192K1_ENABLED MBEDTLS_ECP_DP_SECP224K1_ENABLED
	MBEDTLS_ECP_DP_SECP256K1_ENABLED MBEDTLS_ECP_DP_BP256R1_ENABLED
	MBEDTLS_ECP_DP_BP384R1_ENABLED MBEDTLS_ECP_DP_BP512R1_ENABLED
)
list(TRANSFORM NET_MBEDTLS_OFF PREPEND "#undef ")
string(REPLACE ";" "\n" NET_MBEDTLS_TRIM "${NET_MBEDTLS_OFF}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/net-mbedtls-trim.h" "\n/* amxts: a TLS client only (runtime/network.cmake) */\n${NET_MBEDTLS_TRIM}\n")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/net-mbedtls-trim.cmake" [=[
if(NOT EXISTS "${CONFIG}.orig")
	configure_file("${CONFIG}" "${CONFIG}.orig" COPYONLY)
endif()
file(READ "${CONFIG}.orig" config)
file(READ "${TRIM}" trim)
file(WRITE "${CONFIG}" "${config}${trim}")
]=])
string(SHA256 NET_MBEDTLS_TRIM_HASH "${NET_MBEDTLS_TRIM}")

ExternalProject_Add(net_mbedtls
	URL "https://github.com/Mbed-TLS/mbedtls/releases/download/mbedtls-${NET_MBEDTLS_VERSION}/mbedtls-${NET_MBEDTLS_VERSION}.tar.bz2"
	URL_HASH SHA256=${NET_MBEDTLS_SHA256}
	DOWNLOAD_EXTRACT_TIMESTAMP ON
	PATCH_COMMAND ${CMAKE_COMMAND} -DCONFIG=<SOURCE_DIR>/include/mbedtls/mbedtls_config.h
		-DTRIM=${CMAKE_CURRENT_BINARY_DIR}/net-mbedtls-trim.h -DHASH=${NET_MBEDTLS_TRIM_HASH}
		-P ${CMAKE_CURRENT_BINARY_DIR}/net-mbedtls-trim.cmake
	CMAKE_ARGS ${NET_ARGS}
		-DENABLE_PROGRAMS=OFF
		-DENABLE_TESTING=OFF
		-DGEN_FILES=OFF
		-DMBEDTLS_FATAL_WARNINGS=OFF
		-DUSE_SHARED_MBEDTLS_LIBRARY=OFF
		-DUSE_STATIC_MBEDTLS_LIBRARY=ON
		-DINSTALL_MBEDTLS_HEADERS=ON
	BUILD_COMMAND ${NET_BUILD}
	INSTALL_COMMAND ${NET_INSTALL}
	BUILD_BYPRODUCTS ${NET_MBEDTLS} ${NET_MBEDX509} ${NET_MBEDCRYPTO}
)

# Fixes to the libraries' sources, made before they build: each `fix(from
# into)` replaces a text of the source, and a source that no longer has the
# text stops the build - the fix is then to be looked at again, or dropped.
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/net-fix.cmake" [=[
if(NOT EXISTS "${SOURCE}.orig")
	configure_file("${SOURCE}" "${SOURCE}.orig" COPYONLY)
endif()
file(READ "${SOURCE}.orig" source)
# The texts are arguments, not a list: C has semicolons.
function(fix from into)
	string(FIND "${source}" "${from}" found)
	if(found EQUAL -1)
		message(FATAL_ERROR "${SOURCE} has changed: a fix of runtime/network.cmake does not apply")
	endif()
	string(REPLACE "${from}" "${into}" fixed "${source}")
	set(source "${fixed}" PARENT_SCOPE)
endfunction()
include("${FIXES}")
file(WRITE "${SOURCE}" "${source}")
]=])

# libssh2 1.11.1's mbedTLS backend cannot take the public key out of a
# private key file - what a login with a key file and no public key file,
# curl's way, needs: _libssh2_mbedtls_pub_priv_key leaves `ret`
# uninitialised, and gen_publickey_from_rsa writes `e` and `n` over each
# other without the leading zero an SSH mpint has.
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/net-libssh2-fixes.cmake" [=[
fix(
	"    size_t keylen = 0, mthlen = 0;\n    int ret;\n"
	"    size_t keylen = 0, mthlen = 0;\n    int ret = 0;\n"
)
fix(
	"    uint32_t e_bytes, n_bytes;\n"
	"    uint32_t e_bytes, n_bytes, e_pad, n_pad;\n"
)
fix(
	"    /* Key form is \"ssh-rsa\" + e + n. */\n    len = 4 + 7 + 4 + e_bytes + 4 + n_bytes;\n"
	"    /* Key form is \"ssh-rsa\" + e + n, mpints: a zero before a top bit. */\n    e_pad = mbedtls_mpi_bitlen(&rsa->MBEDTLS_PRIVATE(E)) % 8 == 0 ? 1 : 0;\n    n_pad = mbedtls_mpi_bitlen(&rsa->MBEDTLS_PRIVATE(N)) % 8 == 0 ? 1 : 0;\n    len = 4 + 7 + 4 + e_pad + e_bytes + 4 + n_pad + n_bytes;\n"
)
fix(
	"    _libssh2_htonu32(p, e_bytes);\n    p += 4;\n    mbedtls_mpi_write_binary(&rsa->MBEDTLS_PRIVATE(E), p, e_bytes);\n\n    _libssh2_htonu32(p, n_bytes);\n    p += 4;\n    mbedtls_mpi_write_binary(&rsa->MBEDTLS_PRIVATE(N), p, n_bytes);\n"
	"    _libssh2_htonu32(p, e_pad + e_bytes);\n    p += 4;\n    if(e_pad)\n        *p++ = 0;\n    mbedtls_mpi_write_binary(&rsa->MBEDTLS_PRIVATE(E), p, e_bytes);\n    p += e_bytes;\n\n    _libssh2_htonu32(p, n_pad + n_bytes);\n    p += 4;\n    if(n_pad)\n        *p++ = 0;\n    mbedtls_mpi_write_binary(&rsa->MBEDTLS_PRIVATE(N), p, n_bytes);\n    p += n_bytes;\n"
)
]=])
file(SHA256 "${CMAKE_CURRENT_BINARY_DIR}/net-libssh2-fixes.cmake" NET_LIBSSH2_FIX_HASH)

# curl 8.22 reads CURLOPT_KEYPASSWD for SSH when it sets the connection up,
# before the option has reached the SSL config it reads it from, so an SSH
# key's passphrase never gets to libssh2: it is read from the option itself.
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/net-curl-fixes.cmake" [=[
fix(
	"    sshc->passphrase = data->set.ssl.primary.key_passwd;\n"
	"    sshc->passphrase = data->set.ssl.primary.key_passwd;\n    if(!sshc->passphrase)\n      sshc->passphrase = CURL_EASY_STR(data, STRING_KEY_PASSWD);\n"
)
]=])
file(SHA256 "${CMAKE_CURRENT_BINARY_DIR}/net-curl-fixes.cmake" NET_CURL_FIX_HASH)

ExternalProject_Add(net_libssh2
	DEPENDS net_mbedtls
	URL "https://github.com/libssh2/libssh2/releases/download/libssh2-${NET_LIBSSH2_VERSION}/libssh2-${NET_LIBSSH2_VERSION}.tar.xz"
	URL_HASH SHA256=${NET_LIBSSH2_SHA256}
	DOWNLOAD_EXTRACT_TIMESTAMP ON
	PATCH_COMMAND ${CMAKE_COMMAND} -DSOURCE=<SOURCE_DIR>/src/mbedtls.c -DFIXES=${CMAKE_CURRENT_BINARY_DIR}/net-libssh2-fixes.cmake
		-DHASH=${NET_LIBSSH2_FIX_HASH} -P ${CMAKE_CURRENT_BINARY_DIR}/net-fix.cmake
	CMAKE_ARGS ${NET_ARGS}
		-DBUILD_STATIC_LIBS=ON
		-DBUILD_EXAMPLES=OFF
		-DCRYPTO_BACKEND=mbedTLS
		-DMBEDTLS_INCLUDE_DIR=${NET}/include
		-DMBEDCRYPTO_LIBRARY=${NET_MBEDCRYPTO}
		-DENABLE_ZLIB_COMPRESSION=OFF
		-DLIBSSH2_NO_DEPRECATED=ON
	BUILD_COMMAND ${NET_BUILD}
	INSTALL_COMMAND ${NET_INSTALL}
	BUILD_BYPRODUCTS ${NET_LIBSSH2}
)

ExternalProject_Add(net_curl
	DEPENDS net_mbedtls net_libssh2
	URL "https://curl.se/download/curl-${NET_CURL_VERSION}.tar.xz"
	URL_HASH SHA256=${NET_CURL_SHA256}
	DOWNLOAD_EXTRACT_TIMESTAMP ON
	PATCH_COMMAND ${CMAKE_COMMAND} -DSOURCE=<SOURCE_DIR>/lib/vssh/vssh.c -DFIXES=${CMAKE_CURRENT_BINARY_DIR}/net-curl-fixes.cmake
		-DHASH=${NET_CURL_FIX_HASH} -P ${CMAKE_CURRENT_BINARY_DIR}/net-fix.cmake
	CMAKE_ARGS ${NET_ARGS}
		-DBUILD_STATIC_LIBS=ON
		-DBUILD_CURL_EXE=OFF
		-DBUILD_LIBCURL_DOCS=OFF
		-DBUILD_MISC_DOCS=OFF
		-DENABLE_CURL_MANUAL=OFF
		-DBUILD_EXAMPLES=OFF
		-DCURL_USE_PKGCONFIG=OFF
		-DCURL_USE_CMAKECONFIG=OFF
		-DCURL_ENABLE_EXPORT_TARGET=ON
		-DCURL_USE_MBEDTLS=ON
		-DCURL_USE_OPENSSL=OFF
		-DCURL_USE_SCHANNEL=OFF
		-DCURL_WINDOWS_SSPI=OFF
		-DMBEDTLS_INCLUDE_DIR=${NET}/include
		-DMBEDTLS_LIBRARY=${NET_MBEDTLS}
		-DMBEDX509_LIBRARY=${NET_MBEDX509}
		-DMBEDCRYPTO_LIBRARY=${NET_MBEDCRYPTO}
		-DHAVE_MBEDTLS_DES_CRYPT_ECB=0
		-DCURL_USE_LIBSSH2=ON
		-DLIBSSH2_INCLUDE_DIR=${NET}/include
		-DLIBSSH2_LIBRARY=${NET_LIBSSH2}
		-DCURL_USE_LIBSSH=OFF
		-DCURL_USE_LIBPSL=OFF
		-DCURL_USE_GSSAPI=OFF
		-DCURL_ZLIB=OFF
		-DCURL_BROTLI=OFF
		-DCURL_ZSTD=OFF
		-DUSE_NGHTTP2=OFF
		-DUSE_LIBIDN2=OFF
		-DUSE_WIN32_IDN=OFF
		-DENABLE_ARES=OFF
		-DENABLE_UNIX_SOCKETS=OFF
		-DCURL_CA_BUNDLE=none
		-DCURL_CA_PATH=none
		-DCURL_DISABLE_ALTSVC=ON
		-DCURL_DISABLE_AWS=ON
		-DCURL_DISABLE_BINDLOCAL=ON
		-DCURL_DISABLE_COOKIES=ON
		-DCURL_DISABLE_DICT=ON
		-DCURL_DISABLE_DIGEST_AUTH=ON
		-DCURL_DISABLE_DOH=ON
		-DCURL_DISABLE_FILE=ON
		-DCURL_DISABLE_FORM_API=ON
		-DCURL_DISABLE_GETOPTIONS=ON
		-DCURL_DISABLE_GOPHER=ON
		-DCURL_DISABLE_HEADERS_API=ON
		-DCURL_DISABLE_HSTS=ON
		-DCURL_DISABLE_IMAP=ON
		-DCURL_DISABLE_IPFS=ON
		-DCURL_DISABLE_KERBEROS_AUTH=ON
		-DCURL_DISABLE_LDAP=ON
		-DCURL_DISABLE_LDAPS=ON
		-DCURL_DISABLE_MIME=ON
		-DCURL_DISABLE_MQTT=ON
		-DCURL_DISABLE_NEGOTIATE_AUTH=ON
		-DCURL_DISABLE_NETRC=ON
		-DCURL_DISABLE_POP3=ON
		-DCURL_DISABLE_PROGRESS_METER=ON
		-DCURL_DISABLE_RTSP=ON
		-DCURL_DISABLE_SMTP=ON
		-DCURL_DISABLE_TELNET=ON
		-DCURL_DISABLE_TFTP=ON
		-DCURL_DISABLE_VERBOSE_STRINGS=ON
		-DCURL_DISABLE_WEBSOCKETS=ON
		-DCURL_ENABLE_NTLM=OFF
		-DCURL_ENABLE_SMB=OFF
	BUILD_COMMAND ${NET_BUILD}
	INSTALL_COMMAND ${NET_INSTALL}
	BUILD_BYPRODUCTS ${NET_CURL}
)

# Mozilla's certificate authorities as a C array (net_cacert.h), made once
# when the module is configured.
set(NET_CACERT "${NET}/cacert-${NET_CACERT_DATE}.pem")
set(NET_CACERT_HEADER "${NET}/include/net_cacert.h")
if(NOT EXISTS "${NET_CACERT_HEADER}")
	file(DOWNLOAD "https://curl.se/ca/cacert-${NET_CACERT_DATE}.pem" "${NET_CACERT}"
		EXPECTED_HASH SHA256=${NET_CACERT_SHA256} TLS_VERIFY ON STATUS fetched)
	list(GET fetched 0 code)
	if(NOT code EQUAL 0)
		message(FATAL_ERROR "could not download Mozilla's CA list (curl.se/ca/cacert-${NET_CACERT_DATE}.pem): ${fetched}")
	endif()
	file(READ "${NET_CACERT}" hex HEX)
	string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," bytes "${hex}")
	string(REGEX REPLACE "((0x..,){32})" "\\1\n" bytes "${bytes}")
	file(WRITE "${NET_CACERT_HEADER}.tmp"
		"// Mozilla's certificate authorities, ${NET_CACERT_DATE}, from curl.se/ca - written by runtime/network.cmake\n"
		"static const unsigned char g_cacert[] = {\n${bytes}0x00\n};\n")
	file(RENAME "${NET_CACERT_HEADER}.tmp" "${NET_CACERT_HEADER}")
endif()

add_library(net INTERFACE)
add_dependencies(net net_curl)
target_include_directories(net INTERFACE "${NET}/include")
target_compile_definitions(net INTERFACE CURL_STATICLIB)
target_link_libraries(net INTERFACE ${NET_CURL} ${NET_LIBSSH2} ${NET_MBEDTLS} ${NET_MBEDX509} ${NET_MBEDCRYPTO})
if(WIN32)
	target_link_libraries(net INTERFACE ws2_32 bcrypt crypt32 iphlpapi advapi32)
else()
	target_link_libraries(net INTERFACE pthread)
endif()
