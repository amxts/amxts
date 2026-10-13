// The database client: a plugin's `Database` reaches MySQL (and MariaDB, which
// speaks the same protocol) through a client of the MySQL client/server
// protocol written here, over the module's own mbedTLS - no MySQL library, so
// nothing GPL or LGPL is linked. The protocol is MySQL's public description of
// it (dev.mysql.com, "Client/Server Protocol").
//
// A database address is a pool: one connection for the plugins' queries, and
// up to DB_MAX_TRANSACTIONS more, each held by one transaction while it runs.
// Every connection has a thread of its own and a queue, so the queries of one
// connection run in the order they were sent and the game never waits on
// them; what has ended comes back once a frame (DbFrame, from server_frame),
// where the plugin's callback is called with the query's id and reads the
// outcome (db_status, db_text) before it lets the query go (db_close).
//
// The pools outlive a map: a plugin of the next map that opens the same
// address gets the same connections. A connection idle for a while is pinged
// before its next query and opened again when the ping fails; one lost in the
// middle of a query fails that query, which is not sent again - an INSERT the
// server may have run is not run twice.
//
// Who touches what: the pools, the transactions and the queries' map are the
// game thread's; a connection's queue is shared with its thread under its
// lock; a query is its connection's while it is queued and running, and the
// game thread's again once it is in g_dbDone.
//
// Included by module.cpp after network.h (g_cacert), Fire, Inst and CopyText.
#pragma once

#include <cerrno>
#include <chrono>
#include <deque>

#include <mbedtls/base64.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/error.h>
#include <mbedtls/net_sockets.h>
#include <mbedtls/pk.h>
#include <mbedtls/rsa.h>
#include <mbedtls/sha1.h>
#include <mbedtls/sha256.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>
#include <psa/crypto.h>

#ifdef _WIN32
typedef SOCKET DbSocket;
#define DB_NO_SOCKET INVALID_SOCKET
#else
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
typedef int DbSocket;
#define DB_NO_SOCKET -1
#endif

// How long opening a connection may take, and how long the server may stay
// silent in the middle of a query before the query fails.
#define DB_CONNECT_TIMEOUT_MS 10000
#define DB_READ_TIMEOUT_MS    60000
// A connection unused this long is pinged before its next query.
#define DB_IDLE_PING_MS 60000
// The connections a pool opens for transactions; a transaction past them
// waits for one to end.
#define DB_MAX_TRANSACTIONS 4
// The most a result may hold, as a fetch response.
#define DB_MAX_RESULT (64 * 1024 * 1024)
// Prepared statements a connection keeps; past it they are all closed.
#define DB_MAX_STATEMENTS 256

// What a query is: db_query's `kind`.
#define DB_QUERY    0   // rows, as JSON
#define DB_EXECUTE  1   // { insertId, affectedRows }, as JSON
#define DB_BEGIN    2   // a transaction: its id is the query's
#define DB_COMMIT   3
#define DB_ROLLBACK 4

// What db_text reads.
#define DB_TEXT_RESULT 0   // the result, or the error's message
#define DB_TEXT_STATE  1   // the error's SQLSTATE

// A query's status: 0 when it ran, the server's error code (1062) when the
// server refused it, DB_CLIENT_ERROR when it did not reach the server or the
// connection was lost.
#define DB_CLIENT_ERROR (-1)

// ssl-mode=, as MySQL's own clients name the modes.
#define DB_SSL_DISABLED        0
#define DB_SSL_PREFERRED       1
#define DB_SSL_REQUIRED        2
#define DB_SSL_VERIFY_CA       3
#define DB_SSL_VERIFY_IDENTITY 4

// The protocol's capability flags the client uses.
#define DB_CLIENT_LONG_PASSWORD     0x00000001u
#define DB_CLIENT_FOUND_ROWS        0x00000002u
#define DB_CLIENT_LONG_FLAG         0x00000004u
#define DB_CLIENT_CONNECT_WITH_DB   0x00000008u
#define DB_CLIENT_PROTOCOL_41       0x00000200u
#define DB_CLIENT_SSL               0x00000800u
#define DB_CLIENT_TRANSACTIONS      0x00002000u
#define DB_CLIENT_SECURE_CONNECTION 0x00008000u
#define DB_CLIENT_MULTI_RESULTS     0x00020000u
#define DB_CLIENT_PLUGIN_AUTH       0x00080000u
#define DB_CLIENT_PLUGIN_AUTH_LENENC_DATA 0x00200000u

#define DB_SERVER_MORE_RESULTS_EXISTS 0x0008
#define DB_COLLATION_UTF8MB4 45   // utf8mb4_general_ci, which MySQL and MariaDB both know
#define DB_MAX_PACKET 0x01000000u

// Column types (MYSQL_TYPE_*) and the column flag the client reads.
#define DB_TYPE_DECIMAL     0
#define DB_TYPE_TINY        1
#define DB_TYPE_SHORT       2
#define DB_TYPE_LONG        3
#define DB_TYPE_FLOAT       4
#define DB_TYPE_DOUBLE      5
#define DB_TYPE_NULL        6
#define DB_TYPE_TIMESTAMP   7
#define DB_TYPE_LONGLONG    8
#define DB_TYPE_INT24       9
#define DB_TYPE_DATE        10
#define DB_TYPE_TIME        11
#define DB_TYPE_DATETIME    12
#define DB_TYPE_YEAR        13
#define DB_TYPE_VARCHAR     15
#define DB_TYPE_BIT         16
#define DB_TYPE_NEWDECIMAL  246
#define DB_TYPE_TINY_BLOB   249
#define DB_TYPE_BLOB        252
#define DB_TYPE_VAR_STRING  253
#define DB_TYPE_STRING      254
#define DB_UNSIGNED_FLAG    0x0020
#define DB_BINARY_CHARSET   63   // the character set of bytes: BLOB, BINARY, VARBINARY

// The commands sent.
#define DB_COM_QUIT         0x01
#define DB_COM_QUERY        0x03
#define DB_COM_PING         0x0e
#define DB_COM_STMT_PREPARE 0x16
#define DB_COM_STMT_EXECUTE 0x17
#define DB_COM_STMT_CLOSE   0x19

struct DbConn;
struct DbPool;

struct DbQuery {
	int32_t            id;
	wasm_module_inst_t inst;   // the plugin that sent it; NULL for the module's own ROLLBACK
	uint32_t           fn;     // its callback, (id) -> void
	int                kind;
	int32_t            tx;     // the transaction it runs in; 0 for none
	std::string        sql;
	std::string        params;   // the values of its `?`, as a JSON array
	bool               ended;
	bool               cancelled;

	// The outcome.
	int32_t     status;
	std::string result;
	std::string sqlState;

	DbQuery() : id(0), inst(NULL), fn(0), kind(DB_QUERY), tx(0), ended(false), cancelled(false), status(0) {}
};

/** What the address says: where, who, which database, how. */
struct DbConfig {
	std::string host;
	std::string port;
	std::string user;
	std::string password;
	std::string database;
	int         sslMode;
};

/** A statement prepared on a connection: its id and how many `?` it has. */
struct DbStatement {
	uint32_t id;
	uint16_t params;
};

/** A column of a result: what is needed to write its values as JSON. */
struct DbColumn {
	std::string key;   // `"name":`, written before each of its values
	uint8_t     type;
	uint16_t    charset;
	uint16_t    flags;
	uint8_t     decimals;
};

struct DbConn {
	DbPool                *pool;
	std::thread           *thread;
	std::mutex             lock;
	std::condition_variable wake;
	std::deque<DbQuery *>  queue;   // under `lock`
	bool                   stop;    // under `lock`
	int32_t                heldBy;  // the game thread's: the transaction holding it, 0 for none

	// The thread's.
	DbSocket             socket;
	bool                 tls;
	mbedtls_ssl_context  ssl;
	mbedtls_ssl_config   sslConfig;
	bool                 sslReady;
	std::string          in;       // what was received and not read yet
	size_t               inAt;
	uint8_t              seq;      // the next packet's sequence id
	std::string          error;    // why the connection failed, for the query's message
	DbQuery              refusal;  // the server's error when it refused to sign in: its code, SQLSTATE and message
	std::map<std::string, DbStatement> statements;
	std::chrono::steady_clock::time_point used;
	bool                 inTransaction;   // a BEGIN ran, no COMMIT or ROLLBACK yet
	bool                 lostTransaction; // the connection went in the middle of one

	DbConn(DbPool *p)
		: pool(p), thread(NULL), stop(false), heldBy(0), socket(DB_NO_SOCKET), tls(false), sslReady(false), inAt(0), seq(0),
		  inTransaction(false), lostTransaction(false) {}
};

struct DbPool {
	int32_t               id;
	DbConfig              config;
	DbConn               *main;
	std::vector<DbConn *> spare;   // the transactions' connections
	std::deque<DbQuery *> waiting; // BEGINs waiting for a connection
};

