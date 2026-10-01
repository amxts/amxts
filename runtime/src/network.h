// The network client: the requests plugins make - fetch, and a module's FTP -
// run through libcurl on a worker thread of their own, so the game never waits
// on the network. The game thread hands a request over (net_send), the worker
// runs every request at once in one curl multi handle, and what has ended
// comes back once a frame (NetFrame, from server_frame), where the plugin's
// callback is called with the request's id and reads the outcome (net_status,
// net_text, net_read) before it lets the request go (net_close).
//
// Who touches a request: the game thread while the plugin builds it and
// after the worker gives it back; the worker in between. `cancelled` is the
// game thread's alone: a request the plugin took back is still the worker's
// until it comes back, and is then deleted without a callback.
//
// Included by module.cpp after Fire, Inst, AsString and CopyText.
#pragma once

#include <curl/curl.h>
#include <condition_variable>
#include <mutex>
#include <thread>

#include "net_cacert.h"

// The most a response may hold; past it the request fails rather than the
// server running out of memory.
#define NET_MAX_BODY (64 * 1024 * 1024)
// How long a connection may take to open; a request as a whole runs until it
// ends or the plugin aborts it.
#define NET_CONNECT_TIMEOUT_MS 30000L
// The redirects followed before a request fails, as a browser does.
#define NET_MAX_REDIRECTS 20L

// What net_text reads.
#define NET_TEXT_ERROR   0
#define NET_TEXT_STATUS  1
#define NET_TEXT_URL     2
#define NET_TEXT_HEADERS 3
#define NET_TEXT_KIND    4

struct NetRequest {
	int32_t            id;
	wasm_module_inst_t inst;   // the plugin that made it
	uint32_t           fn;     // its callback, (id) -> void
	bool               sent;       // the worker's until it comes back
	bool               ended;      // back, with its outcome
	bool               cancelled;

	// What the plugin set before sending it (net_option, net_body).
	std::string              url;
	std::string              method;
	std::vector<std::string> headers;
	std::string              body;
	bool                     hasBody;
	bool                     follow;
	std::string              proxy;
	std::string              ca;
	std::string              user;
	std::string              password;
	std::string              keyFile;
	std::string              keyPassphrase;
	std::string              hostKey;
	std::vector<std::string> quote;
	std::vector<std::string> postquote;
	bool                     upload;
	bool                     list;
	bool                     createDirs;
	long                     ssl;        // CURLUSESSL_*: FTP's TLS, asked for with AUTH TLS
	long                     timeoutMs;  // the whole request's; 0 for none
	// A file of the game folder the response is written into, or - with
	// `upload` - the upload is read from: as the plugin named it, and where it is.
	std::string              fileName;
	std::string              file;

	// The worker's while it runs.
	CURL              *easy;
	struct curl_slist *headerList;
	struct curl_slist *quoteList;
	struct curl_slist *postquoteList;
	size_t             uploaded;
	FILE              *fp;   // the file, open; a download goes to file + ".part" until it ends well
	char               errorBuffer[CURL_ERROR_SIZE];

	// The outcome.
	CURLcode    code;
	long        status;
	long        reply;   // the protocol's last reply code: HTTP's status, FTP's, SFTP's status
	long        redirects;
	std::string statusText;
	std::string responseHeaders;
	std::string finalUrl;
	std::string error;
	std::string response;

	NetRequest()
		: id(0), inst(NULL), fn(0), sent(false), ended(false), cancelled(false), method("GET"), hasBody(false), follow(true),
		  upload(false), list(false), createDirs(false), ssl(CURLUSESSL_NONE), timeoutMs(0), easy(NULL), headerList(NULL),
		  quoteList(NULL), postquoteList(NULL), uploaded(0), fp(NULL), code(CURLE_OK), status(0), reply(0), redirects(0)
	{
		errorBuffer[0] = 0;
	}
};

// The game thread's: every request a plugin holds, by id.
static std::map<int32_t, NetRequest *> g_netRequests;
static int32_t g_netNextId = 1;

// Between the threads, under g_netLock.
static std::mutex                g_netLock;
static std::vector<NetRequest *> g_netIncoming;
static std::vector<int32_t>      g_netCancels;
static std::vector<NetRequest *> g_netDone;
static bool                      g_netStop = false;

