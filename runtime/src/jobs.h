// Work that would hold the game up - compressing, inflating an archive's
// files, reading and writing a file's bytes - for @amxts/core/zlib and
// @amxts/core/fs. A job copies what it is given, so the plugin's memory may
// change under it. job_start hands it to a worker thread of its own, started
// with the first one, and what has ended comes back once a frame (JobsFrame,
// from server_frame), where the plugin's callback is called with the job's
// id and reads the outcome (job_size, job_read, job_crc, job_error) before it
// lets the job go (job_close). job_run does the same work at once, on the
// game thread: the synchronous functions.
//
// One worker, one queue: jobs run in the order they were started, so two
// writes to a file land in order. Who touches a job: the game thread until
// it is started and after it is back; the worker in between. `cancelled` is
// the game thread's alone.
//
// Included by module.cpp after files.h (GamePath, zlib) and Fire.
#pragma once

#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>

// The most an inflate of an unknown size may give; past it the job fails
// rather than the server running out of memory.
#define JOB_MAX_OUTPUT (64 * 1024 * 1024)

// What a job does, as the facade numbers it.
enum JobOp {
	JOB_OP_COPY,
	JOB_OP_DEFLATE,
	JOB_OP_INFLATE,
	JOB_OP_GZIP,
	JOB_OP_GUNZIP,
	JOB_OP_DEFLATE_RAW,
	JOB_OP_INFLATE_RAW,
	JOB_OP_READ,
	JOB_OP_WRITE,
	JOB_OP_APPEND,
};

struct Job {
	int32_t            id;
	wasm_module_inst_t inst;
	uint32_t           fn;
	bool               sent;
	bool               cancelled;

	int         op;
	std::string path;   // a file's, made absolute; "" for the others
	std::string input;
	int32_t     size;   // what an inflate must give, or -1 when it is not known

	bool        ok;
	std::string output;
	uint32_t    crc;
	std::string error;

	Job() : id(0), inst(NULL), fn(0), sent(false), cancelled(false), op(JOB_OP_COPY), size(-1), ok(false), crc(0) {}
};

// The game thread's: every job a plugin holds, by id.
static std::map<int32_t, Job *> g_jobs;
static int32_t g_jobNextId = 1;

// Between the threads, under g_jobLock.
static std::mutex              g_jobLock;
static std::condition_variable g_jobWake;
static std::deque<Job *>       g_jobQueue;
static std::vector<Job *>      g_jobDone;
static bool                    g_jobStop = false;

static std::thread *g_jobThread = NULL;

// ---------------------------------------------------------------- the work

/** zlib's window bits for an operation: zlib's own wrapper, gzip's, or none. */
static int JobWindow(int op)
{
	if (op == JOB_OP_GZIP || op == JOB_OP_GUNZIP)
		return MAX_WBITS + 16;
	if (op == JOB_OP_DEFLATE_RAW || op == JOB_OP_INFLATE_RAW)
		return -MAX_WBITS;
	return MAX_WBITS;
}

static bool JobDeflate(Job *j)
{
	z_stream s;
	memset(&s, 0, sizeof(s));
	if (deflateInit2(&s, Z_DEFAULT_COMPRESSION, Z_DEFLATED, JobWindow(j->op), 8, Z_DEFAULT_STRATEGY) != Z_OK) {
		j->error = "zlib did not start";
		return false;
	}
	j->output.resize(deflateBound(&s, (uLong)j->input.size()));
	s.next_in = (Bytef *)j->input.data();
	s.avail_in = (uInt)j->input.size();
	s.next_out = (Bytef *)&j->output[0];
	s.avail_out = (uInt)j->output.size();
	int result = deflate(&s, Z_FINISH);
	j->output.resize(s.total_out);
	deflateEnd(&s);
	if (result != Z_STREAM_END)
		j->error = "zlib could not compress the data";
	return result == Z_STREAM_END;
}

/** Inflates into `size` bytes when the size is known, else into a buffer that grows up to JOB_MAX_OUTPUT. */
static bool JobInflate(Job *j)
{
	z_stream s;
	memset(&s, 0, sizeof(s));
	if (inflateInit2(&s, JobWindow(j->op)) != Z_OK) {
		j->error = "zlib did not start";
		return false;
	}
	s.next_in = (Bytef *)j->input.data();
	s.avail_in = (uInt)j->input.size();

	size_t room = j->size >= 0 ? (size_t)j->size : j->input.size() * 4 + 1024;
	int result = Z_OK;
	for (;;) {
		j->output.resize(room);
		s.next_out = (Bytef *)&j->output[0] + s.total_out;
		s.avail_out = (uInt)(room - s.total_out);
		result = inflate(&s, Z_FINISH);
		if (result != Z_BUF_ERROR || s.avail_out != 0 || j->size >= 0 || room >= JOB_MAX_OUTPUT)
			break;
		room = room * 2 < JOB_MAX_OUTPUT ? room * 2 : JOB_MAX_OUTPUT;
	}
	j->output.resize(s.total_out);

	bool ok = result == Z_STREAM_END && (j->size < 0 || s.total_out == (uLong)j->size);
	if (!ok) {
		j->error = s.msg ? s.msg
			: j->size < 0 && s.avail_out == 0 && s.avail_in != 0 ? "the inflated data is larger than 64 MB"
			: "unexpected end of file";
	}
	inflateEnd(&s);
	return ok;
}