// The game thread's.
static std::map<std::string, DbPool *> g_dbPools;     // by address
static std::map<int32_t, DbPool *>     g_dbPoolIds;
static std::map<int32_t, DbQuery *>    g_dbQueries;   // what plugins hold, by id
static std::map<int32_t, DbConn *>     g_dbTransactions;  // a transaction's connection, NULL while it waits
static std::map<int32_t, DbPool *>     g_dbTransactionPools;
static int32_t g_dbNextId = 1;
static int32_t g_dbNextPool = 1;

// Between the threads, under g_dbLock.
static std::mutex             g_dbLock;
static std::vector<DbQuery *> g_dbDone;

// The randomness TLS and RSA take, made once on the game thread and used
// under its lock: connections open rarely.
static mbedtls_entropy_context  g_dbEntropy;
static mbedtls_ctr_drbg_context g_dbRandom;
static mbedtls_x509_crt         g_dbAuthorities;
static std::mutex               g_dbRandomLock;
static bool                     g_dbCryptoReady = false;

// ---------------------------------------------------------------- text

/** Appends `text` as a JSON string: quoted, with `"`, `\` and control characters escaped. */
static void DbJsonText(std::string &out, const char *text, size_t length)
{
	out += '"';
	for (size_t i = 0; i < length; i++) {
		unsigned char c = (unsigned char)text[i];
		if (c == '"' || c == '\\') {
			out += '\\';
			out += (char)c;
		}
		else if (c < 0x20) {
			char escape[8];
			snprintf(escape, sizeof(escape), "\\u%04x", c);
			out += escape;
		}
		else out += (char)c;
	}
	out += '"';
}

/** Appends bytes as a JSON string of their base64: how the facade reads a Uint8Array. */
static void DbJsonBytes(std::string &out, const char *bytes, size_t length)
{
	size_t at = out.size() + 1, written = 0;
	out.resize(at + (length + 2) / 3 * 4 + 2);
	mbedtls_base64_encode((unsigned char *)&out[at], out.size() - at, &written, (const unsigned char *)bytes, length);
	out[at - 1] = '"';
	out.resize(at + written);
	out += '"';
}

/** Appends a floating-point number as the shortest text that reads back as it; null when it is not finite. */
static void DbJsonDouble(std::string &out, double value, bool single)
{
	if (value != value || value - value != 0) {
		out += "null";
		return;
	}
	char text[40];
	for (int precision = single ? 6 : 15; precision <= (single ? 9 : 17); precision++) {
		snprintf(text, sizeof(text), "%.*g", precision, value);
		double back = strtod(text, NULL);
		if (single ? (float)back == (float)value : back == value)
			break;
	}
	out += text;
}

/** Decodes `%xx` in a part of an address. */
static std::string DbUnescape(const std::string &text)
{
	std::string out;
	for (size_t i = 0; i < text.size(); i++) {
		if (text[i] == '%' && i + 2 < text.size() && isxdigit((unsigned char)text[i + 1]) && isxdigit((unsigned char)text[i + 2])) {
			out += (char)strtol(text.substr(i + 1, 2).c_str(), NULL, 16);
			i += 2;
		}
		else out += text[i];
	}
	return out;
}

/**
 * Reads `mysql://user:password@host:port/database?ssl-mode=...` into `config`;
 * false when it is not such an address.
 */
static bool DbParseUrl(const std::string &url, DbConfig &config)
{
	const std::string scheme = "mysql://";
	if (url.compare(0, scheme.size(), scheme) != 0)
		return false;
	std::string rest = url.substr(scheme.size());

	std::string query;
	size_t mark = rest.find('?');
	if (mark != std::string::npos) {
		query = rest.substr(mark + 1);
		rest = rest.substr(0, mark);
	}
	size_t slash = rest.find('/');
	std::string authority = rest.substr(0, slash);
	config.database = slash == std::string::npos ? "" : DbUnescape(rest.substr(slash + 1));

	size_t at = authority.rfind('@');
	if (at != std::string::npos) {
		std::string userinfo = authority.substr(0, at);
		authority = authority.substr(at + 1);
		size_t colon = userinfo.find(':');
		config.user = DbUnescape(userinfo.substr(0, colon));
		config.password = colon == std::string::npos ? "" : DbUnescape(userinfo.substr(colon + 1));
	}

	config.port = "3306";
	if (!authority.empty() && authority[0] == '[') {
		size_t close = authority.find(']');
		if (close == std::string::npos)
			return false;
		config.host = authority.substr(1, close - 1);
		if (close + 1 < authority.size() && authority[close + 1] == ':')
			config.port = authority.substr(close + 2);
	}
	else {
		size_t colon = authority.rfind(':');
		config.host = authority.substr(0, colon);
		if (colon != std::string::npos)
			config.port = authority.substr(colon + 1);
	}
	if (config.host.empty() || config.port.empty() || config.port.find_first_not_of("0123456789") != std::string::npos)
		return false;

	config.sslMode = DB_SSL_PREFERRED;
	size_t start = 0;
	while (start < query.size()) {
		size_t end = query.find('&', start);
		std::string pair = query.substr(start, end == std::string::npos ? std::string::npos : end - start);
		start = end == std::string::npos ? query.size() : end + 1;
		size_t equals = pair.find('=');
		std::string name = pair.substr(0, equals);
		std::string value = equals == std::string::npos ? "" : DbUnescape(pair.substr(equals + 1));
		for (size_t i = 0; i < value.size(); i++)
			value[i] = (char)tolower((unsigned char)(value[i] == '_' ? '-' : value[i]));
		if (name != "ssl-mode" && name != "sslmode")
			return false;
		if (value == "disabled") config.sslMode = DB_SSL_DISABLED;
		else if (value == "preferred") config.sslMode = DB_SSL_PREFERRED;
		else if (value == "required") config.sslMode = DB_SSL_REQUIRED;
		else if (value == "verify-ca") config.sslMode = DB_SSL_VERIFY_CA;
		else if (value == "verify-identity") config.sslMode = DB_SSL_VERIFY_IDENTITY;
		else return false;
	}
	return true;
}

// ---------------------------------------------------------------- the socket

static void DbCloseSocket(DbSocket s)
{
#ifdef _WIN32
	closesocket(s);
#else
	close(s);
#endif
}

/** Opens a TCP connection to the pool's host within DB_CONNECT_TIMEOUT_MS; false with `c->error` when it cannot. */
static bool DbOpenSocket(DbConn *c)
{
	const DbConfig &config = c->pool->config;
	struct addrinfo hints, *found = NULL;
	memset(&hints, 0, sizeof(hints));
	hints.ai_family = AF_UNSPEC;
	hints.ai_socktype = SOCK_STREAM;
	hints.ai_protocol = IPPROTO_TCP;
	if (getaddrinfo(config.host.c_str(), config.port.c_str(), &hints, &found) != 0 || !found) {
		c->error = "could not resolve host " + config.host;
		return false;
	}

	c->error = "could not connect to " + config.host + ":" + config.port;
	for (struct addrinfo *a = found; a; a = a->ai_next) {
		DbSocket s = socket(a->ai_family, a->ai_socktype, a->ai_protocol);
		if (s == DB_NO_SOCKET)
			continue;
		bool open = false;
#ifdef _WIN32
		u_long nonBlocking = 1;
		ioctlsocket(s, FIONBIO, &nonBlocking);
		if (connect(s, a->ai_addr, (int)a->ai_addrlen) == 0 || WSAGetLastError() == WSAEWOULDBLOCK) {
			fd_set writable, failed;
			FD_ZERO(&writable);
			FD_ZERO(&failed);
			FD_SET(s, &writable);
			FD_SET(s, &failed);
			struct timeval wait = { DB_CONNECT_TIMEOUT_MS / 1000, 0 };
			open = select(0, NULL, &writable, &failed, &wait) > 0 && FD_ISSET(s, &writable);
		}
		nonBlocking = 0;
		ioctlsocket(s, FIONBIO, &nonBlocking);
		DWORD timeout = DB_READ_TIMEOUT_MS;
		setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeout, sizeof(timeout));
		setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, (const char *)&timeout, sizeof(timeout));
#else
		int flags = fcntl(s, F_GETFL, 0);
		fcntl(s, F_SETFL, flags | O_NONBLOCK);
		if (connect(s, a->ai_addr, a->ai_addrlen) == 0 || errno == EINPROGRESS) {
			struct pollfd p = { s, POLLOUT, 0 };
			int problem = 0;
			socklen_t size = sizeof(problem);
			open = poll(&p, 1, DB_CONNECT_TIMEOUT_MS) > 0 && getsockopt(s, SOL_SOCKET, SO_ERROR, &problem, &size) == 0 && problem == 0;
		}
		fcntl(s, F_SETFL, flags);
		struct timeval timeout = { DB_READ_TIMEOUT_MS / 1000, 0 };
		setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
		setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
#endif
		if (!open) {
			DbCloseSocket(s);
			continue;
		}
		int on = 1;
		setsockopt(s, IPPROTO_TCP, TCP_NODELAY, (const char *)&on, sizeof(on));
		c->socket = s;
		break;
	}
	freeaddrinfo(found);
	return c->socket != DB_NO_SOCKET;
}

static int DbSocketSend(void *context, const unsigned char *data, size_t length)
{
	DbConn *c = (DbConn *)context;
	int sent = send(c->socket, (const char *)data, (int)length, 0);
	return sent < 0 ? MBEDTLS_ERR_NET_SEND_FAILED : sent;
}