static std::thread *g_netThread = NULL;
static CURLM       *g_netMulti = NULL;

// ---------------------------------------------------------------- the worker

static size_t NetWrite(char *data, size_t size, size_t count, void *user)
{
	NetRequest *r = (NetRequest *)user;
	size_t n = size * count;
	if (r->response.size() + n > NET_MAX_BODY) {
		r->error = "the response is larger than 64 MB";
		return 0;
	}
	r->response.append(data, n);
	return n;
}

/**
 * A header line of the response. Each response of a redirect, or a
 * `100 Continue`, starts with its status line, so the headers kept are the
 * last response's: what the plugin gets.
 */
static size_t NetHeader(char *data, size_t size, size_t count, void *user)
{
	NetRequest *r = (NetRequest *)user;
	size_t n = size * count;
	std::string line(data, n);
	while (!line.empty() && (line[line.size() - 1] == '\n' || line[line.size() - 1] == '\r'))
		line.erase(line.size() - 1);

	if (line.compare(0, 5, "HTTP/") == 0) {
		r->responseHeaders.clear();
		// "HTTP/1.1 404 Not Found": the words after the code.
		size_t code = line.find(' ');
		size_t text = code == std::string::npos ? std::string::npos : line.find(' ', code + 1);
		r->statusText = text == std::string::npos ? "" : line.substr(text + 1);
	}
	else if (!line.empty()) {
		r->responseHeaders += line;
		r->responseHeaders += '\n';
	}
	return n;
}

static size_t NetRead(char *buffer, size_t size, size_t count, void *user)
{
	NetRequest *r = (NetRequest *)user;
	size_t n = r->body.size() - r->uploaded;
	if (n > size * count)
		n = size * count;
	memcpy(buffer, r->body.data() + r->uploaded, n);
	r->uploaded += n;
	return n;
}

// A download into a file and an upload from one: curl streams them, the
// bytes never pass through the plugin.
static size_t NetWriteFile(char *data, size_t size, size_t count, void *user)
{
	return fwrite(data, 1, size * count, ((NetRequest *)user)->fp);
}

static size_t NetReadFile(char *buffer, size_t size, size_t count, void *user)
{
	NetRequest *r = (NetRequest *)user;
	size_t n = fread(buffer, 1, size * count, r->fp);
	return n == 0 && ferror(r->fp) ? CURL_READFUNC_ABORT : n;
}

/** Where a download is written until it has ended well: an older file of the name stays until then. */
static std::string NetPartial(const NetRequest *r)
{
	return r->file + ".part";
}

/** Opens the request's file: false, with the error said, when it cannot. */
static bool NetOpenFile(NetRequest *r)
{
	if (r->upload) {
		r->fp = fopen(r->file.c_str(), "rb");
		if (!r->fp) {
			r->code = CURLE_READ_ERROR;
			r->error = "cannot read " + r->fileName;
			return false;
		}
		fseek(r->fp, 0, SEEK_END);
		long size = ftell(r->fp);
		fseek(r->fp, 0, SEEK_SET);
		curl_easy_setopt(r->easy, CURLOPT_UPLOAD, 1L);
		curl_easy_setopt(r->easy, CURLOPT_READFUNCTION, NetReadFile);
		curl_easy_setopt(r->easy, CURLOPT_READDATA, r);
		curl_easy_setopt(r->easy, CURLOPT_INFILESIZE_LARGE, (curl_off_t)size);
		return true;
	}
	r->fp = fopen(NetPartial(r).c_str(), "wb");
	if (!r->fp) {
		r->code = CURLE_WRITE_ERROR;
		r->error = "cannot write " + r->fileName;
		return false;
	}
	curl_easy_setopt(r->easy, CURLOPT_WRITEFUNCTION, NetWriteFile);
	return true;
}

/**
 * Closes the request's file. A download takes its name when the request
 * ended well - curl's code and no HTTP error status - and is deleted
 * otherwise, so a failed one leaves the older file as it was.
 */
static void NetCloseFile(NetRequest *r, bool ran)
{
	if (!r->fp)
		return;
	fclose(r->fp);
	r->fp = NULL;
	if (r->upload)
		return;

	std::string partial = NetPartial(r);
	if (!ran || r->code != CURLE_OK || r->status >= 400) {
		remove(partial.c_str());
		return;
	}
#ifdef _WIN32
	bool moved = MoveFileExA(partial.c_str(), r->file.c_str(), MOVEFILE_REPLACE_EXISTING) != 0;
#else
	bool moved = rename(partial.c_str(), r->file.c_str()) == 0;
#endif
	if (!moved) {
		remove(partial.c_str());
		r->code = CURLE_WRITE_ERROR;
		r->error = "cannot write " + r->fileName;
	}
}