static bool JobRead(Job *j)
{
	FILE *file = j->path.empty() ? NULL : fopen(j->path.c_str(), "rb");
	if (!file)
		return false;
	fseek(file, 0, SEEK_END);
	long size = ftell(file);
	fseek(file, 0, SEEK_SET);
	j->output.resize(size > 0 ? (size_t)size : 0);
	size_t read = size > 0 ? fread(&j->output[0], 1, (size_t)size, file) : 0;
	j->output.resize(read);
	fclose(file);
	return true;
}

static bool JobWrite(Job *j)
{
	FILE *file = j->path.empty() ? NULL : fopen(j->path.c_str(), j->op == JOB_OP_APPEND ? "ab" : "wb");
	if (!file)
		return false;
	size_t written = j->input.empty() ? 0 : fwrite(j->input.data(), 1, j->input.size(), file);
	return fclose(file) == 0 && written == j->input.size();
}

static void JobDo(Job *j)
{
	switch (j->op) {
	case JOB_OP_COPY:        j->output.swap(j->input); j->ok = true; break;
	case JOB_OP_DEFLATE:
	case JOB_OP_GZIP:
	case JOB_OP_DEFLATE_RAW: j->ok = JobDeflate(j); break;
	case JOB_OP_INFLATE:
	case JOB_OP_GUNZIP:
	case JOB_OP_INFLATE_RAW: j->ok = JobInflate(j); break;
	case JOB_OP_READ:        j->ok = JobRead(j); break;
	case JOB_OP_WRITE:
	case JOB_OP_APPEND:      j->ok = JobWrite(j); break;
	}
	// The checksum zip keeps for a file: extract checks an entry against it.
	if (j->ok && (j->op == JOB_OP_COPY || j->op == JOB_OP_INFLATE_RAW))
		j->crc = (uint32_t)crc32(0L, (const Bytef *)j->output.data(), (uInt)j->output.size());
	std::string().swap(j->input);
}

static void JobWorker()
{
	BlockSignals();
	for (;;) {
		Job *j;
		{
			std::unique_lock<std::mutex> lock(g_jobLock);
			g_jobWake.wait(lock, [] { return g_jobStop || !g_jobQueue.empty(); });
			if (g_jobStop)
				return;
			j = g_jobQueue.front();
			g_jobQueue.pop_front();
		}
		JobDo(j);
		std::lock_guard<std::mutex> lock(g_jobLock);
		g_jobDone.push_back(j);
	}
}

// ---------------------------------------------------------------- the game thread

static void JobDelete(Job *j)
{
	g_jobs.erase(j->id);
	delete j;
}

/** A job of the plugin, set up from what it gave: NULL when a pointer is off its memory. */
static Job *JobMake(wasm_exec_env_t env, int32_t op, int32_t name, int32_t data, int32_t length, int32_t size)
{
	wasm_module_inst_t inst = Inst(env);
	if (op < JOB_OP_COPY || op > JOB_OP_APPEND || length < 0
	    || (length > 0 && !wasm_runtime_validate_app_addr(inst, (uint64_t)data, (uint64_t)length)))
		return NULL;

	Job *j = new Job();
	if (g_jobNextId >= 0x7fff0000)
		g_jobNextId = 1;
	j->id = g_jobNextId++;
	j->inst = inst;
	j->op = op;
	j->size = size;
	if (op >= JOB_OP_READ)
		j->path = GamePath(AsString(inst, name));
	if (length > 0)
		j->input.assign((const char *)wasm_runtime_addr_app_to_native(inst, (uint64_t)data), (size_t)length);
	g_jobs[j->id] = j;
	return j;
}

/** Takes a job back: one the worker holds is deleted when it comes back. */
static void JobCancel(Job *j)
{
	if (j->sent)
		j->cancelled = true;
	else
		JobDelete(j);
}

/** Every job of a plugin goes: the plugin is being unloaded. */
static void JobsForget(wasm_module_inst_t inst)
{
	std::vector<Job *> its;
	for (std::map<int32_t, Job *>::iterator it = g_jobs.begin(); it != g_jobs.end(); ++it)
		if (it->second->inst == inst)
			its.push_back(it->second);
	for (size_t i = 0; i < its.size(); i++)
		JobCancel(its[i]);
}