static int DbSocketReceive(void *context, unsigned char *data, size_t length)
{
	DbConn *c = (DbConn *)context;
	int got = recv(c->socket, (char *)data, (int)length, 0);
	if (got == 0)
		return MBEDTLS_ERR_NET_CONN_RESET;
	return got < 0 ? MBEDTLS_ERR_NET_RECV_FAILED : got;
}

/** Closes the connection; it opens again for the next query. */
static void DbDisconnect(DbConn *c)
{
	if (c->sslReady) {
		mbedtls_ssl_free(&c->ssl);
		mbedtls_ssl_config_free(&c->sslConfig);
		c->sslReady = false;
	}
	if (c->socket != DB_NO_SOCKET) {
		DbCloseSocket(c->socket);
		c->socket = DB_NO_SOCKET;
	}
	c->tls = false;
	c->in.clear();
	c->inAt = 0;
	c->statements.clear();
	if (c->inTransaction)
		c->lostTransaction = true;
	c->inTransaction = false;
}

/** Whether a TLS call is to be made again: it wants the socket, or it read a TLS 1.3 session ticket. */
static bool DbRetry(int result)
{
#ifdef MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET
	if (result == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET)
		return true;
#endif
	return result == MBEDTLS_ERR_SSL_WANT_READ || result == MBEDTLS_ERR_SSL_WANT_WRITE;
}

/** Sends `length` bytes, through TLS once it is up; false with `c->error` when the connection fails. */
static bool DbSend(DbConn *c, const char *data, size_t length)
{
	while (length > 0) {
		int sent = c->tls ? mbedtls_ssl_write(&c->ssl, (const unsigned char *)data, length)
			: DbSocketSend(c, (const unsigned char *)data, length);
		if (DbRetry(sent))
			continue;
		if (sent <= 0) {
			c->error = "the connection to the database was lost";
			return false;
		}
		data += sent;
		length -= (size_t)sent;
	}
	return true;
}

/** Reads exactly `length` bytes into `out`; false with `c->error` when the connection fails or the server is silent too long. */
static bool DbReceive(DbConn *c, size_t length, std::string &out)
{
	while (c->in.size() - c->inAt < length) {
		if (c->inAt > 0) {
			c->in.erase(0, c->inAt);
			c->inAt = 0;
		}
		unsigned char buffer[16384];
		int got = c->tls ? mbedtls_ssl_read(&c->ssl, buffer, sizeof(buffer)) : DbSocketReceive(c, buffer, sizeof(buffer));
		if (DbRetry(got))
			continue;
		if (got <= 0) {
			c->error = "the connection to the database was lost";
			return false;
		}
		c->in.append((const char *)buffer, (size_t)got);
	}
	out.assign(c->in, c->inAt, length);
	c->inAt += length;
	return true;
}

// ---------------------------------------------------------------- packets

/** Reads a packet's payload - the parts of one larger than 16 MB joined; false with `c->error` when the connection fails. */
static bool DbReadPacket(DbConn *c, std::string &payload)
{
	payload.clear();
	for (;;) {
		std::string header, part;
		if (!DbReceive(c, 4, header))
			return false;
		size_t length = (unsigned char)header[0] | ((unsigned char)header[1] << 8) | ((unsigned char)header[2] << 16);
		c->seq = (uint8_t)((unsigned char)header[3] + 1);
		if (!DbReceive(c, length, part))
			return false;
		payload += part;
		if (length < 0xffffff)
			return true;
	}
}

/** Sends a payload as packets of at most 16 MB; false with `c->error` when the connection fails. */
static bool DbWritePacket(DbConn *c, const std::string &payload)
{
	size_t at = 0;
	for (;;) {
		size_t length = payload.size() - at;
		if (length > 0xffffff)
			length = 0xffffff;
		char header[4] = { (char)(length & 0xff), (char)((length >> 8) & 0xff), (char)((length >> 16) & 0xff), (char)c->seq++ };
		if (!DbSend(c, header, 4) || !DbSend(c, payload.data() + at, length))
			return false;
		at += length;
		if (length < 0xffffff)
			return true;
	}
}

/** Reads the protocol's numbers and texts off a payload, past its end as zeros. */
struct DbReader {
	const std::string &data;
	size_t at;

	DbReader(const std::string &d, size_t start = 0) : data(d), at(start) {}

	bool more() const { return at < data.size(); }

	uint64_t fixed(int bytes)
	{
		uint64_t value = 0;
		for (int i = 0; i < bytes; i++, at++)
			if (at < data.size())
				value |= (uint64_t)(unsigned char)data[at] << (8 * i);
		return value;
	}

	/** A length-encoded integer; `null` is set for 0xfb, a NULL in a text row. */
	uint64_t lenenc(bool *null = NULL)
	{
		if (null)
			*null = false;
		if (at >= data.size())
			return 0;
		unsigned char first = (unsigned char)data[at++];
		if (first < 0xfb) return first;
		if (first == 0xfb) {
			if (null)
				*null = true;
			return 0;
		}
		if (first == 0xfc) return fixed(2);
		if (first == 0xfd) return fixed(3);
		return fixed(8);
	}

	std::string bytes(size_t length)
	{
		size_t start = at < data.size() ? at : data.size();
		size_t n = start + length <= data.size() ? length : data.size() - start;
		at += length;
		return data.substr(start, n);
	}

	std::string text() { return bytes((size_t)lenenc()); }

	std::string untilNul()
	{
		size_t start = at < data.size() ? at : data.size();
		size_t end = data.find('\0', start);
		if (end == std::string::npos)
			end = data.size();
		at = end + 1;
		return data.substr(start, end - start);
	}

	std::string rest() { return at < data.size() ? data.substr(at) : std::string(); }
};

static void DbPutFixed(std::string &out, uint64_t value, int bytes)
{
	for (int i = 0; i < bytes; i++)
		out += (char)((value >> (8 * i)) & 0xff);
}

static void DbPutLenenc(std::string &out, uint64_t value)
{
	if (value < 0xfb) out += (char)value;
	else if (value <= 0xffff) { out += (char)0xfc; DbPutFixed(out, value, 2); }
	else if (value <= 0xffffff) { out += (char)0xfd; DbPutFixed(out, value, 3); }
	else { out += (char)0xfe; DbPutFixed(out, value, 8); }
}

/** A query refused by the server: its code, SQLSTATE and message from an ERR packet. */
static void DbServerError(DbQuery *q, const std::string &packet)
{
	DbReader r(packet, 1);
	q->status = (int32_t)r.fixed(2);
	if (r.more() && packet[r.at] == '#') {
		r.at++;
		q->sqlState = r.bytes(5);
	}
	q->result = r.rest();
}

static void DbClientError(DbQuery *q, const std::string &message)
{
	q->status = DB_CLIENT_ERROR;
	q->sqlState.clear();
	q->result = message;
}

// ---------------------------------------------------------------- signing in

static void DbCryptoInit()
{
	if (g_dbCryptoReady)
		return;
	psa_crypto_init();
	mbedtls_entropy_init(&g_dbEntropy);
	mbedtls_ctr_drbg_init(&g_dbRandom);
	mbedtls_ctr_drbg_seed(&g_dbRandom, mbedtls_entropy_func, &g_dbEntropy, (const unsigned char *)"amxts-db", 8);
	mbedtls_x509_crt_init(&g_dbAuthorities);
	mbedtls_x509_crt_parse(&g_dbAuthorities, g_cacert, sizeof(g_cacert));
	g_dbCryptoReady = true;
}

static int DbRandom(void *context, unsigned char *out, size_t length)
{
	std::lock_guard<std::mutex> lock(g_dbRandomLock);
	return mbedtls_ctr_drbg_random(context, out, length);
}

/** mysql_native_password: SHA1(password) XOR SHA1(nonce + SHA1(SHA1(password))). */
static std::string DbNativeScramble(const std::string &password, const std::string &nonce)
{
	if (password.empty())
		return "";
	unsigned char once[20], twice[20], mixed[20];
	mbedtls_sha1((const unsigned char *)password.data(), password.size(), once);
	mbedtls_sha1(once, 20, twice);
	std::string salted = nonce + std::string((const char *)twice, 20);
	mbedtls_sha1((const unsigned char *)salted.data(), salted.size(), mixed);
	std::string out(20, '\0');
	for (int i = 0; i < 20; i++)
		out[i] = (char)(once[i] ^ mixed[i]);
	return out;
}

/** caching_sha2_password: SHA256(password) XOR SHA256(SHA256(SHA256(password)) + nonce). */
static std::string DbSha2Scramble(const std::string &password, const std::string &nonce)
{
	if (password.empty())
		return "";
	unsigned char once[32], twice[32], mixed[32];
	mbedtls_sha256((const unsigned char *)password.data(), password.size(), once, 0);
	mbedtls_sha256(once, 32, twice, 0);
	std::string salted = std::string((const char *)twice, 32) + nonce;
	mbedtls_sha256((const unsigned char *)salted.data(), salted.size(), mixed, 0);
	std::string out(32, '\0');
	for (int i = 0; i < 32; i++)
		out[i] = (char)(once[i] ^ mixed[i]);
	return out;
}