static struct curl_slist *NetList(const std::vector<std::string> &lines)
{
	struct curl_slist *list = NULL;
	for (size_t i = 0; i < lines.size(); i++)
		list = curl_slist_append(list, lines[i].c_str());
	return list;
}

static bool NetHasHeader(const std::vector<std::string> &headers, const char *name)
{
	size_t length = strlen(name);
	for (size_t i = 0; i < headers.size(); i++) {
		if (headers[i].size() > length && headers[i][length] == ':') {
#ifdef _WIN32
			if (_strnicmp(headers[i].c_str(), name, length) == 0)
#else
			if (strncasecmp(headers[i].c_str(), name, length) == 0)
#endif
				return true;
		}
	}
	return false;
}

static bool NetIsSftp(const std::string &url)
{
	if (url.size() < 5)
		return false;
	std::string scheme = url.substr(0, 5);
	for (size_t i = 0; i < scheme.size(); i++)
		scheme[i] = (char)tolower((unsigned char)scheme[i]);
	return scheme == "sftp:";
}

/**
 * SFTP's status code (SSH_FX_*) of a failed request. curl keeps it to
 * itself and says it in words, one text a status (its sftp_libssh2_strerror,
 * of the curl this module is built with); "No such file or directory" is
 * also SSH_FX_NO_SUCH_PATH's, and is given as SSH_FX_NO_SUCH_FILE. 0 when
 * the error names none - a refused login, a lost connection.
 */
static long NetSftpStatus(const std::string &error)
{
	static const struct { long code; const char *text; } statuses[] = {
		{ 2, "No such file or directory" }, { 3, "Permission denied" }, { 4, "Operation failed" },
		{ 5, "Bad message from SFTP server" }, { 6, "Not connected to SFTP server" },
		{ 7, "Connection to SFTP server lost" }, { 8, "Operation not supported by SFTP server" },
		{ 9, "Invalid handle" }, { 11, "File already exists" }, { 12, "File is write protected" },
		{ 13, "No media" }, { 14, "Disk full" }, { 15, "User quota exceeded" }, { 16, "Unknown principal" },
		{ 17, "File lock conflict" }, { 18, "Directory not empty" }, { 19, "Not a directory" },
		{ 20, "Invalid filename" }, { 21, "Link points to itself" },
	};
	for (size_t i = 0; i < sizeof(statuses) / sizeof(statuses[0]); i++)
		if (error.find(statuses[i].text) != std::string::npos)
			return statuses[i].code;
	return 0;
}

/** What kind of failure a request's curl code is, as net_text names it: "" when there was none. */
static const char *NetErrorKind(CURLcode code)
{
	switch (code) {
	case CURLE_OK:
		return "";
	case CURLE_LOGIN_DENIED:
	case CURLE_AUTH_ERROR:
		return "login";
	case CURLE_REMOTE_ACCESS_DENIED:
		return "denied";
	case CURLE_REMOTE_FILE_NOT_FOUND:
		return "notFound";
	case CURLE_COULDNT_RESOLVE_PROXY:
	case CURLE_COULDNT_RESOLVE_HOST:
	case CURLE_COULDNT_CONNECT:
		return "refused";
	case CURLE_OPERATION_TIMEDOUT:
	case CURLE_FTP_ACCEPT_TIMEOUT:
		return "timeout";
	case CURLE_SSL_CONNECT_ERROR:
	case CURLE_PEER_FAILED_VERIFICATION:
	case CURLE_SSL_CERTPROBLEM:
	case CURLE_SSL_CIPHER:
	case CURLE_SSL_CACERT_BADFILE:
	case CURLE_USE_SSL_FAILED:
	case CURLE_SSL_SHUTDOWN_FAILED:
	case CURLE_SSL_CRL_BADFILE:
	case CURLE_SSL_ISSUER_ERROR:
	case CURLE_SSL_PINNEDPUBKEYNOTMATCH:
	case CURLE_SSL_INVALIDCERTSTATUS:
	case CURLE_SSL_CLIENTCERT:
		return "tls";
	case CURLE_ABORTED_BY_CALLBACK:
		return "aborted";
	default:
		return "other";
	}
}

