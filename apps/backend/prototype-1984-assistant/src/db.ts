// PROTOTYPE, throwaway (#1984). Scratch database: docker container prototype-1984-pg on port 55984.
import pg from "pg";

export const pool = new pg.Pool({
  connectionString: process.env.PROTO_DB ?? "postgres://postgres:proto@localhost:55984/proto",
  max: 8,
});