/**
 * caching_sha2_password's full sign-in without TLS: the password, ended with
 * a zero and mixed with the nonce, encrypted with the server's RSA key (OAEP).
 */
static bool DbRsaPassword(DbConn *c, const std::string &pem, const std::string &nonce, std::string &out)
{
	std::string text = c->pool->config.password + '\0';
	for (size_t i = 0; i < text.size(); i++)
		text[i] = (char)(text[i] ^ nonce[i % nonce.size()]);

	mbedtls_pk_context key;
	mbedtls_pk_init(&key);
	std::string terminated = pem + '\0';
	bool done = false;
	if (mbedtls_pk_parse_public_key(&key, (const unsigned char *)terminated.data(), terminated.size()) == 0 &&
	    mbedtls_pk_get_type(&key) == MBEDTLS_PK_RSA) {
		mbedtls_rsa_context *rsa = mbedtls_pk_rsa(key);
		mbedtls_rsa_set_padding(rsa, MBEDTLS_RSA_PKCS_V21, MBEDTLS_MD_SHA1);
		out.assign(mbedtls_rsa_get_len(rsa), '\0');
		done = mbedtls_rsa_rsaes_oaep_encrypt(rsa, DbRandom, &g_dbRandom, NULL, 0, text.size(),
			(const unsigned char *)text.data(), (unsigned char *)&out[0]) == 0;
	}
	mbedtls_pk_free(&key);
	if (!done)
		c->error = "could not encrypt the password with the server's RSA key";
	return done;
}

/** What a sign-in method sends for the password; mysql_native_password for one the client does not know. */
static std::string DbScramble(const std::string &method, const std::string &password, const std::string &nonce)
{
	return method == "caching_sha2_password" ? DbSha2Scramble(password, nonce) : DbNativeScramble(password, nonce);
}

/** The server refused to sign in: its error is the connection's. */
static void DbRefused(DbConn *c, const DbQuery &refused)
{
	c->refusal = refused;
	c->error = refused.result;
}

/** Turns the connection to TLS, checking the server's certificate as the address's ssl-mode says. */
static bool DbStartTls(DbConn *c)
{
	const DbConfig &config = c->pool->config;
	mbedtls_ssl_init(&c->ssl);
	mbedtls_ssl_config_init(&c->sslConfig);
	c->sslReady = true;
	bool verify = config.sslMode >= DB_SSL_VERIFY_CA;
	if (mbedtls_ssl_config_defaults(&c->sslConfig, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT) != 0) {
		c->error = "could not set TLS up";
		return false;
	}
	mbedtls_ssl_conf_rng(&c->sslConfig, DbRandom, &g_dbRandom);
	mbedtls_ssl_conf_authmode(&c->sslConfig, verify ? MBEDTLS_SSL_VERIFY_REQUIRED : MBEDTLS_SSL_VERIFY_NONE);
	mbedtls_ssl_conf_ca_chain(&c->sslConfig, &g_dbAuthorities, NULL);
	if (mbedtls_ssl_setup(&c->ssl, &c->sslConfig) != 0 ||
	    mbedtls_ssl_set_hostname(&c->ssl, config.sslMode == DB_SSL_VERIFY_IDENTITY ? config.host.c_str() : NULL) != 0) {
		c->error = "could not set TLS up";
		return false;
	}
	mbedtls_ssl_set_bio(&c->ssl, c, DbSocketSend, DbSocketReceive, NULL);
	int result;
	while ((result = mbedtls_ssl_handshake(&c->ssl)) != 0) {
		if (DbRetry(result))
			continue;
		char reason[128];
		mbedtls_strerror(result, reason, sizeof(reason));
		c->error = mbedtls_ssl_get_verify_result(&c->ssl) != 0 && verify
			? "the database server's certificate is not trusted"
			: std::string("TLS with the database server failed: ") + reason;
		return false;
	}
	c->tls = true;
	return true;
}

/**
 * Opens the connection and signs in: the server's greeting, TLS when the
 * ssl-mode asks for it or the server offers it, the password by the method
 * the user has. False with `c->error` - the server's message when it refused.
 */
static bool DbConnect(DbConn *c)
{
	const DbConfig &config = c->pool->config;
	c->error.clear();
	c->refusal.status = 0;
	if (!DbOpenSocket(c))
		return false;

	std::string packet;
	if (!DbReadPacket(c, packet))
		return false;
	DbReader hello(packet);
	if ((unsigned char)packet[0] == 0xff) {
		DbQuery refused;
		DbServerError(&refused, packet);
		DbRefused(c, refused);
		return false;
	}
	if (hello.fixed(1) != 10) {
		c->error = "the server does not speak the MySQL protocol";
		return false;
	}
	hello.untilNul();   // the server's version
	hello.fixed(4);     // the connection's id
	std::string nonce = hello.bytes(8);
	hello.fixed(1);
	uint32_t serverCaps = (uint32_t)hello.fixed(2);
	hello.fixed(1);     // its character set
	hello.fixed(2);     // its status
	serverCaps |= (uint32_t)hello.fixed(2) << 16;
	size_t nonceLength = (size_t)hello.fixed(1);
	hello.bytes(10);
	if (serverCaps & DB_CLIENT_SECURE_CONNECTION) {
		size_t more = nonceLength > 8 ? nonceLength - 8 : 13;
		std::string rest = hello.bytes(more < 13 ? 13 : more);
		nonce += rest;
	}
	std::string method = (serverCaps & DB_CLIENT_PLUGIN_AUTH) ? hello.untilNul() : "mysql_native_password";
	if (nonce.size() > 20)
		nonce.resize(20);
	if (method != "caching_sha2_password")
		method = "mysql_native_password";

	if (!(serverCaps & DB_CLIENT_PROTOCOL_41)) {
		c->error = "the database server is too old: MySQL 4.1 or later is needed";
		return false;
	}

	bool useTls = config.sslMode != DB_SSL_DISABLED && (serverCaps & DB_CLIENT_SSL);
	if (config.sslMode >= DB_SSL_REQUIRED && !useTls) {
		c->error = "the database server does not offer TLS, and ssl-mode requires it";
		return false;
	}

	uint32_t caps = DB_CLIENT_LONG_PASSWORD | DB_CLIENT_FOUND_ROWS | DB_CLIENT_LONG_FLAG | DB_CLIENT_PROTOCOL_41 |
		DB_CLIENT_TRANSACTIONS | DB_CLIENT_SECURE_CONNECTION | DB_CLIENT_MULTI_RESULTS | DB_CLIENT_PLUGIN_AUTH |
		DB_CLIENT_PLUGIN_AUTH_LENENC_DATA;
	if (!config.database.empty())
		caps |= DB_CLIENT_CONNECT_WITH_DB;
	if (useTls)
		caps |= DB_CLIENT_SSL;
	caps &= serverCaps;

	std::string greeting;
	DbPutFixed(greeting, caps, 4);
	DbPutFixed(greeting, DB_MAX_PACKET, 4);
	greeting += (char)DB_COLLATION_UTF8MB4;
	greeting.append(23, '\0');
	if (useTls) {
		if (!DbWritePacket(c, greeting) || !DbStartTls(c))
			return false;
	}

	std::string answer = DbScramble(method, config.password, nonce);
	std::string response = greeting;
	response += config.user;
	response += '\0';
	if (caps & DB_CLIENT_PLUGIN_AUTH_LENENC_DATA) DbPutLenenc(response, answer.size());
	else response += (char)answer.size();
	response += answer;
	if (caps & DB_CLIENT_CONNECT_WITH_DB) {
		response += config.database;
		response += '\0';
	}
	response += method;
	response += '\0';
	if (!DbWritePacket(c, response))
		return false;

	bool askedForKey = false;
	for (;;) {
		if (!DbReadPacket(c, packet))
			return false;
		unsigned char head = packet.empty() ? 0xff : (unsigned char)packet[0];
		if (head == 0x00)
			break;
		if (head == 0xff) {
			DbQuery refused;
			DbServerError(&refused, packet);
			DbRefused(c, refused);
			return false;
		}
		if (head == 0xfe) {
			// The server asks for another method, with a nonce of its own.
			DbReader change(packet, 1);
			method = change.untilNul();
			nonce = change.rest();
			if (!nonce.empty() && nonce[nonce.size() - 1] == '\0')
				nonce.resize(nonce.size() - 1);
			if (method != "caching_sha2_password" && method != "mysql_native_password") {
				c->error = "the database user signs in with " + method + ", which amxts does not support; "
					"use caching_sha2_password or mysql_native_password";
				return false;
			}
			if (!DbWritePacket(c, DbScramble(method, config.password, nonce)))
				return false;
			continue;
		}
		if (head == 0x01 && method == "caching_sha2_password") {
			if (askedForKey) {
				// The server's public key, as PEM.
				std::string encrypted;
				if (!DbRsaPassword(c, packet.substr(1), nonce, encrypted) || !DbWritePacket(c, encrypted))
					return false;
				continue;
			}
			if (packet.size() >= 2 && packet[1] == 3)
				continue;   // signed in from the server's cache: the OK follows
			if (packet.size() >= 2 && packet[1] == 4) {
				// The full sign-in: the password itself over TLS, else encrypted with the server's key.
				if (c->tls) {
					if (!DbWritePacket(c, config.password + '\0'))
						return false;
				}
				else {
					askedForKey = true;
					if (!DbWritePacket(c, std::string(1, '\x02')))
						return false;
				}
				continue;
			}
		}
		c->error = "the database server answered the sign-in with something amxts does not know";
		return false;
	}
	c->used = std::chrono::steady_clock::now();
	return true;
}