/** Puts a request on the multi handle; false when curl would not take it. */
static bool NetStart(NetRequest *r)
{
	CURL *e = curl_easy_init();
	if (!e) {
		r->code = CURLE_OUT_OF_MEMORY;
		return false;
	}
	r->easy = e;

	curl_easy_setopt(e, CURLOPT_URL, r->url.c_str());
	curl_easy_setopt(e, CURLOPT_PRIVATE, r);
	curl_easy_setopt(e, CURLOPT_ERRORBUFFER, r->errorBuffer);
	curl_easy_setopt(e, CURLOPT_NOSIGNAL, 1L);
	curl_easy_setopt(e, CURLOPT_PROTOCOLS_STR, "http,https,ftp,ftps,sftp");
	curl_easy_setopt(e, CURLOPT_REDIR_PROTOCOLS_STR, "http,https");
	curl_easy_setopt(e, CURLOPT_WRITEFUNCTION, NetWrite);
	curl_easy_setopt(e, CURLOPT_WRITEDATA, r);
	curl_easy_setopt(e, CURLOPT_HEADERFUNCTION, NetHeader);
	curl_easy_setopt(e, CURLOPT_HEADERDATA, r);
	curl_easy_setopt(e, CURLOPT_CONNECTTIMEOUT_MS, NET_CONNECT_TIMEOUT_MS);
	curl_easy_setopt(e, CURLOPT_USERAGENT, "amxts");
	// An empty proxy is none: curl would take one from http_proxy and its
	// kind otherwise, which fetch does not.
	curl_easy_setopt(e, CURLOPT_PROXY, r->proxy.c_str());

	// The method. A custom one keeps itself across a redirect, except that
	// a 303 turns it into GET, as fetch does (CURLFOLLOW_OBEYCODE).
	bool custom = false;
	if (r->upload && !r->file.empty()) {
		// From the file: NetOpenFile, below.
	}
	else if (r->upload) {
		curl_easy_setopt(e, CURLOPT_UPLOAD, 1L);
		curl_easy_setopt(e, CURLOPT_READFUNCTION, NetRead);
		curl_easy_setopt(e, CURLOPT_READDATA, r);
		curl_easy_setopt(e, CURLOPT_INFILESIZE_LARGE, (curl_off_t)r->body.size());
	}
	else if (r->method == "GET") {
		curl_easy_setopt(e, CURLOPT_HTTPGET, 1L);
	}
	else if (r->method == "HEAD") {
		curl_easy_setopt(e, CURLOPT_NOBODY, 1L);
	}
	else {
		custom = r->method != "POST";
		if (custom)
			curl_easy_setopt(e, CURLOPT_CUSTOMREQUEST, r->method.c_str());
		if (r->hasBody || !custom) {
			curl_easy_setopt(e, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t)r->body.size());
			curl_easy_setopt(e, CURLOPT_POSTFIELDS, r->body.data());
		}
	}

	curl_easy_setopt(e, CURLOPT_FOLLOWLOCATION, r->follow ? (custom ? (long)CURLFOLLOW_OBEYCODE : 1L) : 0L);
	curl_easy_setopt(e, CURLOPT_MAXREDIRS, NET_MAX_REDIRECTS);

	// curl adds `Expect: 100-continue` to a large body and a form's content
	// type to any; fetch sends neither unless asked.
	std::vector<std::string> headers = r->headers;
	if (!NetHasHeader(headers, "expect"))
		headers.push_back("Expect:");
	if (!NetHasHeader(headers, "content-type"))
		headers.push_back("Content-Type:");
	r->headerList = NetList(headers);
	curl_easy_setopt(e, CURLOPT_HTTPHEADER, r->headerList);

	// The authorities a certificate is checked against: the plugin's own
	// when it gives them, else Mozilla's.
	struct curl_blob ca;
	if (r->ca.empty()) {
		ca.data = (void *)g_cacert;
		ca.len = sizeof(g_cacert);
	}
	else {
		ca.data = (void *)r->ca.c_str();
		ca.len = r->ca.size() + 1;
	}
	// Both live as long as the request.
	ca.flags = CURL_BLOB_NOCOPY;
	curl_easy_setopt(e, CURLOPT_CAINFO_BLOB, &ca);
	curl_easy_setopt(e, CURLOPT_PROXY_CAINFO_BLOB, &ca);

	// FTP, FTPS and SFTP: what a module over these natives asks for.
	if (!r->user.empty())
		curl_easy_setopt(e, CURLOPT_USERNAME, r->user.c_str());
	if (!r->password.empty())
		curl_easy_setopt(e, CURLOPT_PASSWORD, r->password.c_str());
	if (!r->keyFile.empty())
		curl_easy_setopt(e, CURLOPT_SSH_PRIVATE_KEYFILE, r->keyFile.c_str());
	if (!r->keyPassphrase.empty())
		curl_easy_setopt(e, CURLOPT_KEYPASSWD, r->keyPassphrase.c_str());
	if (!r->hostKey.empty())
		curl_easy_setopt(e, CURLOPT_SSH_HOST_PUBLIC_KEY_SHA256, r->hostKey.c_str());
	if (r->ssl != CURLUSESSL_NONE)
		curl_easy_setopt(e, CURLOPT_USE_SSL, r->ssl);
	if (r->timeoutMs > 0)
		curl_easy_setopt(e, CURLOPT_TIMEOUT_MS, r->timeoutMs);
	if (r->list)
		curl_easy_setopt(e, CURLOPT_DIRLISTONLY, 1L);
	if (r->createDirs)
		curl_easy_setopt(e, CURLOPT_FTP_CREATE_MISSING_DIRS, (long)CURLFTP_CREATE_DIR);
	if (!r->quote.empty()) {
		r->quoteList = NetList(r->quote);
		curl_easy_setopt(e, CURLOPT_QUOTE, r->quoteList);
	}
	if (!r->postquote.empty()) {
		r->postquoteList = NetList(r->postquote);
		curl_easy_setopt(e, CURLOPT_POSTQUOTE, r->postquoteList);
	}
	if (!r->file.empty() && !NetOpenFile(r))
		return false;

	CURLMcode added = curl_multi_add_handle(g_netMulti, e);
	if (added != CURLM_OK) {
		r->code = CURLE_FAILED_INIT;
		r->error = curl_multi_strerror(added);
		return false;
	}
	return true;
}

