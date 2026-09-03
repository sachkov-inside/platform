const { Pool } = await import("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  await pool.query(`
    select id, video_id, state, provider_request_id
    from videos.deletion_operations
    limit 0
  `);
} finally {
  await pool.end();
}