// ---------------------------------------------------------------- values

/** A value of a query's `?`: what the JSON array of them holds. */
struct DbParam {
	int         kind;   // 0 null, 1 boolean, 2 integer, 3 fraction, 4 text, 5 bytes
	int64_t     integer;
	double      fraction;
	std::string text;
};

/** Reads a JSON string at `at` (past its opening quote) into UTF-8. */
static bool DbJsonString(const std::string &json, size_t &at, std::string &out)
{
	while (at < json.size()) {
		char c = json[at++];
		if (c == '"')
			return true;
		if (c != '\\') {
			out += c;
			continue;
		}
		if (at >= json.size())
			return false;
		char e = json[at++];
		switch (e) {
			case 'n': out += '\n'; break;
			case 't': out += '\t'; break;
			case 'r': out += '\r'; break;
			case 'b': out += '\b'; break;
			case 'f': out += '\f'; break;
			case 'u': {
				if (at + 4 > json.size())
					return false;
				uint32_t code = (uint32_t)strtoul(json.substr(at, 4).c_str(), NULL, 16);
				at += 4;
				if (code >= 0xd800 && code < 0xdc00 && at + 6 <= json.size() && json[at] == '\\' && json[at + 1] == 'u') {
					uint32_t low = (uint32_t)strtoul(json.substr(at + 2, 4).c_str(), NULL, 16);
					if (low >= 0xdc00 && low < 0xe000) {
						code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
						at += 6;
					}
				}
				if (code < 0x80) out += (char)code;
				else if (code < 0x800) { out += (char)(0xc0 | (code >> 6)); out += (char)(0x80 | (code & 0x3f)); }
				else if (code < 0x10000) {
					out += (char)(0xe0 | (code >> 12));
					out += (char)(0x80 | ((code >> 6) & 0x3f));
					out += (char)(0x80 | (code & 0x3f));
				}
				else {
					out += (char)(0xf0 | (code >> 18));
					out += (char)(0x80 | ((code >> 12) & 0x3f));
					out += (char)(0x80 | ((code >> 6) & 0x3f));
					out += (char)(0x80 | (code & 0x3f));
				}
				break;
			}
			default: out += e;
		}
	}
	return false;
}

/**
 * Bytes as the facade writes them among the values, `{"$bytes":"<base64>"}`,
 * at `at` (on its `{`), into `out`; false when it is not that.
 */
static bool DbJsonBytesParam(const std::string &json, size_t &at, std::string &out)
{
	static const char opening[] = "{\"$bytes\":\"";
	size_t start = at + sizeof(opening) - 1;
	size_t end = json.find('"', start);
	if (json.compare(at, sizeof(opening) - 1, opening) != 0 || end == std::string::npos || end + 1 >= json.size() || json[end + 1] != '}')
		return false;
	size_t length = 0;
	out.resize((end - start) / 4 * 3 + 3);
	if (mbedtls_base64_decode((unsigned char *)&out[0], out.size(), &length, (const unsigned char *)json.data() + start, end - start) != 0)
		return false;
	out.resize(length);
	at = end + 2;
	return true;
}

/** The values of a JSON array of text, numbers, booleans, bytes and nulls - what the facade writes; false when it is not one. */
static bool DbParseParams(const std::string &json, std::vector<DbParam> &params)
{
	size_t at = json.find('[');
	if (at == std::string::npos)
		return json.empty();
	at++;
	for (;;) {
		while (at < json.size() && isspace((unsigned char)json[at]))
			at++;
		if (at >= json.size())
			return false;
		if (json[at] == ']')
			return true;
		DbParam p;
		p.kind = 0;
		p.integer = 0;
		p.fraction = 0;
		char c = json[at];
		if (c == '"') {
			at++;
			p.kind = 4;
			if (!DbJsonString(json, at, p.text))
				return false;
		}
		else if (c == '{') {
			p.kind = 5;
			if (!DbJsonBytesParam(json, at, p.text))
				return false;
		}
		else if (json.compare(at, 4, "null") == 0) at += 4;
		else if (json.compare(at, 4, "true") == 0) { p.kind = 1; p.integer = 1; at += 4; }
		else if (json.compare(at, 5, "false") == 0) { p.kind = 1; at += 5; }
		else {
			size_t end = json.find_first_of(",] \t\r\n", at);
			std::string number = json.substr(at, end == std::string::npos ? std::string::npos : end - at);
			at = end == std::string::npos ? json.size() : end;
			char *stop = NULL;
			p.fraction = strtod(number.c_str(), &stop);
			if (number.empty() || *stop)
				return false;
			p.kind = 3;
			if (number.find_first_of(".eE") == std::string::npos && p.fraction >= -9.2e18 && p.fraction <= 9.2e18) {
				p.kind = 2;
				p.integer = strtoll(number.c_str(), NULL, 10);
			}
		}
		params.push_back(p);
		while (at < json.size() && isspace((unsigned char)json[at]))
			at++;
		if (at < json.size() && json[at] == ',')
			at++;
	}
}

/** Whether a column holds bytes - BLOB, BINARY, VARBINARY - which go to JSON as base64. */
static bool DbIsBytes(const DbColumn &column)
{
	return column.charset == DB_BINARY_CHARSET && (column.type == DB_TYPE_VARCHAR || (column.type >= DB_TYPE_TINY_BLOB && column.type <= DB_TYPE_STRING));
}

/** Appends a value of a binary row as JSON, by its column's type. */
static void DbBinaryValue(DbReader &r, const DbColumn &column, std::string &out)
{
	bool isUnsigned = (column.flags & DB_UNSIGNED_FLAG) != 0;
	char text[64];
	switch (column.type) {
		case DB_TYPE_TINY: {
			uint64_t v = r.fixed(1);
			snprintf(text, sizeof(text), "%d", isUnsigned ? (int)v : (int)(int8_t)v);
			out += text;
			return;
		}
		case DB_TYPE_SHORT:
		case DB_TYPE_YEAR: {
			uint64_t v = r.fixed(2);
			snprintf(text, sizeof(text), "%d", isUnsigned || column.type == DB_TYPE_YEAR ? (int)v : (int)(int16_t)v);
			out += text;
			return;
		}
		case DB_TYPE_LONG:
		case DB_TYPE_INT24: {
			uint64_t v = r.fixed(4);
			snprintf(text, sizeof(text), "%lld", isUnsigned ? (long long)v : (long long)(int32_t)v);
			out += text;
			return;
		}
		case DB_TYPE_LONGLONG: {
			uint64_t v = r.fixed(8);
			if (isUnsigned) snprintf(text, sizeof(text), "%llu", (unsigned long long)v);
			else snprintf(text, sizeof(text), "%lld", (long long)(int64_t)v);
			out += text;
			return;
		}
		case DB_TYPE_FLOAT: {
			uint32_t bits = (uint32_t)r.fixed(4);
			float v;
			memcpy(&v, &bits, 4);
			DbJsonDouble(out, v, true);
			return;
		}
		case DB_TYPE_DOUBLE: {
			uint64_t bits = r.fixed(8);
			double v;
			memcpy(&v, &bits, 8);
			DbJsonDouble(out, v, false);
			return;
		}
		case DB_TYPE_DATE:
		case DB_TYPE_DATETIME:
		case DB_TYPE_TIMESTAMP: {
			size_t length = (size_t)r.fixed(1);
			unsigned year = length >= 4 ? (unsigned)r.fixed(2) : 0, month = length >= 4 ? (unsigned)r.fixed(1) : 0, day = length >= 4 ? (unsigned)r.fixed(1) : 0;
			unsigned hour = length >= 7 ? (unsigned)r.fixed(1) : 0, minute = length >= 7 ? (unsigned)r.fixed(1) : 0, second = length >= 7 ? (unsigned)r.fixed(1) : 0;
			unsigned long micro = length >= 11 ? (unsigned long)r.fixed(4) : 0;
			int n = snprintf(text, sizeof(text), "%04u-%02u-%02u", year, month, day);
			if (column.type != DB_TYPE_DATE) {
				n += snprintf(text + n, sizeof(text) - n, " %02u:%02u:%02u", hour, minute, second);
				if (column.decimals > 0 && column.decimals <= 6) {
					char fraction[8];
					snprintf(fraction, sizeof(fraction), "%06lu", micro);
					snprintf(text + n, sizeof(text) - n, ".%.*s", (int)column.decimals, fraction);
				}
			}
			DbJsonText(out, text, strlen(text));
			return;
		}
		case DB_TYPE_TIME: {
			size_t length = (size_t)r.fixed(1);
			bool negative = length >= 8 && r.fixed(1) != 0;
			unsigned long days = length >= 8 ? (unsigned long)r.fixed(4) : 0;
			unsigned long hour = length >= 8 ? (unsigned long)r.fixed(1) : 0, minute = length >= 8 ? (unsigned long)r.fixed(1) : 0, second = length >= 8 ? (unsigned long)r.fixed(1) : 0;
			unsigned long micro = length >= 12 ? (unsigned long)r.fixed(4) : 0;
			int n = snprintf(text, sizeof(text), "%s%02lu:%02lu:%02lu", negative ? "-" : "", days * 24 + hour, minute, second);
			if (column.decimals > 0 && column.decimals <= 6) {
				char fraction[8];
				snprintf(fraction, sizeof(fraction), "%06lu", micro);
				snprintf(text + n, sizeof(text) - n, ".%.*s", (int)column.decimals, fraction);
			}
			DbJsonText(out, text, strlen(text));
			return;
		}
	}
	std::string bytes = r.text();
	if (column.type == DB_TYPE_DECIMAL || column.type == DB_TYPE_NEWDECIMAL) out += bytes;
	else if (column.type == DB_TYPE_BIT) {
		uint64_t v = 0;
		for (size_t i = 0; i < bytes.size(); i++)
			v = (v << 8) | (unsigned char)bytes[i];
		snprintf(text, sizeof(text), "%llu", (unsigned long long)v);
		out += text;
	}
	else if (DbIsBytes(column)) DbJsonBytes(out, bytes.data(), bytes.size());
	else DbJsonText(out, bytes.data(), bytes.size());
}