/** Takes a request off the multi handle and frees what curl held for it. */
static void NetFinish(NetRequest *r, bool ran)
{
	if (!r->easy)
		return;

	if (ran) {
		curl_easy_getinfo(r->easy, CURLINFO_RESPONSE_CODE, &r->status);
		curl_easy_getinfo(r->easy, CURLINFO_REDIRECT_COUNT, &r->redirects);
		char *url = NULL;
		if (curl_easy_getinfo(r->easy, CURLINFO_EFFECTIVE_URL, &url) == CURLE_OK && url)
			r->finalUrl = url;
	}
	r->reply = r->status;
	NetCloseFile(r, ran);

	curl_multi_remove_handle(g_netMulti, r->easy);
	curl_easy_cleanup(r->easy);
	r->easy = NULL;
	curl_slist_free_all(r->headerList);
	curl_slist_free_all(r->quoteList);
	curl_slist_free_all(r->postquoteList);
	r->headerList = r->quoteList = r->postquoteList = NULL;

	if (r->code != CURLE_OK && r->error.empty())
		r->error = r->errorBuffer[0] ? r->errorBuffer : curl_easy_strerror(r->code);
	if (r->reply == 0 && r->code != CURLE_OK && NetIsSftp(r->url))
		r->reply = NetSftpStatus(r->error);
}

