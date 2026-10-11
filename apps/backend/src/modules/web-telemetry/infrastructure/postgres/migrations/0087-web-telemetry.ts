export const name = "0087_web_telemetry";
export const statement = `
CREATE SCHEMA web_telemetry;
CREATE TABLE web_telemetry.route_templates (
 id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, route_template text NOT NULL UNIQUE
);
CREATE TABLE web_telemetry.vital_samples (
 occurred_at timestamptz NOT NULL, route_id integer NOT NULL REFERENCES web_telemetry.route_templates(id),
 device_class text NOT NULL CHECK (device_class IN ('mobile','desktop')),
 metric text NOT NULL CHECK (metric IN ('LCP','INP','CLS','FCP','TTFB')),
 value double precision NOT NULL CHECK (value >= 0 AND value < 'Infinity'::float8)
) WITH (autovacuum_vacuum_scale_factor=0.01, autovacuum_analyze_scale_factor=0.02);
CREATE INDEX vital_samples_summary ON web_telemetry.vital_samples(route_id,device_class,metric) INCLUDE (occurred_at,value);
CREATE INDEX vital_samples_retention ON web_telemetry.vital_samples USING brin(occurred_at);
CREATE TABLE web_telemetry.errors (
 occurred_at timestamptz NOT NULL,
 source text NOT NULL CHECK (source IN ('client','server')),
 digest text NOT NULL CHECK (char_length(digest)<=128),
 route_template text NOT NULL,
 name text NOT NULL CHECK (char_length(name)<=128),
 message text NOT NULL CHECK (char_length(message)<=500)
) WITH (autovacuum_vacuum_scale_factor=0.01, autovacuum_analyze_scale_factor=0.02);
CREATE INDEX errors_retention ON web_telemetry.errors(occurred_at);
CREATE INDEX errors_summary ON web_telemetry.errors(digest,route_template,occurred_at);
CREATE TABLE web_telemetry.daily_quota (
 day date NOT NULL, kind text NOT NULL CHECK (kind IN ('vitals','error')),
 saved integer NOT NULL CHECK (saved>=0 AND saved<=CASE WHEN kind='vitals' THEN 20000 ELSE 5000 END),
 dropped bigint NOT NULL CHECK (dropped>=0), PRIMARY KEY(day,kind)
);
CREATE TABLE web_telemetry.coverage (
 day date NOT NULL, kind text NOT NULL CHECK (kind IN ('vitals','error')),
 route_template text NOT NULL, device_class text NOT NULL CHECK (device_class IN ('mobile','desktop')),
 metric text NOT NULL, saved integer NOT NULL CHECK(saved>=0), dropped bigint NOT NULL CHECK(dropped>=0),
 PRIMARY KEY(day,kind,route_template,device_class,metric)
);
CREATE FUNCTION web_telemetry.record_vital(p_at timestamptz,p_route text,p_device text,p_metric text,p_value double precision) RETURNS void LANGUAGE plpgsql AS $$
DECLARE admitted boolean; route_key integer; p_day date := (p_at AT TIME ZONE 'UTC')::date;
BEGIN
 INSERT INTO web_telemetry.daily_quota(day,kind,saved,dropped) VALUES(p_day,'vitals',1,0)
 ON CONFLICT(day,kind) DO UPDATE SET
  saved=least(web_telemetry.daily_quota.saved+1,20000),
  dropped=web_telemetry.daily_quota.dropped+CASE WHEN web_telemetry.daily_quota.saved<20000 THEN 0 ELSE 1 END
 RETURNING dropped=0 INTO admitted;
 IF admitted THEN
  SELECT id INTO route_key FROM web_telemetry.route_templates WHERE route_template=p_route;
  IF route_key IS NULL THEN
   INSERT INTO web_telemetry.route_templates(route_template) VALUES(p_route)
   ON CONFLICT(route_template) DO UPDATE SET route_template=excluded.route_template RETURNING id INTO route_key;
  END IF;
  INSERT INTO web_telemetry.vital_samples(occurred_at,route_id,device_class,metric,value) VALUES(p_at,route_key,p_device,p_metric,p_value);
 END IF;
 INSERT INTO web_telemetry.coverage(day,kind,route_template,device_class,metric,saved,dropped)
 VALUES(p_day,'vitals',p_route,p_device,p_metric,CASE WHEN admitted THEN 1 ELSE 0 END,CASE WHEN admitted THEN 0 ELSE 1 END)
 ON CONFLICT(day,kind,route_template,device_class,metric) DO UPDATE SET
  saved=web_telemetry.coverage.saved+excluded.saved,dropped=web_telemetry.coverage.dropped+excluded.dropped;
END; $$;
CREATE FUNCTION web_telemetry.record_error(p_at timestamptz,p_route text,p_device text,p_source text,p_digest text,p_name text,p_message text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE admitted boolean; p_day date := (p_at AT TIME ZONE 'UTC')::date;
BEGIN
 INSERT INTO web_telemetry.daily_quota(day,kind,saved,dropped) VALUES(p_day,'error',1,0)
 ON CONFLICT(day,kind) DO UPDATE SET
  saved=least(web_telemetry.daily_quota.saved+1,5000),
  dropped=web_telemetry.daily_quota.dropped+CASE WHEN web_telemetry.daily_quota.saved<5000 THEN 0 ELSE 1 END
 RETURNING dropped=0 INTO admitted;
 IF admitted THEN INSERT INTO web_telemetry.errors(occurred_at,source,digest,route_template,name,message) VALUES(p_at,p_source,left(p_digest,128),p_route,left(p_name,128),left(p_message,500)); END IF;
 INSERT INTO web_telemetry.coverage(day,kind,route_template,device_class,metric,saved,dropped)
 VALUES(p_day,'error',p_route,p_device,'',CASE WHEN admitted THEN 1 ELSE 0 END,CASE WHEN admitted THEN 0 ELSE 1 END)
 ON CONFLICT(day,kind,route_template,device_class,metric) DO UPDATE SET
  saved=web_telemetry.coverage.saved+excluded.saved,dropped=web_telemetry.coverage.dropped+excluded.dropped;
END; $$;
CREATE VIEW web_telemetry.health AS
 WITH windows AS (
  SELECT count(*) FILTER (WHERE occurred_at > now()-interval '10 minutes') AS recent,
         count(*) FILTER (WHERE occurred_at <= now()-interval '10 minutes') AS previous
  FROM web_telemetry.errors WHERE occurred_at > now()-interval '20 minutes'
 )
 SELECT 'web_telemetry_growth'::text AS name,
  CASE WHEN recent>=10 AND recent>=3*previous THEN 1 ELSE 0 END::bigint AS value FROM windows
 UNION ALL
 SELECT 'web_telemetry_digest', count(*) FROM (
  SELECT DISTINCT e.digest,e.route_template FROM web_telemetry.errors e
  WHERE e.digest<>'' AND e.occurred_at>now()-interval '10 minutes'
   AND NOT EXISTS (SELECT 1 FROM web_telemetry.errors older
    WHERE older.digest=e.digest AND older.route_template=e.route_template
     AND older.occurred_at<=now()-interval '10 minutes')
 ) fresh
 UNION ALL
 SELECT 'web_telemetry_size', CASE WHEN coalesce(sum(CASE WHEN c.relkind='S' THEN pg_relation_size(c.oid) ELSE pg_total_relation_size(c.oid) END),0)>=480000000 THEN 1 ELSE 0 END
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='web_telemetry' AND c.relkind IN ('r','m','S')
 UNION ALL
 SELECT 'web_telemetry_dropped', coalesce(sum(dropped),0)::bigint FROM web_telemetry.daily_quota
 WHERE day=(now() AT TIME ZONE 'UTC')::date;
`;