/** Appends a value of a text row as JSON: numbers as the server wrote them, the rest as text. */
static void DbTextValue(const std::string &value, const DbColumn &column, std::string &out)
{
	switch (column.type) {
		case DB_TYPE_TINY: case DB_TYPE_SHORT: case DB_TYPE_LONG: case DB_TYPE_INT24: case DB_TYPE_LONGLONG:
		case DB_TYPE_YEAR: case DB_TYPE_DECIMAL: case DB_TYPE_NEWDECIMAL:
			out += value;
			return;
		case DB_TYPE_FLOAT: case DB_TYPE_DOUBLE:
			DbJsonDouble(out, strtod(value.c_str(), NULL), column.type == DB_TYPE_FLOAT);
			return;
		case DB_TYPE_BIT: {
			uint64_t v = 0;
			for (size_t i = 0; i < value.size(); i++)
				v = (v << 8) | (unsigned char)value[i];
			char text[32];
			snprintf(text, sizeof(text), "%llu", (unsigned long long)v);
			out += text;
			return;
		}
	}
	if (DbIsBytes(column)) DbJsonBytes(out, value.data(), value.size());
	else DbJsonText(out, value.data(), value.size());
}

// ---------------------------------------------------------------- queries

/**
 * Reads what a query gave - an OK, an error or rows, and every further result
 * a procedure gives - into `q`: its first rows as a JSON array for a query,
 * `{ insertId, affectedRows }` for an execute. False when the connection failed.
 */
static bool DbReadResults(DbConn *c, DbQuery *q, bool binary)
{
	bool first = true;
	bool tooLarge = false;
	std::string packet;
	for (;;) {
		if (!DbReadPacket(c, packet))
			return false;
		unsigned char head = packet.empty() ? 0xff : (unsigned char)packet[0];
		uint16_t status = 0;

		if (head == 0xff) {
			DbServerError(q, packet);
			return true;
		}
		if (head == 0x00) {
			DbReader ok(packet, 1);
			uint64_t affected = ok.lenenc();
			uint64_t insertId = ok.lenenc();
			status = (uint16_t)ok.fixed(2);
			if (first) {
				if (q->kind == DB_EXECUTE) {
					char text[96];
					snprintf(text, sizeof(text), "{\"insertId\":%llu,\"affectedRows\":%llu}", (unsigned long long)insertId, (unsigned long long)affected);
					q->result = text;
				}
				else q->result = "[]";
			}
		}
		else {
			size_t count = (size_t)DbReader(packet).lenenc();
			std::vector<DbColumn> columns(count);
			for (size_t i = 0; i < count; i++) {
				if (!DbReadPacket(c, packet))
					return false;
				DbReader def(packet);
				def.text(); def.text(); def.text(); def.text();   // catalog, schema, table, its original name
				std::string name = def.text();
				def.text();      // the column's original name
				def.lenenc();    // the length of what follows
				columns[i].charset = (uint16_t)def.fixed(2);
				def.fixed(4);    // its length
				columns[i].type = (uint8_t)def.fixed(1);
				columns[i].flags = (uint16_t)def.fixed(2);
				columns[i].decimals = (uint8_t)def.fixed(1);
				DbJsonText(columns[i].key, name.data(), name.size());
				columns[i].key += ':';
			}
			if (count > 0 && !DbReadPacket(c, packet))   // the EOF after the columns
				return false;

			std::string rows = "[";
			for (;;) {
				if (!DbReadPacket(c, packet))
					return false;
				unsigned char rowHead = packet.empty() ? 0xff : (unsigned char)packet[0];
				if (rowHead == 0xfe && packet.size() < 9) {
					DbReader eof(packet, 1);
					eof.fixed(2);
					status = (uint16_t)eof.fixed(2);
					break;
				}
				if (rowHead == 0xff) {
					DbServerError(q, packet);
					return true;
				}
				if (!first || q->kind != DB_QUERY || tooLarge)
					continue;
				if (rows.size() > 1)
					rows += ',';
				rows += '{';
				if (binary) {
					DbReader row(packet, 1);
					size_t bitmapLength = (count + 9) / 8;
					std::string bitmap = row.bytes(bitmapLength);
					for (size_t i = 0; i < count; i++) {
						if (i > 0)
							rows += ',';
						rows += columns[i].key;
						if ((unsigned char)bitmap[(i + 2) / 8] & (1 << ((i + 2) % 8))) rows += "null";
						else DbBinaryValue(row, columns[i], rows);
					}
				}
				else {
					DbReader row(packet);
					for (size_t i = 0; i < count; i++) {
						if (i > 0)
							rows += ',';
						rows += columns[i].key;
						bool null = false;
						size_t length = (size_t)row.lenenc(&null);
						if (null) rows += "null";
						else DbTextValue(row.bytes(length), columns[i], rows);
					}
				}
				rows += '}';
				if (rows.size() > DB_MAX_RESULT)
					tooLarge = true;
			}
			if (first)
				q->result = q->kind == DB_EXECUTE ? "{\"insertId\":0,\"affectedRows\":0}" : rows + "]";
		}
		first = false;
		if (!(status & DB_SERVER_MORE_RESULTS_EXISTS))
			break;
	}
	if (tooLarge)
		DbClientError(q, "the result is larger than 64 MB: ask for fewer rows");
	return true;
}

/** A query without values: COM_QUERY and its text rows. False when the connection failed. */
static bool DbRunText(DbConn *c, DbQuery *q, const std::string &sql)
{
	c->seq = 0;
	return DbWritePacket(c, std::string(1, (char)DB_COM_QUERY) + sql) && DbReadResults(c, q, false);
}

/** Closes every statement the connection keeps. */
static bool DbCloseStatements(DbConn *c)
{
	for (std::map<std::string, DbStatement>::iterator it = c->statements.begin(); it != c->statements.end(); ++it) {
		std::string close(1, (char)DB_COM_STMT_CLOSE);
		DbPutFixed(close, it->second.id, 4);
		c->seq = 0;
		if (!DbWritePacket(c, close))
			return false;
	}
	c->statements.clear();
	return true;
}

/** A query with values: prepared once a connection (COM_STMT_PREPARE), run with them (COM_STMT_EXECUTE). */
static bool DbRunPrepared(DbConn *c, DbQuery *q, const std::vector<DbParam> &params)
{
	std::map<std::string, DbStatement>::iterator found = c->statements.find(q->sql);
	DbStatement statement;
	if (found != c->statements.end()) statement = found->second;
	else {
		if (c->statements.size() >= DB_MAX_STATEMENTS && !DbCloseStatements(c))
			return false;
		c->seq = 0;
		std::string packet;
		if (!DbWritePacket(c, std::string(1, (char)DB_COM_STMT_PREPARE) + q->sql) || !DbReadPacket(c, packet))
			return false;
		if (packet.empty() || (unsigned char)packet[0] == 0xff) {
			DbServerError(q, packet);
			return true;
		}
		DbReader ok(packet, 1);
		statement.id = (uint32_t)ok.fixed(4);
		uint16_t columns = (uint16_t)ok.fixed(2);
		statement.params = (uint16_t)ok.fixed(2);
		// The definitions of its values and columns, each list ended by an EOF: not needed here.
		size_t skip = (statement.params ? statement.params + 1u : 0u) + (columns ? columns + 1u : 0u);
		for (size_t i = 0; i < skip; i++)
			if (!DbReadPacket(c, packet))
				return false;
		c->statements[q->sql] = statement;
	}

	if (params.size() != statement.params) {
		char text[128];
		snprintf(text, sizeof(text), "the statement has %u ?, and %u value(s) were given", (unsigned)statement.params, (unsigned)params.size());
		DbClientError(q, text);
		return true;
	}

	std::string execute(1, (char)DB_COM_STMT_EXECUTE);
	DbPutFixed(execute, statement.id, 4);
	execute += '\0';             // no cursor
	DbPutFixed(execute, 1, 4);   // run once
	if (!params.empty()) {
		std::string bitmap((params.size() + 7) / 8, '\0');
		std::string types, values;
		for (size_t i = 0; i < params.size(); i++) {
			const DbParam &p = params[i];
			switch (p.kind) {
				case 0:
					bitmap[i / 8] = (char)(bitmap[i / 8] | (1 << (i % 8)));
					types += (char)DB_TYPE_NULL;
					break;
				case 1:
					types += (char)DB_TYPE_TINY;
					values += (char)p.integer;
					break;
				case 2:
					types += (char)DB_TYPE_LONGLONG;
					DbPutFixed(values, (uint64_t)p.integer, 8);
					break;
				case 3: {
					uint64_t bits;
					memcpy(&bits, &p.fraction, 8);
					types += (char)DB_TYPE_DOUBLE;
					DbPutFixed(values, bits, 8);
					break;
				}
				case 5:
					types += (char)DB_TYPE_BLOB;
					DbPutLenenc(values, p.text.size());
					values += p.text;
					break;
				default:
					types += (char)DB_TYPE_VAR_STRING;
					DbPutLenenc(values, p.text.size());
					values += p.text;
			}
			types += '\0';   // signed
		}
		execute += bitmap;
		execute += '\1';   // the types follow
		execute += types;
		execute += values;
	}
	c->seq = 0;
	return DbWritePacket(c, execute) && DbReadResults(c, q, true);
}

