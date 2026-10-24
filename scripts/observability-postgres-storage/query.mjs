// @ts-check
/** Fixed ordinary PostgreSQL18.4 source. No client is allocated on import. */
export const SQL = `SELECT
  current_setting('server_version_num') AS version_num,
  current_setting('track_counts') AS track_counts,
  current_setting('track_activities') AS track_activities,
  current_setting('transaction_read_only') AS read_only,
  (NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
   AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
   AND r.rolcanlogin AND r.rolconnlimit = 1
   AND NOT pg_has_role(current_user, 'pg_read_all_stats', 'USAGE')
   AND NOT pg_has_role(current_user, 'pg_monitor', 'USAGE')) AS role_safe,
  (current_database() = 'tracking') AS database_scope_ok,
  (current_user = 'postgres_source_reader') AS sampler_role_ok,
  ((extract(epoch FROM statement_timestamp()) * 1000000)::bigint)::text AS sample_us,
  ((extract(epoch FROM pg_postmaster_start_time()) * 1000000)::bigint)::text AS postmaster_us,
  ((extract(epoch FROM d.stats_reset) * 1000000)::bigint)::text AS stats_reset_us,
  d.numbackends::text AS connected_backends,
  (SELECT count(*)::text
     FROM pg_catalog.pg_locks AS l
     JOIN pg_catalog.pg_stat_activity AS a ON a.pid = l.pid
    WHERE a.datid = d.datid AND l.granted = false) AS waiting_locks,
  d.deadlocks::text AS deadlocks
FROM pg_catalog.pg_stat_database AS d
JOIN pg_catalog.pg_roles AS r ON r.rolname = current_user
WHERE d.datname = current_database()
LIMIT 2;`;
export const controls = Object.freeze([
  "BEGIN READ ONLY",
  "SET LOCAL search_path = pg_catalog",
  "SET LOCAL statement_timeout = '2000ms'",
  "SET LOCAL lock_timeout = '250ms'",
  "SET LOCAL idle_in_transaction_session_timeout = '3000ms'",
  "SET LOCAL stats_fetch_consistency = 'cache'",
]);
/** @type {readonly (readonly [string,number])[]} */
const fieldList = [
  ["version_num", 25],
  ["track_counts", 25],
  ["track_activities", 25],
  ["read_only", 25],
  ["role_safe", 16],
  ["database_scope_ok", 16],
  ["sampler_role_ok", 16],
  ["sample_us", 25],
  ["postmaster_us", 25],
  ["stats_reset_us", 25],
  ["connected_backends", 25],
  ["waiting_locks", 25],
  ["deadlocks", 25],
];
export const fields = Object.freeze(
  fieldList.map((field) => Object.freeze(field)),
);
/** @returns {never} */
function refuse() {
  throw new Error("malformed");
}
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is unknown[]} */
function array(value) {
  return Array.isArray(value);
}
/** @param {unknown} value */
function integer(value) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,15})$/.test(value))
    return refuse();
  const result = Number(value);
  if (!Number.isSafeInteger(result)) return refuse();
  return result;
}
/** @param {unknown} raw @param {number} completedUs */
export function decode(raw, completedUs) {
  if (
    !object(raw) ||
    Object.keys(raw).sort().join(",") !== "fields,rows,schema" ||
    raw["schema"] !== 1 ||
    !array(raw["fields"]) ||
    raw["fields"].length !== 13 ||
    !array(raw["rows"]) ||
    raw["rows"].length !== 1 ||
    !array(raw["rows"][0]) ||
    raw["rows"][0].length !== 13 ||
    !Number.isSafeInteger(completedUs) ||
    completedUs <= 0
  )
    return refuse();
  for (const [index, [name, oid]] of fields.entries()) {
    const field = raw["fields"][index];
    if (
      !object(field) ||
      Object.keys(field).sort().join(",") !== "name,oid" ||
      field["name"] !== name ||
      field["oid"] !== oid
    )
      return refuse();
  }
  // Bound the complete logical IPC only; pg's wire parser has no such allocation cap.
  if (Buffer.byteLength(JSON.stringify(raw)) > 4096) return refuse();
  const row = raw["rows"][0];
  if (
    row[0] !== "180004" ||
    row[1] !== "on" ||
    row[2] !== "on" ||
    row[3] !== "on" ||
    row[4] !== true ||
    row[5] !== true ||
    row[6] !== true
  )
    return refuse();
  if (row[9] === null) throw new Error("identity_unavailable");
  const sample_us = integer(row[7]),
    postmaster_us = integer(row[8]),
    stats_reset_us = integer(row[9]);
  const connected_backends = integer(row[10]),
    waiting_locks = integer(row[11]),
    deadlocks = integer(row[12]);
  if (
    sample_us <= 0 ||
    postmaster_us <= 0 ||
    stats_reset_us <= 0 ||
    postmaster_us > sample_us ||
    stats_reset_us > sample_us ||
    Math.abs(completedUs - sample_us) > 2_000_000 ||
    connected_backends > 1_000_000 ||
    waiting_locks > 1_000_000
  )
    return refuse();
  return {
    sample_us,
    postmaster_us,
    stats_reset_us,
    connected_backends,
    waiting_locks,
    deadlocks,
  };
}
/** Driver metadata is validated before its private fields can be discarded.
 * @param {unknown} result @param {number} completedUs */
export function packet(result, completedUs) {
  if (
    !object(result) ||
    result["command"] !== "SELECT" ||
    result["rowCount"] !== 1 ||
    !array(result["fields"]) ||
    result["fields"].length !== 13 ||
    !array(result["rows"])
  )
    return refuse();
  const projected = result["fields"].map((field, index) => {
    const expected = fields[index];
    if (
      !object(field) ||
      expected === undefined ||
      field["name"] !== expected[0] ||
      field["dataTypeID"] !== expected[1] ||
      field["format"] !== "text"
    )
      return refuse();
    return { name: expected[0], oid: expected[1] };
  });
  const value = { schema: 1, fields: projected, rows: result["rows"] };
  decode(value, completedUs);
  const wire = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(wire) > 4096) return refuse();
  return wire;
}