static void NetWorker()
{
	std::map<int32_t, NetRequest *> running;
	std::vector<NetRequest *> incoming;
	std::vector<int32_t> cancels;
	std::vector<NetRequest *> done;

	for (;;) {
		{
			std::lock_guard<std::mutex> lock(g_netLock);
			if (g_netStop)
				break;
			incoming.swap(g_netIncoming);
			cancels.swap(g_netCancels);
		}

		for (size_t i = 0; i < incoming.size(); i++) {
			NetRequest *r = incoming[i];
			if (NetStart(r)) {
				running[r->id] = r;
				continue;
			}
			NetFinish(r, false);
			done.push_back(r);
		}
		incoming.clear();

		for (size_t i = 0; i < cancels.size(); i++) {
			std::map<int32_t, NetRequest *>::iterator it = running.find(cancels[i]);
			if (it == running.end())
				continue;
			it->second->code = CURLE_ABORTED_BY_CALLBACK;
			NetFinish(it->second, false);
			done.push_back(it->second);
			running.erase(it);
		}
		cancels.clear();

		int active = 0;
		curl_multi_perform(g_netMulti, &active);

		int left = 0;
		CURLMsg *message;
		while ((message = curl_multi_info_read(g_netMulti, &left))) {
			if (message->msg != CURLMSG_DONE)
				continue;
			NetRequest *r = NULL;
			curl_easy_getinfo(message->easy_handle, CURLINFO_PRIVATE, (char **)&r);
			if (!r)
				continue;
			r->code = message->data.result;
			NetFinish(r, true);
			done.push_back(r);
			running.erase(r->id);
		}

		if (!done.empty()) {
			std::lock_guard<std::mutex> lock(g_netLock);
			g_netDone.insert(g_netDone.end(), done.begin(), done.end());
			done.clear();
		}

		// Until a socket has something, a second at most; net_send and
		// net_cancel wake it at once.
		curl_multi_poll(g_netMulti, NULL, 0, 1000, NULL);
	}

	// Stopping: what still runs is let go here; the game thread deletes it.
	for (std::map<int32_t, NetRequest *>::iterator it = running.begin(); it != running.end(); ++it)
		NetFinish(it->second, false);
}

/** Starts the worker for the first request after the module attached. */
static bool NetEnsureWorker()
{
	if (g_netThread)
		return true;
	if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK)
		return false;
	g_netMulti = curl_multi_init();
	if (!g_netMulti) {
		curl_global_cleanup();
		return false;
	}
	g_netStop = false;
	g_netThread = new std::thread(NetWorker);
	return true;
}

static void NetDelete(NetRequest *r)
{
	g_netRequests.erase(r->id);
	delete r;
}

/** Takes a request back: one under way comes back from the worker and is deleted then. */
static void NetCancel(NetRequest *r)
{
	if (!r->sent) {
		NetDelete(r);
		return;
	}
	if (r->cancelled)
		return;
	r->cancelled = true;
	{
		std::lock_guard<std::mutex> lock(g_netLock);
		g_netCancels.push_back(r->id);
	}
	curl_multi_wakeup(g_netMulti);
}

/** Every request of every plugin goes: the plugins are being unloaded. */
static void NetForgetAll()
{
	std::vector<NetRequest *> all;
	for (std::map<int32_t, NetRequest *>::iterator it = g_netRequests.begin(); it != g_netRequests.end(); ++it)
		all.push_back(it->second);
	for (size_t i = 0; i < all.size(); i++)
		NetCancel(all[i]);
}

/** Stops the worker and deletes every request: the module is detaching. */
static void NetShutdown()
{
	if (g_netThread) {
		{
			std::lock_guard<std::mutex> lock(g_netLock);
			g_netStop = true;
		}
		curl_multi_wakeup(g_netMulti);
		g_netThread->join();
		delete g_netThread;
		g_netThread = NULL;
		curl_multi_cleanup(g_netMulti);
		g_netMulti = NULL;
		curl_global_cleanup();
	}

	for (std::map<int32_t, NetRequest *>::iterator it = g_netRequests.begin(); it != g_netRequests.end(); ++it)
		delete it->second;
	g_netRequests.clear();
	g_netIncoming.clear();
	g_netCancels.clear();
	g_netDone.clear();
}

/**
 * Once a frame: what has ended goes to its plugin's callback. A request the
 * plugin took back, or whose plugin is gone, is deleted unheard.
 */
static void NetFrame()
{
	if (!g_netThread)
		return;

	std::vector<NetRequest *> done;
	{
		std::lock_guard<std::mutex> lock(g_netLock);
		if (g_netDone.empty())
			return;
		done.swap(g_netDone);
	}

	for (size_t i = 0; i < done.size(); i++) {
		NetRequest *r = done[i];
		r->sent = false;
		r->ended = true;

		int plugin = -1;
		for (size_t p = 0; p < g_plugins.size(); p++)
			if (g_plugins[p].inst == r->inst)
				plugin = (int)p;

		if (r->cancelled || plugin < 0) {
			NetDelete(r);
			continue;
		}

		Handler h;
		h.plugin = plugin;
		h.fn = r->fn;
		h.shape = SHAPE_NARROW;
		uint32_t argv[1] = { (uint32_t)r->id };
		Fire(h, argv, 1, 0);
	}
}