/** Pings the connection; false when it is gone. */
static bool DbPing(DbConn *c)
{
	std::string packet;
	c->seq = 0;
	return DbWritePacket(c, std::string(1, (char)DB_COM_PING)) && DbReadPacket(c, packet) && !packet.empty() && packet[0] == 0x00;
}

/**
 * Whether the server has closed the connection since its last query: between
 * queries it sends nothing, so anything to read - the end of the stream, or
 * the error it sends as it drops one (a KILL, wait_timeout) - means it went.
 */
static bool DbClosedWhileIdle(DbConn *c)
{
	if (c->inAt < c->in.size())
		return true;
#ifdef _WIN32
	fd_set readable;
	FD_ZERO(&readable);
	FD_SET(c->socket, &readable);
	struct timeval now = { 0, 0 };
	return select(0, &readable, NULL, NULL, &now) != 0;
#else
	struct pollfd p = { c->socket, POLLIN, 0 };
	return poll(&p, 1, 0) != 0;
#endif
}

/** Runs a query on the connection - opening it first when it is not open - and fills its outcome. */
static void DbRun(DbConn *c, DbQuery *q)
{
	q->status = 0;
	q->result.clear();
	q->sqlState.clear();

	std::vector<DbParam> params;
	if (!DbParseParams(q->params, params)) {
		DbClientError(q, "the values of the query are not a list of text, numbers, booleans and nulls");
		return;
	}

	bool open = c->socket != DB_NO_SOCKET;
	if (open && (DbClosedWhileIdle(c) ||
	             (std::chrono::steady_clock::now() - c->used > std::chrono::milliseconds(DB_IDLE_PING_MS) && !DbPing(c)))) {
		DbDisconnect(c);
		open = false;
	}
	if (q->kind == DB_BEGIN)
		c->lostTransaction = false;
	if (c->lostTransaction) {
		// The connection went in the middle of the transaction, and the server
		// rolled it back: what else was sent in it fails, and the ROLLBACK
		// that ends it finds nothing to do.
		if (q->kind == DB_ROLLBACK) c->lostTransaction = false;
		else DbClientError(q, "the connection to the database was lost in the transaction, which was rolled back");
		return;
	}
	if (!open && !DbConnect(c)) {
		DbClientError(q, c->error);
		if (c->refusal.status > 0) {
			q->status = c->refusal.status;
			q->sqlState = c->refusal.sqlState;
		}
		DbDisconnect(c);
		return;
	}

	bool ran;
	switch (q->kind) {
		case DB_BEGIN: ran = DbRunText(c, q, "START TRANSACTION"); break;
		case DB_COMMIT: ran = DbRunText(c, q, "COMMIT"); break;
		case DB_ROLLBACK: ran = DbRunText(c, q, "ROLLBACK"); break;
		default: ran = params.empty() ? DbRunText(c, q, q->sql) : DbRunPrepared(c, q, params);
	}
	if (!ran) {
		DbClientError(q, c->error);
		DbDisconnect(c);
		return;
	}
	c->used = std::chrono::steady_clock::now();
	if (q->kind == DB_BEGIN && q->status == 0) {
		c->inTransaction = true;
		q->result = std::to_string(q->id);   // what the plugin names the transaction by
	}
	if (q->kind == DB_COMMIT || q->kind == DB_ROLLBACK) c->inTransaction = false;
}

// ---------------------------------------------------------------- the threads

static void DbWorker(DbConn *c)
{
	for (;;) {
		DbQuery *q;
		{
			std::unique_lock<std::mutex> lock(c->lock);
			c->wake.wait(lock, [c] { return c->stop || !c->queue.empty(); });
			if (c->stop)
				break;
			q = c->queue.front();
			c->queue.pop_front();
		}
		DbRun(c, q);
		std::lock_guard<std::mutex> lock(g_dbLock);
		g_dbDone.push_back(q);
	}
	if (c->socket != DB_NO_SOCKET) {
		c->seq = 0;
		DbWritePacket(c, std::string(1, (char)DB_COM_QUIT));
	}
	DbDisconnect(c);
}

static DbConn *DbNewConn(DbPool *pool)
{
	DbConn *c = new DbConn(pool);
	c->thread = new std::thread(DbWorker, c);
	return c;
}

static void DbQueue(DbConn *c, DbQuery *q)
{
	{
		std::lock_guard<std::mutex> lock(c->lock);
		c->queue.push_back(q);
	}
	c->wake.notify_one();
}

/** Ends a query at once, without a connection: it is handed back on the next frame. */
static void DbFailNow(DbQuery *q, const std::string &message)
{
	DbClientError(q, message);
	std::lock_guard<std::mutex> lock(g_dbLock);
	g_dbDone.push_back(q);
}

/** Gives a waiting BEGIN a connection of its pool: a spare one no transaction holds, or a new one while there is room. */
static bool DbGiveConnection(DbPool *pool, DbQuery *begin)
{
	DbConn *free = NULL;
	for (size_t i = 0; i < pool->spare.size() && !free; i++)
		if (pool->spare[i]->heldBy == 0)
			free = pool->spare[i];
	if (!free && pool->spare.size() < DB_MAX_TRANSACTIONS) {
		free = DbNewConn(pool);
		pool->spare.push_back(free);
	}
	if (!free)
		return false;
	free->heldBy = begin->id;
	g_dbTransactions[begin->id] = free;
	DbQueue(free, begin);
	return true;
}

/** A transaction has ended: its connection goes to the next waiting BEGIN of the pool, or back to the spares. */
static void DbEndTransaction(int32_t tx)
{
	std::map<int32_t, DbConn *>::iterator it = g_dbTransactions.find(tx);
	if (it == g_dbTransactions.end())
		return;
	DbConn *c = it->second;
	DbPool *pool = g_dbTransactionPools[tx];
	g_dbTransactions.erase(it);
	g_dbTransactionPools.erase(tx);
	if (!c) {
		for (size_t i = 0; i < pool->waiting.size(); i++)
			if (pool->waiting[i]->id == tx) {
				pool->waiting.erase(pool->waiting.begin() + i);
				break;
			}
		return;
	}
	c->heldBy = 0;
	while (!pool->waiting.empty()) {
		DbQuery *next = pool->waiting.front();
		pool->waiting.pop_front();
		if (next->cancelled) {
			g_dbTransactions.erase(next->id);
			g_dbTransactionPools.erase(next->id);
			g_dbQueries.erase(next->id);
			delete next;
			continue;
		}
		DbGiveConnection(pool, next);
		break;
	}
}

/** Rolls a transaction back for a plugin that cannot: it is being unloaded. */
static void DbAbandonTransaction(int32_t tx)
{
	DbConn *c = g_dbTransactions[tx];
	if (c) {
		DbQuery *rollback = new DbQuery();
		rollback->kind = DB_ROLLBACK;
		rollback->tx = tx;
		DbQueue(c, rollback);
	}
	DbEndTransaction(tx);
}

static void DbDelete(DbQuery *q)
{
	g_dbQueries.erase(q->id);
	delete q;
}

/** Every query and transaction of a plugin goes: the plugin is being unloaded. Its queries still run; what they give is dropped. */
static void DbForget(wasm_module_inst_t inst)
{
	std::vector<DbQuery *> its;
	for (std::map<int32_t, DbQuery *>::iterator it = g_dbQueries.begin(); it != g_dbQueries.end(); ++it)
		if (it->second->inst == inst)
			its.push_back(it->second);
	for (size_t i = 0; i < its.size(); i++) {
		DbQuery *q = its[i];
		if (q->kind == DB_BEGIN && g_dbTransactions.count(q->id) && !q->ended) {
			// Not begun yet, or still beginning: it ends when its BEGIN comes back.
			q->cancelled = true;
			continue;
		}
		if (q->kind == DB_BEGIN && g_dbTransactions.count(q->id))
			DbAbandonTransaction(q->id);
		if (q->ended) DbDelete(q);
		else q->cancelled = true;
	}
}

