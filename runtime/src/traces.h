// Traces through the world - a line, a hull - what is at a point, and an
// entity dropped to the floor: the engine's own calls, for trace.line,
// trace.hull, trace.pointContents and entity.dropToFloor.
//
// Included by module.cpp, after the client helpers.

// What world_trace_line and world_trace_hull write at `out`, ten doubles:
// the fraction, the end, the plane's normal, the entity hit (-1 none), the
// TRACE_* flags, the hit group.
#define TRACE_DOUBLES 10
#define TRACE_START_SOLID 1
#define TRACE_ALL_SOLID   2
#define TRACE_IN_OPEN     4
#define TRACE_IN_WATER    8

// How a trace treats monsters (players among them): trace.line's `monsters`.
#define TRACE_MONSTERS 1

/** The doubles at `at`, `count` of them: a trace's start and end, a point. NULL when they are not the plugin's. */
static const double *TracePoints(wasm_exec_env_t env, int32_t at, int count)
{
	wasm_module_inst_t inst = Inst(env);
	if (!wasm_runtime_validate_app_addr(inst, (uint64_t)at, (uint64_t)count * sizeof(double)))
		return NULL;
	return (const double *)wasm_runtime_addr_app_to_native(inst, (uint64_t)at);
}

static edict_t *TraceIgnored(int32_t ignore)
{
	return ignore > 0 && ignore < gpGlobals->maxEntities ? INDEXENT(ignore) : NULL;
}

static void TraceOut(wasm_exec_env_t env, int32_t out, const TraceResult &tr)
{
	wasm_module_inst_t inst = Inst(env);
	if (!wasm_runtime_validate_app_addr(inst, (uint64_t)out, TRACE_DOUBLES * sizeof(double)))
		return;
	double *d = (double *)wasm_runtime_addr_app_to_native(inst, (uint64_t)out);
	d[0] = tr.flFraction;
	d[1] = tr.vecEndPos.x;
	d[2] = tr.vecEndPos.y;
	d[3] = tr.vecEndPos.z;
	d[4] = tr.vecPlaneNormal.x;
	d[5] = tr.vecPlaneNormal.y;
	d[6] = tr.vecPlaneNormal.z;
	d[7] = tr.pHit && !tr.pHit->free ? ENTINDEX(tr.pHit) : -1;
	d[8] = (tr.fStartSolid ? TRACE_START_SOLID : 0) | (tr.fAllSolid ? TRACE_ALL_SOLID : 0) | (tr.fInOpen ? TRACE_IN_OPEN : 0) | (tr.fInWater ? TRACE_IN_WATER : 0);
	d[9] = tr.iHitgroup;
}

/** world_trace_line(points, flags, ignore, out) - the engine's TraceLine from the start to the end, six doubles at `points`. */
static void w_traceLine(wasm_exec_env_t env, int32_t points, int32_t flags, int32_t ignore, int32_t out)
{
	const double *p = TracePoints(env, points, 6);
	if (!p)
		return;
	Vector start((float)p[0], (float)p[1], (float)p[2]), end((float)p[3], (float)p[4], (float)p[5]);
	TraceResult tr;
	TRACE_LINE(start, end, (flags & TRACE_MONSTERS) ? dont_ignore_monsters : ignore_monsters, TraceIgnored(ignore), &tr);
	TraceOut(env, out, tr);
}

/** world_trace_hull(points, hull, flags, ignore, out) - the engine's TraceHull: 0 point, 1 human, 2 large, 3 head. */
static void w_traceHull(wasm_exec_env_t env, int32_t points, int32_t hull, int32_t flags, int32_t ignore, int32_t out)
{
	const double *p = TracePoints(env, points, 6);
	if (!p)
		return;
	Vector start((float)p[0], (float)p[1], (float)p[2]), end((float)p[3], (float)p[4], (float)p[5]);
	TraceResult tr;
	TRACE_HULL(start, end, (flags & TRACE_MONSTERS) ? dont_ignore_monsters : ignore_monsters, hull, TraceIgnored(ignore), &tr);
	TraceOut(env, out, tr);
}

/** world_contents(point) - the engine's CONTENTS_* at a point, three doubles at `point`. */
static int32_t w_pointContents(wasm_exec_env_t env, int32_t point)
{
	const double *p = TracePoints(env, point, 3);
	if (!p)
		return 0;
	Vector at((float)p[0], (float)p[1], (float)p[2]);
	return POINT_CONTENTS(at);
}

/** entity_drop(id) - the engine's DropToFloor: 1 dropped, 0 in the air still, -1 stuck in something. */
static int32_t w_dropToFloor(wasm_exec_env_t env, int32_t id)
{
	(void)env;
	if (id <= 0 || id >= gpGlobals->maxEntities)
		return 0;
	edict_t *e = INDEXENT(id);
	return e && !e->free ? DROP_TO_FLOOR(e) : 0;
}