// ---------------------------------------------------------------- natives

// What a native takes: a request being set up, one that has ended, or either.
#define NET_SETTING 1
#define NET_ENDED   2
#define NET_ANY     3

/** The plugin's request by id, when it is in one of the states `states` names; NULL else. */
static NetRequest *NetOf(wasm_exec_env_t env, int32_t id, int states)
{
	std::map<int32_t, NetRequest *>::iterator it = g_netRequests.find(id);
	if (it == g_netRequests.end() || it->second->inst != Inst(env))
		return NULL;
	NetRequest *r = it->second;
	int state = r->ended ? NET_ENDED : r->sent ? 0 : NET_SETTING;
	return (states & state) || states == NET_ANY ? r : NULL;
}

// net_open(url) - a request to `url`, to be set up and sent.
static int32_t w_net_open(wasm_exec_env_t env, int32_t url)
{
	NetRequest *r = new NetRequest();
	if (g_netNextId >= 0x7fff0000)
		g_netNextId = 1;
	r->id = g_netNextId++;
	r->inst = Inst(env);
	r->url = AsString(Inst(env), url);
	g_netRequests[r->id] = r;
	return r->id;
}

static bool NetFlag(const std::string &value)
{
	return !value.empty() && value != "0" && value != "false";
}

/**
 * A path of the game folder (`maps/de_dust2.bsp`), as @amxts/core/fs takes
 * one, made absolute - or "" when it would leave the folder: an absolute
 * path, a drive, or a `..` among its parts.
 */
static std::string NetGamePath(const std::string &path)
{
	if (path.empty() || path[0] == '/' || path[0] == '\\' || path.find(':') != std::string::npos)
		return "";
	for (size_t start = 0;;) {
		size_t end = path.find_first_of("/\\", start);
		if (path.compare(start, end == std::string::npos ? std::string::npos : end - start, "..") == 0)
			return "";
		if (end == std::string::npos)
			break;
		start = end + 1;
	}
	return MF_BuildPathname("%s", path.c_str());
}

/** FTP's TLS: "try", "control" or "all" (or a flag, all) - CURLUSESSL_*. */
static long NetSslMode(const std::string &value)
{
	if (value == "try") return CURLUSESSL_TRY;
	if (value == "control") return CURLUSESSL_CONTROL;
	if (value == "none") return CURLUSESSL_NONE;
	return NetFlag(value) ? CURLUSESSL_ALL : CURLUSESSL_NONE;
}

// net_option(id, name, value) - one setting of a request not yet sent: 1 when
// known and taken; 0 for a name it does not know, or a path (`file`,
// `keyFile`) that leaves the game folder.
static int32_t w_net_option(wasm_exec_env_t env, int32_t id, int32_t name, int32_t value)
{
	NetRequest *r = NetOf(env, id, NET_SETTING);
	if (!r)
		return 0;

	std::string key = AsString(Inst(env), name);
	std::string text = AsString(Inst(env), value);

	if (key == "method") r->method = text;
	else if (key == "header") r->headers.push_back(text);
	else if (key == "follow") r->follow = NetFlag(text);
	else if (key == "proxy") r->proxy = text;
	else if (key == "ca") r->ca = text;
	else if (key == "user") r->user = text;
	else if (key == "password") r->password = text;
	else if (key == "keyPassphrase") r->keyPassphrase = text;
	else if (key == "hostKey") r->hostKey = text;
	else if (key == "quote") r->quote.push_back(text);
	else if (key == "postquote") r->postquote.push_back(text);
	else if (key == "upload") r->upload = NetFlag(text);
	else if (key == "list") r->list = NetFlag(text);
	else if (key == "createDirs") r->createDirs = NetFlag(text);
	else if (key == "ssl") r->ssl = NetSslMode(text);
	else if (key == "timeout") r->timeoutMs = atol(text.c_str());
	else if (key == "keyFile" || key == "file") {
		std::string path = NetGamePath(text);
		if (path.empty())
			return 0;
		if (key == "keyFile") {
			r->keyFile = path;
		}
		else {
			r->fileName = text;
			r->file = path;
		}
	}
	else return 0;
	return 1;
}