/** Stops every connection's thread and deletes what is left: the module is detaching. */
static void DbShutdown()
{
	std::vector<DbConn *> conns;
	for (std::map<std::string, DbPool *>::iterator it = g_dbPools.begin(); it != g_dbPools.end(); ++it) {
		conns.push_back(it->second->main);
		conns.insert(conns.end(), it->second->spare.begin(), it->second->spare.end());
	}
	for (size_t i = 0; i < conns.size(); i++) {
		DbConn *c = conns[i];
		{
			std::lock_guard<std::mutex> lock(c->lock);
			c->stop = true;
			for (size_t j = 0; j < c->queue.size(); j++)
				if (!c->queue[j]->inst)
					delete c->queue[j];
			c->queue.clear();
		}
		c->wake.notify_one();
		// A thread waiting on the server is woken by its socket closing under it.
#ifdef _WIN32
		if (c->socket != DB_NO_SOCKET) shutdown(c->socket, SD_BOTH);
#else
		if (c->socket != DB_NO_SOCKET) shutdown(c->socket, SHUT_RDWR);
#endif
	}
	for (size_t i = 0; i < conns.size(); i++) {
		conns[i]->thread->join();
		delete conns[i]->thread;
		delete conns[i];
	}
	for (std::map<std::string, DbPool *>::iterator it = g_dbPools.begin(); it != g_dbPools.end(); ++it)
		delete it->second;
	for (std::map<int32_t, DbQuery *>::iterator it = g_dbQueries.begin(); it != g_dbQueries.end(); ++it)
		delete it->second;
	for (size_t i = 0; i < g_dbDone.size(); i++)
		if (!g_dbDone[i]->inst)
			delete g_dbDone[i];
	g_dbPools.clear();
	g_dbPoolIds.clear();
	g_dbQueries.clear();
	g_dbTransactions.clear();
	g_dbTransactionPools.clear();
	g_dbDone.clear();
	if (g_dbCryptoReady) {
		mbedtls_x509_crt_free(&g_dbAuthorities);
		mbedtls_ctr_drbg_free(&g_dbRandom);
		mbedtls_entropy_free(&g_dbEntropy);
		g_dbCryptoReady = false;
	}
}

/**
 * Once a frame: what has ended goes to its plugin's callback. A transaction
 * whose COMMIT or ROLLBACK came back - or whose BEGIN failed - lets its
 * connection go; a failed COMMIT is rolled back first, so the connection is
 * clean for the next. A query the plugin took back, or whose plugin is gone,
 * is deleted unheard.
 */
static void DbFrame()
{
	std::vector<DbQuery *> done;
	{
		std::lock_guard<std::mutex> lock(g_dbLock);
		if (g_dbDone.empty())
			return;
		done.swap(g_dbDone);
	}

	for (size_t i = 0; i < done.size(); i++) {
		DbQuery *q = done[i];
		q->ended = true;
		if (!q->inst) {
			delete q;   // the module's own ROLLBACK
			continue;
		}

		if (q->kind == DB_BEGIN && q->cancelled && g_dbTransactions.count(q->id))
			DbAbandonTransaction(q->id);
		else if (q->kind == DB_BEGIN && q->status != 0)
			DbEndTransaction(q->id);
		else if (q->kind == DB_COMMIT || q->kind == DB_ROLLBACK) {
			if (q->status != 0 && g_dbTransactions.count(q->tx)) DbAbandonTransaction(q->tx);
			else DbEndTransaction(q->tx);
		}

		int plugin = -1;
		for (size_t p = 0; p < g_plugins.size(); p++)
			if (g_plugins[p].inst == q->inst)
				plugin = (int)p;
		if (q->cancelled || plugin < 0) {
			DbDelete(q);
			continue;
		}

		Handler h;
		h.plugin = plugin;
		h.fn = q->fn;
		h.shape = SHAPE_NARROW;
		uint32_t argv[1] = { (uint32_t)q->id };
		Fire(h, argv, 1, 0);
	}
}

// ---------------------------------------------------------------- natives

/** The plugin's query by id, once it has ended; NULL else. */
static DbQuery *DbOf(wasm_exec_env_t env, int32_t id)
{
	std::map<int32_t, DbQuery *>::iterator it = g_dbQueries.find(id);
	if (it == g_dbQueries.end() || it->second->inst != Inst(env) || !it->second->ended)
		return NULL;
	return it->second;
}

/** `length` bytes of the plugin's memory at `data`, as text; empty when they are not its. */
static std::string DbBytes(wasm_exec_env_t env, int32_t data, int32_t length)
{
	wasm_module_inst_t inst = Inst(env);
	if (length <= 0 || !wasm_runtime_validate_app_addr(inst, (uint64_t)data, (uint64_t)length))
		return std::string();
	return std::string((const char *)wasm_runtime_addr_app_to_native(inst, (uint64_t)data), (size_t)length);
}

// db_open(url, length) - the pool of a mysql:// address, made on its first
// open: its id, the same for every plugin and map; 0 when the address is not
// one the client reads.
static int32_t w_db_open(wasm_exec_env_t env, int32_t url, int32_t length)
{
	std::string address = DbBytes(env, url, length);
	std::map<std::string, DbPool *>::iterator found = g_dbPools.find(address);
	if (found != g_dbPools.end())
		return found->second->id;

	DbConfig config;
	if (!DbParseUrl(address, config))
		return 0;
	DbCryptoInit();
#ifdef _WIN32
	WSADATA wsa;
	WSAStartup(MAKEWORD(2, 2), &wsa);
#endif
	DbPool *pool = new DbPool();
	pool->id = g_dbNextPool++;
	pool->config = config;
	pool->main = DbNewConn(pool);
	g_dbPools[address] = pool;
	g_dbPoolIds[pool->id] = pool;
	return pool->id;
}

// db_query(pool, tx, kind, sql, sqlLength, params, paramsLength, fn) - sends a
// query of `kind` (DB_*) with the values of its `?` as a JSON array, in the
// transaction `tx` or none; `fn(id)` is called on the frame it ends. A BEGIN's
// id is its transaction's. 0 when the pool is not one.
static int32_t w_db_query(wasm_exec_env_t env, int32_t poolId, int32_t tx, int32_t kind, int32_t sql, int32_t sqlLength,
                          int32_t params, int32_t paramsLength, int32_t fn)
{
	std::map<int32_t, DbPool *>::iterator found = g_dbPoolIds.find(poolId);
	if (found == g_dbPoolIds.end() || kind < DB_QUERY || kind > DB_ROLLBACK)
		return 0;
	DbPool *pool = found->second;

	DbQuery *q = new DbQuery();
	if (g_dbNextId >= 0x7fff0000)
		g_dbNextId = 1;
	q->id = g_dbNextId++;
	q->inst = Inst(env);
	q->fn = (uint32_t)fn;
	q->kind = kind;
	q->tx = kind == DB_BEGIN ? q->id : tx;
	q->sql = DbBytes(env, sql, sqlLength);
	q->params = DbBytes(env, params, paramsLength);
	g_dbQueries[q->id] = q;

	if (kind == DB_BEGIN) {
		g_dbTransactions[q->id] = NULL;
		g_dbTransactionPools[q->id] = pool;
		if (!DbGiveConnection(pool, q))
			pool->waiting.push_back(q);
		return q->id;
	}
	if (tx == 0) {
		if (kind == DB_COMMIT || kind == DB_ROLLBACK) DbFailNow(q, "there is no transaction to end");
		else DbQueue(pool->main, q);
		return q->id;
	}
	std::map<int32_t, DbConn *>::iterator held = g_dbTransactions.find(tx);
	if (held == g_dbTransactions.end() || !held->second || g_dbTransactionPools[tx] != pool) DbFailNow(q, "the transaction has ended");
	else DbQueue(held->second, q);
	return q->id;
}

// db_status(id) - 0 when the query ran, the server's error code when it refused it, -1 when it did not reach it.
static int32_t w_db_status(wasm_exec_env_t env, int32_t id)
{
	DbQuery *q = DbOf(env, id);
	return q ? q->status : DB_CLIENT_ERROR;
}

// db_text(id, what, out, max) - the result or the error's message, or the
// error's SQLSTATE (DB_TEXT_*), as UTF-8: its length, `max` bytes of it copied.
static int32_t w_db_text(wasm_exec_env_t env, int32_t id, int32_t what, int32_t out, int32_t max)
{
	DbQuery *q = DbOf(env, id);
	if (!q)
		return 0;
	return CopyText(Inst(env), what == DB_TEXT_STATE ? q->sqlState : q->result, out, max);
}

// db_close(id) - lets an ended query go.
static void w_db_close(wasm_exec_env_t env, int32_t id)
{
	DbQuery *q = DbOf(env, id);
	if (q)
		DbDelete(q);
}