/** Stops the worker and deletes every job: the module is detaching. */
static void JobsShutdown()
{
	if (g_jobThread) {
		{
			std::lock_guard<std::mutex> lock(g_jobLock);
			g_jobStop = true;
		}
		g_jobWake.notify_one();
		g_jobThread->join();
		delete g_jobThread;
		g_jobThread = NULL;
	}
	for (std::map<int32_t, Job *>::iterator it = g_jobs.begin(); it != g_jobs.end(); ++it)
		delete it->second;
	g_jobs.clear();
	g_jobQueue.clear();
	g_jobDone.clear();
}

/** Once a frame: what has ended goes to its plugin's callback, or is deleted when the plugin took it back or is gone. */
static void JobsFrame()
{
	if (!g_jobThread)
		return;

	std::vector<Job *> done;
	{
		std::lock_guard<std::mutex> lock(g_jobLock);
		if (g_jobDone.empty())
			return;
		done.swap(g_jobDone);
	}

	for (size_t i = 0; i < done.size(); i++) {
		Job *j = done[i];
		j->sent = false;

		int plugin = -1;
		for (size_t p = 0; p < g_plugins.size(); p++)
			if (g_plugins[p].inst == j->inst)
				plugin = (int)p;

		if (j->cancelled || plugin < 0) {
			JobDelete(j);
			continue;
		}

		Handler h;
		h.plugin = plugin;
		h.fn = j->fn;
		h.shape = SHAPE_NARROW;
		uint32_t argv[1] = { (uint32_t)j->id };
		Fire(h, argv, 1, 0);
	}
}

// ---------------------------------------------------------------- natives

/** The plugin's job by id, when it is not the worker's; NULL else. */
static Job *JobOf(wasm_exec_env_t env, int32_t id)
{
	std::map<int32_t, Job *>::iterator it = g_jobs.find(id);
	if (it == g_jobs.end() || it->second->inst != Inst(env) || it->second->sent)
		return NULL;
	return it->second;
}

// job_start(op, path, data, length, size, fn) - a job on the worker: `fn(id)`
// is called on the frame it ends. `path` is a file of the game folder for
// read, write and append; `size` what an inflate must give, or -1. Its id,
// or 0 when it did not start.
static int32_t w_job_start(wasm_exec_env_t env, int32_t op, int32_t name, int32_t data, int32_t length, int32_t size, int32_t fn)
{
	Job *j = JobMake(env, op, name, data, length, size);
	if (!j)
		return 0;
	if (!g_jobThread) {
		g_jobStop = false;
		g_jobThread = new std::thread(JobWorker);
	}

	j->fn = (uint32_t)fn;
	j->sent = true;
	{
		std::lock_guard<std::mutex> lock(g_jobLock);
		g_jobQueue.push_back(j);
	}
	g_jobWake.notify_one();
	return j->id;
}

// job_run(op, path, data, length, size) - the same job done at once: its id, ended; 0 when it could not be made.
static int32_t w_job_run(wasm_exec_env_t env, int32_t op, int32_t name, int32_t data, int32_t length, int32_t size)
{
	Job *j = JobMake(env, op, name, data, length, size);
	if (!j)
		return 0;
	JobDo(j);
	return j->id;
}

// job_size(id) - the output's length in bytes; -1 when the job failed.
static int32_t w_job_size(wasm_exec_env_t env, int32_t id)
{
	Job *j = JobOf(env, id);
	return j && j->ok ? (int32_t)j->output.size() : -1;
}

// job_read(id, out, max) - the output: its length, `max` bytes of it copied.
static int32_t w_job_read(wasm_exec_env_t env, int32_t id, int32_t out, int32_t max)
{
	Job *j = JobOf(env, id);
	return j ? CopyText(Inst(env), j->output, out, max) : 0;
}

// job_crc(id) - the CRC-32 of a copy's or a raw inflate's output, as zip keeps it.
static int32_t w_job_crc(wasm_exec_env_t env, int32_t id)
{
	Job *j = JobOf(env, id);
	return j ? (int32_t)j->crc : 0;
}

// job_error(id, out, max) - why the job failed, as UTF-8: its length, `max` bytes of it copied.
static int32_t w_job_error(wasm_exec_env_t env, int32_t id, int32_t out, int32_t max)
{
	Job *j = JobOf(env, id);
	return j ? CopyText(Inst(env), j->error, out, max) : 0;
}

// job_close(id) - lets a job go; one under way is never called back.
static void w_job_close(wasm_exec_env_t env, int32_t id)
{
	std::map<int32_t, Job *>::iterator it = g_jobs.find(id);
	if (it != g_jobs.end() && it->second->inst == Inst(env))
		JobCancel(it->second);
}
