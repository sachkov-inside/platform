export const name = "0088_web_telemetry_percentile_index";
export const statement = `
-- Nonnegative finite IEEE-754 values sort by their network bytes. Canonicalize signed zero;
-- retain the original float for percentile interpolation. Bytea permits B-tree deduplication,
-- unlike float8 or an INCLUDE index, so repeated values need not duplicate the whole key.
ALTER TABLE web_telemetry.vital_samples
 ADD COLUMN sample_day date GENERATED ALWAYS AS ((occurred_at AT TIME ZONE 'UTC')::date) STORED,
 ADD COLUMN value_key bytea GENERATED ALWAYS AS (float8send(CASE WHEN value=0 THEN 0::float8 ELSE value END)) STORED;
DROP INDEX web_telemetry.vital_samples_summary;
CREATE INDEX vital_samples_summary ON web_telemetry.vital_samples(route_id,device_class,metric,value_key,sample_day);
`;