// net_body(id, data, length) - the bytes sent with a request.
static void w_net_body(wasm_exec_env_t env, int32_t id, int32_t data, int32_t length)
{
	NetRequest *r = NetOf(env, id, NET_SETTING);
	wasm_module_inst_t inst = Inst(env);
	if (!r || length < 0 || (length > 0 && !wasm_runtime_validate_app_addr(inst, (uint64_t)data, (uint64_t)length)))
		return;
	r->body.assign(length ? (const char *)wasm_runtime_addr_app_to_native(inst, (uint64_t)data) : "", (size_t)length);
	r->hasBody = true;
}

// net_send(id, fn) - starts a request; `fn(id)` is called on the frame it ends. 1 when it started.
static int32_t w_net_send(wasm_exec_env_t env, int32_t id, int32_t fn)
{
	NetRequest *r = NetOf(env, id, NET_SETTING);
	if (!r)
		return 0;
	if (!NetEnsureWorker()) {
		MF_PrintSrvConsole("[amxts] the network client did not start\n");
		return 0;
	}

	r->fn = (uint32_t)fn;
	r->sent = true;
	{
		std::lock_guard<std::mutex> lock(g_netLock);
		g_netIncoming.push_back(r);
	}
	curl_multi_wakeup(g_netMulti);
	return 1;
}

// net_cancel(id) - takes a request back; its callback is never called.
static void w_net_cancel(wasm_exec_env_t env, int32_t id)
{
	NetRequest *r = NetOf(env, id, NET_ANY);
	if (r)
		NetCancel(r);
}

// net_close(id) - lets an ended request go.
static void w_net_close(wasm_exec_env_t env, int32_t id)
{
	NetRequest *r = NetOf(env, id, NET_ANY);
	if (r)
		NetCancel(r);
}

// net_status(id) - the response's status, such as 200; -1 when there was no response.
static int32_t w_net_status(wasm_exec_env_t env, int32_t id)
{
	NetRequest *r = NetOf(env, id, NET_ENDED);
	if (!r)
		return -1;
	return r->code == CURLE_OK ? (int32_t)r->status : -1;
}

// net_redirects(id) - how many redirects the request followed.
static int32_t w_net_redirects(wasm_exec_env_t env, int32_t id)
{
	NetRequest *r = NetOf(env, id, NET_ENDED);
	return r ? (int32_t)r->redirects : 0;
}

// net_text(id, what, out, max) - a text of the outcome, as UTF-8: its length, `max` bytes of it copied.
static int32_t w_net_text(wasm_exec_env_t env, int32_t id, int32_t what, int32_t out, int32_t max)
{
	NetRequest *r = NetOf(env, id, NET_ENDED);
	if (!r)
		return 0;
	if (what == NET_TEXT_KIND)
		return CopyText(Inst(env), NetErrorKind(r->code), out, max);
	const std::string *text = what == NET_TEXT_ERROR ? &r->error
		: what == NET_TEXT_STATUS ? &r->statusText
		: what == NET_TEXT_URL ? &r->finalUrl
		: what == NET_TEXT_HEADERS ? &r->responseHeaders
		: NULL;
	return text ? CopyText(Inst(env), *text, out, max) : 0;
}

// net_reply(id) - the protocol's last reply code, a failed request's too:
// HTTP's status, FTP's reply (230, 550), SFTP's status (2 for no such
// file); 0 when there was none.
static int32_t w_net_reply(wasm_exec_env_t env, int32_t id)
{
	NetRequest *r = NetOf(env, id, NET_ENDED);
	return r ? (int32_t)r->reply : 0;
}

// net_size(id) - the response body's length in bytes.
static int32_t w_net_size(wasm_exec_env_t env, int32_t id)
{
	NetRequest *r = NetOf(env, id, NET_ENDED);
	return r ? (int32_t)r->response.size() : 0;
}

// net_read(id, out, max) - the response body: its length, `max` bytes of it copied.
static int32_t w_net_read(wasm_exec_env_t env, int32_t id, int32_t out, int32_t max)
{
	NetRequest *r = NetOf(env, id, NET_ENDED);
	return r ? CopyText(Inst(env), r->response, out, max) : 0;
}
