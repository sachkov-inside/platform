-- Schema-only fixture: exact upstream ec0ff50388c264ed8ce46f00967e92f7e71476ae migrations, no Umami application runtime.
-- MIT License
--
-- Copyright (c) 2022 Umami Software, Inc. <hello@umami.is>
--
-- Permission is hereby granted, free of charge, to any person obtaining a copy
-- of this software and associated documentation files (the "Software"), to deal
-- in the Software without restriction, including without limitation the rights
-- to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
-- copies of the Software, and to permit persons to whom the Software is
-- furnished to do so, subject to the following conditions:
--
-- The above copyright notice and this permission notice shall be included in
-- all copies or substantial portions of the Software.
--
-- THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
-- IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
-- FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
-- AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
-- LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
-- OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
-- THE SOFTWARE.

-- Source: prisma/migrations/01_init/migration.sql
-- SHA256: 65f0f9ee4a3b432e7fa917795033254887497a849d95acf7d9cb4ff24b45f98f
-- Source-Bytes: 5822
-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "user" (
    "user_id" UUID NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "password" VARCHAR(60) NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "session" (
    "session_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "hostname" VARCHAR(100),
    "browser" VARCHAR(20),
    "os" VARCHAR(20),
    "device" VARCHAR(20),
    "screen" VARCHAR(11),
    "language" VARCHAR(35),
    "country" CHAR(2),
    "subdivision1" VARCHAR(20),
    "subdivision2" VARCHAR(50),
    "city" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("session_id")
);

-- CreateTable
CREATE TABLE "website" (
    "website_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "domain" VARCHAR(500),
    "share_id" VARCHAR(50),
    "reset_at" TIMESTAMPTZ(6),
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "website_pkey" PRIMARY KEY ("website_id")
);

-- CreateTable
CREATE TABLE "website_event" (
    "event_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "url_path" VARCHAR(500) NOT NULL,
    "url_query" VARCHAR(500),
    "referrer_path" VARCHAR(500),
    "referrer_query" VARCHAR(500),
    "referrer_domain" VARCHAR(500),
    "page_title" VARCHAR(500),
    "event_type" INTEGER NOT NULL DEFAULT 1,
    "event_name" VARCHAR(50),

    CONSTRAINT "website_event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_data" (
    "event_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "website_event_id" UUID NOT NULL,
    "event_key" VARCHAR(500) NOT NULL,
    "event_string_value" VARCHAR(500),
    "event_numeric_value" DECIMAL(19,4),
    "event_date_value" TIMESTAMPTZ(6),
    "event_data_type" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_data_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "team" (
    "team_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "access_code" VARCHAR(50),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "team_pkey" PRIMARY KEY ("team_id")
);

-- CreateTable
CREATE TABLE "team_user" (
    "team_user_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "team_user_pkey" PRIMARY KEY ("team_user_id")
);

-- CreateTable
CREATE TABLE "team_website" (
    "team_website_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_website_pkey" PRIMARY KEY ("team_website_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_user_id_key" ON "user"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_username_key" ON "user"("username");

-- CreateIndex
CREATE UNIQUE INDEX "session_session_id_key" ON "session"("session_id");

-- CreateIndex
CREATE INDEX "session_created_at_idx" ON "session"("created_at");

-- CreateIndex
CREATE INDEX "session_website_id_idx" ON "session"("website_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_website_id_key" ON "website"("website_id");

-- CreateIndex
CREATE UNIQUE INDEX "website_share_id_key" ON "website"("share_id");

-- CreateIndex
CREATE INDEX "website_user_id_idx" ON "website"("user_id");

-- CreateIndex
CREATE INDEX "website_created_at_idx" ON "website"("created_at");

-- CreateIndex
CREATE INDEX "website_share_id_idx" ON "website"("share_id");

-- CreateIndex
CREATE INDEX "website_event_created_at_idx" ON "website_event"("created_at");

-- CreateIndex
CREATE INDEX "website_event_session_id_idx" ON "website_event"("session_id");

-- CreateIndex
CREATE INDEX "website_event_website_id_idx" ON "website_event"("website_id");

-- CreateIndex
CREATE INDEX "website_event_website_id_created_at_idx" ON "website_event"("website_id", "created_at");

-- CreateIndex
CREATE INDEX "website_event_website_id_session_id_created_at_idx" ON "website_event"("website_id", "session_id", "created_at");

-- CreateIndex
CREATE INDEX "event_data_created_at_idx" ON "event_data"("created_at");

-- CreateIndex
CREATE INDEX "event_data_website_id_idx" ON "event_data"("website_id");

-- CreateIndex
CREATE INDEX "event_data_website_event_id_idx" ON "event_data"("website_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_team_id_key" ON "team"("team_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_access_code_key" ON "team"("access_code");

-- CreateIndex
CREATE INDEX "team_access_code_idx" ON "team"("access_code");

-- CreateIndex
CREATE UNIQUE INDEX "team_user_team_user_id_key" ON "team_user"("team_user_id");

-- CreateIndex
CREATE INDEX "team_user_team_id_idx" ON "team_user"("team_id");

-- CreateIndex
CREATE INDEX "team_user_user_id_idx" ON "team_user"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_website_team_website_id_key" ON "team_website"("team_website_id");

-- CreateIndex
CREATE INDEX "team_website_team_id_idx" ON "team_website"("team_id");

-- CreateIndex
CREATE INDEX "team_website_website_id_idx" ON "team_website"("website_id");

-- AddSystemUser
INSERT INTO "user" (user_id, username, role, password) VALUES ('41e2b680-648e-4b09-bcd7-3e2b10c06264' , 'admin', 'admin', '$2b$10$BUli0c.muyCW1ErNJc3jL.vFRFtFJWrT8/GcR4A.sUdCznaXiqFXa');

-- Source: prisma/migrations/02_report_schema_session_data/migration.sql
-- SHA256: 4cc3c14482cb8700574cbdbdb478a93ccd1cabb0aeed37dfffb77a80278ce575
-- Source-Bytes: 2220
-- AlterTable
ALTER TABLE "event_data" RENAME COLUMN "event_data_type" TO "data_type";
ALTER TABLE "event_data" RENAME COLUMN "event_date_value" TO "date_value";
ALTER TABLE "event_data" RENAME COLUMN "event_id" TO "event_data_id";
ALTER TABLE "event_data" RENAME COLUMN "event_numeric_value" TO "number_value";
ALTER TABLE "event_data" RENAME COLUMN "event_string_value" TO "string_value";

-- CreateTable
CREATE TABLE "session_data" (
    "session_data_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "session_key" VARCHAR(500) NOT NULL,
    "string_value" VARCHAR(500),
    "number_value" DECIMAL(19,4),
    "date_value" TIMESTAMPTZ(6),
    "data_type" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_data_pkey" PRIMARY KEY ("session_data_id")
);

-- CreateTable
CREATE TABLE "report" (
    "report_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "type" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "parameters" VARCHAR(6000) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_pkey" PRIMARY KEY ("report_id")
);

-- CreateIndex
CREATE INDEX "session_data_created_at_idx" ON "session_data"("created_at");

-- CreateIndex
CREATE INDEX "session_data_website_id_idx" ON "session_data"("website_id");

-- CreateIndex
CREATE INDEX "session_data_session_id_idx" ON "session_data"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "report_report_id_key" ON "report"("report_id");

-- CreateIndex
CREATE INDEX "report_user_id_idx" ON "report"("user_id");

-- CreateIndex
CREATE INDEX "report_website_id_idx" ON "report"("website_id");

-- CreateIndex
CREATE INDEX "report_type_idx" ON "report"("type");

-- CreateIndex
CREATE INDEX "report_name_idx" ON "report"("name");

-- EventData migration
UPDATE "event_data"
SET string_value = number_value
WHERE data_type = 2;

UPDATE "event_data"
SET string_value = CONCAT(REPLACE(TO_CHAR(date_value, 'YYYY-MM-DD HH24:MI:SS'), ' ', 'T'), 'Z')
WHERE data_type = 4;

-- Source: prisma/migrations/03_metric_performance_index/migration.sql
-- SHA256: baf86a7adc077bc46ea646d86aabc5f613aeb311e63894366979a18f6a9ca48c
-- Source-Bytes: 2207
-- CreateIndex
CREATE INDEX "event_data_website_id_created_at_idx" ON "event_data"("website_id", "created_at");

-- CreateIndex
CREATE INDEX "event_data_website_id_created_at_event_key_idx" ON "event_data"("website_id", "created_at", "event_key");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_idx" ON "session"("website_id", "created_at");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_hostname_idx" ON "session"("website_id", "created_at", "hostname");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_browser_idx" ON "session"("website_id", "created_at", "browser");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_os_idx" ON "session"("website_id", "created_at", "os");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_device_idx" ON "session"("website_id", "created_at", "device");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_screen_idx" ON "session"("website_id", "created_at", "screen");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_language_idx" ON "session"("website_id", "created_at", "language");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_country_idx" ON "session"("website_id", "created_at", "country");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_subdivision1_idx" ON "session"("website_id", "created_at", "subdivision1");

-- CreateIndex
CREATE INDEX "session_website_id_created_at_city_idx" ON "session"("website_id", "created_at", "city");

-- CreateIndex
CREATE INDEX "website_event_website_id_created_at_url_path_idx" ON "website_event"("website_id", "created_at", "url_path");

-- CreateIndex
CREATE INDEX "website_event_website_id_created_at_url_query_idx" ON "website_event"("website_id", "created_at", "url_query");

-- CreateIndex
CREATE INDEX "website_event_website_id_created_at_referrer_domain_idx" ON "website_event"("website_id", "created_at", "referrer_domain");

-- CreateIndex
CREATE INDEX "website_event_website_id_created_at_page_title_idx" ON "website_event"("website_id", "created_at", "page_title");

-- CreateIndex
CREATE INDEX "website_event_website_id_created_at_event_name_idx" ON "website_event"("website_id", "created_at", "event_name");


-- Source: prisma/migrations/04_team_redesign/migration.sql
-- SHA256: eb0e4ae2ef5204bc67ddb248358a402cd3bd88567d710f808f16c5124e5fd9cb
-- Source-Bytes: 756
/*
  Warnings:

  - You are about to drop the `team_website` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "team" ADD COLUMN     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN     "logo_url" VARCHAR(2183);

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "display_name" VARCHAR(255),
ADD COLUMN     "logo_url" VARCHAR(2183);

-- AlterTable
ALTER TABLE "website" ADD COLUMN     "created_by" UUID,
ADD COLUMN     "team_id" UUID;

-- MigrateData
UPDATE "website" SET created_by = user_id WHERE team_id IS NULL;

-- DropTable
DROP TABLE "team_website";

-- CreateIndex
CREATE INDEX "website_team_id_idx" ON "website"("team_id");

-- CreateIndex
CREATE INDEX "website_created_by_idx" ON "website"("created_by");

-- Source: prisma/migrations/05_add_visit_id/migration.sql
-- SHA256: 12e5b277e41da871b0768118937cef221c4d4f9c3206b719fffba86324df7a11
-- Source-Bytes: 738
-- AlterTable
ALTER TABLE "website_event" ADD COLUMN "visit_id" UUID NULL;

UPDATE "website_event" we
SET visit_id = a.uuid
FROM (SELECT DISTINCT
        s.session_id,
        s.visit_time,
        gen_random_uuid() uuid
    FROM (SELECT DISTINCT session_id,
            date_trunc('hour', created_at) visit_time
        FROM "website_event") s) a
WHERE we.session_id = a.session_id 
    and date_trunc('hour', we.created_at) = a.visit_time;

ALTER TABLE "website_event" ALTER COLUMN "visit_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "website_event_visit_id_idx" ON "website_event"("visit_id");

-- CreateIndex
CREATE INDEX "website_event_website_id_visit_id_created_at_idx" ON "website_event"("website_id", "visit_id", "created_at");

-- Source: prisma/migrations/06_session_data/migration.sql
-- SHA256: fcd8585d077229bb2a16ae4705a79a5bc31cf6cbca089de99f4b1c19cb0a0a17
-- Source-Bytes: 692
-- DropIndex
DROP INDEX IF EXISTS "event_data_website_id_created_at_event_key_idx";

-- AlterTable
ALTER TABLE "event_data" RENAME COLUMN "event_key" TO "data_key";

-- AlterTable
ALTER TABLE "session_data" DROP COLUMN "deleted_at";
ALTER TABLE "session_data" RENAME COLUMN "session_key" TO "data_key";

-- CreateIndex
CREATE INDEX "event_data_website_id_created_at_data_key_idx" ON "event_data"("website_id", "created_at", "data_key");

-- CreateIndex
CREATE INDEX "session_data_session_id_created_at_idx" ON "session_data"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "session_data_website_id_created_at_data_key_idx" ON "session_data"("website_id", "created_at", "data_key");


-- Source: prisma/migrations/07_add_tag/migration.sql
-- SHA256: c38c9605d759b3b00f94076c929b6081d7dbd01a25d2955909fc8d1a6e3276b4
-- Source-Bytes: 206
-- AlterTable
ALTER TABLE "website_event" ADD COLUMN     "tag" VARCHAR(50);

-- CreateIndex
CREATE INDEX "website_event_website_id_created_at_tag_idx" ON "website_event"("website_id", "created_at", "tag");


-- Source: prisma/migrations/08_add_utm_clid/migration.sql
-- SHA256: ad640f709cd22434c088d577a2cf124c275fe3dc53ca249a542ae05af66b07b6
-- Source-Bytes: 485
-- AlterTable
ALTER TABLE "website_event" 
ADD COLUMN     "fbclid" VARCHAR(255),
ADD COLUMN     "gclid" VARCHAR(255),
ADD COLUMN     "li_fat_id" VARCHAR(255),
ADD COLUMN     "msclkid" VARCHAR(255),
ADD COLUMN     "ttclid" VARCHAR(255),
ADD COLUMN     "twclid" VARCHAR(255),
ADD COLUMN     "utm_campaign" VARCHAR(255),
ADD COLUMN     "utm_content" VARCHAR(255),
ADD COLUMN     "utm_medium" VARCHAR(255),
ADD COLUMN     "utm_source" VARCHAR(255),
ADD COLUMN     "utm_term" VARCHAR(255);


-- Source: prisma/migrations/09_update_hostname_region/migration.sql
-- SHA256: e94d9993b17ac5c330ae3f872fd5869fb8095a3f3a7d31d2aaade73dc45fbe9c
-- Source-Bytes: 817
-- AlterTable
ALTER TABLE "website_event" ADD COLUMN     "hostname" VARCHAR(100);

-- DataMigration
UPDATE "website_event" w
SET hostname = s.hostname
FROM "session" s
WHERE s.website_id = w.website_id
    and s.session_id = w.session_id;

-- DropIndex
DROP INDEX IF EXISTS "session_website_id_created_at_hostname_idx";
DROP INDEX IF EXISTS "session_website_id_created_at_subdivision1_idx";

-- AlterTable
ALTER TABLE "session" RENAME COLUMN "subdivision1" TO "region";
ALTER TABLE "session" DROP COLUMN "subdivision2";
ALTER TABLE "session" DROP COLUMN "hostname";

-- CreateIndex
CREATE INDEX "website_event_website_id_created_at_hostname_idx" ON "website_event"("website_id", "created_at", "hostname");
CREATE INDEX "session_website_id_created_at_region_idx" ON "session"("website_id", "created_at", "region");





-- Source: prisma/migrations/10_add_distinct_id/migration.sql
-- SHA256: 6ece5066ccec715ca8a07b65eafde7f96d110c0638b2d2187398fd1a79770ff6
-- Source-Bytes: 162
-- AlterTable
ALTER TABLE "session" ADD COLUMN     "distinct_id" VARCHAR(50);

-- AlterTable
ALTER TABLE "session_data" ADD COLUMN     "distinct_id" VARCHAR(50);


-- Source: prisma/migrations/11_add_segment/migration.sql
-- SHA256: e7421573e8b15f8a5c3e0928f1564ab43b3855d7c6634a36d87ece68196900e5
-- Source-Bytes: 529
-- CreateTable
CREATE TABLE "segment" (
    "segment_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "type" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "parameters" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "segment_pkey" PRIMARY KEY ("segment_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "segment_segment_id_key" ON "segment"("segment_id");

-- CreateIndex
CREATE INDEX "segment_website_id_idx" ON "segment"("website_id");


-- Source: prisma/migrations/12_update_report_parameter/migration.sql
-- SHA256: f74b307b6e62c8457f32c4bae0beb99e26eb384467755912714abdfeae9e09af
-- Source-Bytes: 106
-- AlterTable
ALTER TABLE "report"
ALTER COLUMN "parameters" SET DATA TYPE JSONB USING parameters::JSONB;


-- Source: prisma/migrations/13_add_revenue/migration.sql
-- SHA256: 53180616f450ac033a60143ff9b7c3656205947809c7979a51991922e7f326ad
-- Source-Bytes: 884
-- CreateTable
CREATE TABLE "revenue" (
    "revenue_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_name" VARCHAR(50) NOT NULL,
    "currency" VARCHAR(100) NOT NULL,
    "revenue" DECIMAL(19,4),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_pkey" PRIMARY KEY ("revenue_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "revenue_revenue_id_key" ON "revenue"("revenue_id");

-- CreateIndex
CREATE INDEX "revenue_website_id_idx" ON "revenue"("website_id");

-- CreateIndex
CREATE INDEX "revenue_session_id_idx" ON "revenue"("session_id");

-- CreateIndex
CREATE INDEX "revenue_website_id_created_at_idx" ON "revenue"("website_id", "created_at");

-- CreateIndex
CREATE INDEX "revenue_website_id_session_id_created_at_idx" ON "revenue"("website_id", "session_id", "created_at");


-- Source: prisma/migrations/14_add_link_and_pixel/migration.sql
-- SHA256: 2017fc23cad1365fa62fe1c18b70c631eb6a119a902f88672ffad63f90d80f3d
-- Source-Bytes: 3289
-- AlterTable
ALTER TABLE "report" ALTER COLUMN "type" SET DATA TYPE VARCHAR(50);

-- AlterTable
ALTER TABLE "revenue" ALTER COLUMN "currency" SET DATA TYPE VARCHAR(10);

-- AlterTable
ALTER TABLE "segment" ALTER COLUMN "type" SET DATA TYPE VARCHAR(50);

-- CreateTable
CREATE TABLE "link" (
    "link_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "user_id" UUID,
    "team_id" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "link_pkey" PRIMARY KEY ("link_id")
);

-- CreateTable
CREATE TABLE "pixel" (
    "pixel_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "user_id" UUID,
    "team_id" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "pixel_pkey" PRIMARY KEY ("pixel_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "link_link_id_key" ON "link"("link_id");

-- CreateIndex
CREATE UNIQUE INDEX "link_slug_key" ON "link"("slug");

-- CreateIndex
CREATE INDEX "link_slug_idx" ON "link"("slug");

-- CreateIndex
CREATE INDEX "link_user_id_idx" ON "link"("user_id");

-- CreateIndex
CREATE INDEX "link_team_id_idx" ON "link"("team_id");

-- CreateIndex
CREATE INDEX "link_created_at_idx" ON "link"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "pixel_pixel_id_key" ON "pixel"("pixel_id");

-- CreateIndex
CREATE UNIQUE INDEX "pixel_slug_key" ON "pixel"("slug");

-- CreateIndex
CREATE INDEX "pixel_slug_idx" ON "pixel"("slug");

-- CreateIndex
CREATE INDEX "pixel_user_id_idx" ON "pixel"("user_id");

-- CreateIndex
CREATE INDEX "pixel_team_id_idx" ON "pixel"("team_id");

-- CreateIndex
CREATE INDEX "pixel_created_at_idx" ON "pixel"("created_at");

-- DataMigration Funnel
DELETE FROM "report" WHERE type = 'funnel' and jsonb_array_length(parameters->'steps') = 1;
UPDATE "report" SET parameters = parameters - 'websiteId' - 'dateRange' - 'urls' WHERE type = 'funnel';

UPDATE "report"
SET parameters = jsonb_set(
    parameters,
    '{steps}',
    (
      SELECT jsonb_agg(
               CASE
                 WHEN step->>'type' = 'url'
                 THEN jsonb_set(step, '{type}', '"path"')
                 ELSE step
               END
             )
      FROM jsonb_array_elements(parameters->'steps') step
    )
)
WHERE type = 'funnel'
    and parameters @> '{"steps":[{"type":"url"}]}';

-- DataMigration Goals
UPDATE "report" SET type = 'goal' WHERE type = 'goals';

INSERT INTO "report" (report_id, user_id, website_id, type, name, description, parameters, created_at, updated_at)
SELECT gen_random_uuid(),
    user_id,
    website_id,
    'goal',
    concat(name, ' - ', elem ->> 'value'),
    description,
    jsonb_build_object(
           'type', CASE WHEN elem ->> 'type' = 'url' THEN 'path'
                        ELSE elem ->> 'type' END,
           'value', elem ->> 'value'
       ) AS parameters,
    created_at,
    updated_at
FROM "report"
CROSS JOIN LATERAL jsonb_array_elements(parameters -> 'goals') elem
WHERE type = 'goal'
    and elem ->> 'type' IN ('event', 'url');

DELETE FROM "report" WHERE type = 'goal' and parameters ? 'goals';

-- Source: prisma/migrations/15_add_share/migration.sql
-- SHA256: 11e97bd1bd36611c473ca7f518a8c8c1e66fba5b2798e72db224f7e20477eb74
-- Source-Bytes: 974
-- CreateTable
CREATE TABLE "share" (
    "share_id" UUID NOT NULL,
    "entity_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "share_type" INTEGER NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "parameters" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "share_pkey" PRIMARY KEY ("share_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "share_slug_key" ON "share"("slug");

-- CreateIndex
CREATE INDEX "share_entity_id_idx" ON "share"("entity_id");

-- MigrateData
INSERT INTO "share" (share_id, entity_id, name, share_type, slug, parameters, created_at)
SELECT gen_random_uuid(),
       website_id,
       name,
       1,
       share_id,
       '{"overview":true}'::jsonb,
       now()
FROM "website"
WHERE share_id IS NOT NULL;

-- DropIndex
DROP INDEX "website_share_id_idx";

-- DropIndex
DROP INDEX "website_share_id_key";

-- AlterTable
ALTER TABLE "website" DROP COLUMN "share_id";


-- Source: prisma/migrations/16_boards/migration.sql
-- SHA256: 5cef1484333ad14bcbbc3e1b2262601d3274a072d9656fb422530d112f98b447
-- Source-Bytes: 793
-- CreateTable
CREATE TABLE "board" (
    "board_id" UUID NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "parameters" JSONB NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "user_id" UUID,
    "team_id" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "board_pkey" PRIMARY KEY ("board_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "board_slug_key" ON "board"("slug");

-- CreateIndex
CREATE INDEX "board_slug_idx" ON "board"("slug");

-- CreateIndex
CREATE INDEX "board_user_id_idx" ON "board"("user_id");

-- CreateIndex
CREATE INDEX "board_team_id_idx" ON "board"("team_id");

-- CreateIndex
CREATE INDEX "board_created_at_idx" ON "board"("created_at");


-- Source: prisma/migrations/17_remove_duplicate_key/migration.sql
-- SHA256: 19ef24e157ab33d7a34b13d06c5ffc2eca95ae4f668c1ccbbe219e48a09d13b1
-- Source-Bytes: 489
-- DropIndex
DROP INDEX "link_link_id_key";

-- DropIndex
DROP INDEX "pixel_pixel_id_key";

-- DropIndex
DROP INDEX "report_report_id_key";

-- DropIndex
DROP INDEX "revenue_revenue_id_key";

-- DropIndex
DROP INDEX "segment_segment_id_key";

-- DropIndex
DROP INDEX "session_session_id_key";

-- DropIndex
DROP INDEX "team_team_id_key";

-- DropIndex
DROP INDEX "team_user_team_user_id_key";

-- DropIndex
DROP INDEX "user_user_id_key";

-- DropIndex
DROP INDEX "website_website_id_key";


-- Source: prisma/migrations/18_add_performance/migration.sql
-- SHA256: 4ab4d1d954adfd3e65a327797b8fa2a528aa4377cbe03e2bd79b1d1c33c3b6ae
-- Source-Bytes: 223
-- AlterTable
ALTER TABLE "website_event" ADD COLUMN     "cls" DECIMAL(10,4),
ADD COLUMN     "fcp" DECIMAL(10,1),
ADD COLUMN     "inp" DECIMAL(10,1),
ADD COLUMN     "lcp" DECIMAL(10,1),
ADD COLUMN     "ttfb" DECIMAL(10,1);


-- Source: prisma/migrations/19_add_session_replay/migration.sql
-- SHA256: d0b6047a369c8aa04813fb06ac012c731777a9f3d602d491119f47e57aa2ec09
-- Source-Bytes: 2156
-- AlterTable board: drop slug
DROP INDEX IF EXISTS "board_slug_key";
DROP INDEX IF EXISTS "board_slug_idx";
ALTER TABLE "board" DROP COLUMN IF EXISTS "slug";

-- AlterTable
ALTER TABLE "website" ADD COLUMN "replay_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "website" ADD COLUMN "replay_config" JSONB;

-- CreateTable
CREATE TABLE "session_replay" (
    "replay_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "events" BYTEA NOT NULL,
    "event_count" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "ended_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_replay_pkey" PRIMARY KEY ("replay_id")
);

-- CreateIndex
CREATE INDEX "session_replay_website_id_idx" ON "session_replay"("website_id");
CREATE INDEX "session_replay_session_id_idx" ON "session_replay"("session_id");
CREATE INDEX "session_replay_website_id_session_id_idx" ON "session_replay"("website_id", "session_id");
CREATE INDEX "session_replay_website_id_visit_id_idx" ON "session_replay"("website_id", "visit_id");
CREATE INDEX "session_replay_website_id_created_at_idx" ON "session_replay"("website_id", "created_at");
CREATE INDEX "session_replay_session_id_chunk_index_idx" ON "session_replay"("session_id", "chunk_index");

-- CreateTable
CREATE TABLE "session_replay_saved" (
    "saved_replay_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "website_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "session_replay_saved_pkey" PRIMARY KEY ("saved_replay_id"),
    CONSTRAINT "session_replay_saved_website_id_visit_id_key" UNIQUE ("website_id", "visit_id")
);

-- CreateIndex
CREATE INDEX "session_replay_saved_website_id_idx" ON "session_replay_saved"("website_id");
CREATE INDEX "session_replay_saved_visit_id_idx" ON "session_replay_saved"("visit_id");
CREATE INDEX "session_replay_saved_website_id_created_at_idx" ON "session_replay_saved"("website_id", "created_at");


-- Source: prisma/migrations/20_add_heatmap/migration.sql
-- SHA256: a52c3ae18fcfd73a49e5eaf445f701f0a6978abc96b8a0009aa27b100501663b
-- Source-Bytes: 1236
ALTER TABLE "website" RENAME COLUMN "replay_enabled" TO "recorder_enabled";

UPDATE "website"
SET "replay_config" = COALESCE("replay_config", '{}'::jsonb) || '{"replayEnabled": true}'::jsonb
WHERE "recorder_enabled" = true;

-- CreateTable
CREATE TABLE "heatmap_event" (
    "heatmap_event_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "visit_id" UUID NOT NULL,
    "url_path" VARCHAR(500) NOT NULL,
    "event_type" INTEGER NOT NULL,
    "x" INTEGER,
    "y" INTEGER,
    "page_x" INTEGER,
    "page_y" INTEGER,
    "page_w" INTEGER,
    "viewport_w" INTEGER,
    "viewport_h" INTEGER,
    "page_h" INTEGER,
    "scroll_pct" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heatmap_event_pkey" PRIMARY KEY ("heatmap_event_id")
);

-- CreateIndex
CREATE INDEX "heatmap_event_website_id_idx" ON "heatmap_event"("website_id");
CREATE INDEX "heatmap_event_visit_id_idx" ON "heatmap_event"("visit_id");
CREATE INDEX "heatmap_event_website_id_created_at_idx" ON "heatmap_event"("website_id", "created_at");
CREATE INDEX "heatmap_event_website_id_url_path_event_type_created_at_idx" ON "heatmap_event"("website_id", "url_path", "event_type", "created_at");

-- Source: prisma/migrations/21_add_session_link/migration.sql
-- SHA256: 10b4a7ba0b04bc14703b85787f66dfc6a83cd70abf80bcd528c83966c1effa7c
-- Source-Bytes: 403
-- CreateTable
CREATE TABLE "session_link" (
    "website_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "distinct_id" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_link_pkey" PRIMARY KEY ("website_id","distinct_id","session_id")
);

CREATE INDEX "session_link_website_id_session_id_idx" ON "session_link"("website_id", "session_id");


-- Source: prisma/migrations/22_add_2fa/migration.sql
-- SHA256: e1e8a160496540e0b2fd28610a92f8b0a1b3e4fc1c857ca1d7f890e3667571b4
-- Source-Bytes: 2209
-- AlterTable
ALTER TABLE "team" ADD COLUMN     "two_factor_required" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "two_factor_required" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "two_factor_auth" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "secret" TEXT NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "two_factor_auth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_backup_code" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_backup_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_otp_used" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "otp" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "two_factor_otp_used_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor_rate_limit" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "two_factor_rate_limit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "app_setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_auth_user_id_key" ON "two_factor_auth"("user_id");

-- CreateIndex
CREATE INDEX "two_factor_backup_code_user_id_idx" ON "two_factor_backup_code"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_otp_used_user_id_otp_key" ON "two_factor_otp_used"("user_id", "otp");

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_rate_limit_user_id_key" ON "two_factor_rate_limit"("user_id");

-- Historical catch-up: some environments already have this replay index,
-- but the current schema expects it everywhere.
CREATE INDEX IF NOT EXISTS "session_replay_visit_id_idx" ON "session_replay"("visit_id");

-- Source: prisma/migrations/23_update_session_data/migration.sql
-- SHA256: 5fc778b82bb34c3c04d78061e66d7036c3c51d0c506f5279f3c1cfc99f24f694
-- Source-Bytes: 515
WITH ranked_session_data AS (
  SELECT
    "session_data_id",
    ROW_NUMBER() OVER (
      PARTITION BY "session_id", "data_key"
      ORDER BY "created_at" DESC NULLS LAST, "session_data_id" DESC
    ) AS row_num
  FROM "session_data"
)
DELETE FROM "session_data"
USING ranked_session_data
WHERE "session_data"."session_data_id" = ranked_session_data."session_data_id"
  AND ranked_session_data.row_num > 1;

CREATE UNIQUE INDEX "session_data_session_id_data_key_key"
ON "session_data"("session_id", "data_key");


-- Source: prisma/migrations/24_lowercase_username/migration.sql
-- SHA256: 857c15672654ed5691a104aa1197e761718cbe75de0024c54d813ea19737bdba
-- Source-Bytes: 797
-- Rename only soft-deleted rows that block lowercasing a live username.
UPDATE "user" AS d
SET "username" = CONCAT(LEFT(d."username", 246), '-', SUBSTRING(MD5(d."user_id"::text) FROM 1 FOR 8))
WHERE d."deleted_at" IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM "user" AS a
    WHERE a."deleted_at" IS NULL
      AND a."user_id" <> d."user_id"
      AND a."username" <> LOWER(a."username")
      AND LOWER(a."username") = LOWER(d."username")
  );

-- Lowercase live usernames unless another live row would still collide.
UPDATE "user" AS u
SET "username" = LOWER(u."username")
WHERE u."deleted_at" IS NULL
  AND u."username" <> LOWER(u."username")
  AND NOT EXISTS (
    SELECT 1
    FROM "user" AS c
    WHERE c."user_id" <> u."user_id"
      AND LOWER(c."username") = LOWER(u."username")
  );


-- Source: prisma/migrations/25_add_annotation/migration.sql
-- SHA256: 6da67237e4d1516853a84997ebe9ecfd65fc38187d0561d98a836c437085187d
-- Source-Bytes: 606
-- CreateTable
CREATE TABLE "annotation" (
    "annotation_id" UUID NOT NULL,
    "website_id" UUID NOT NULL,
    "user_id" UUID,
    "date" TIMESTAMPTZ(6) NOT NULL,
    "all_day" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "annotation_pkey" PRIMARY KEY ("annotation_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "annotation_annotation_id_key" ON "annotation"("annotation_id");

-- CreateIndex
CREATE INDEX "annotation_website_id_date_idx" ON "annotation"("website_id", "date");


-- Source: prisma/migrations/26_add_api_key/migration.sql
-- SHA256: 08463808a2c091e2662e1cfae4c6736b3a3fa7c6931abe5fac32cef4b21954e9
-- Source-Bytes: 696
-- CreateTable
CREATE TABLE "api_key" (
    "api_key_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "key_hash" VARCHAR(128) NOT NULL,
    "key_prefix" VARCHAR(20) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("api_key_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_key_key_hash_key" ON "api_key"("key_hash");

-- CreateIndex
CREATE INDEX "api_key_user_id_idx" ON "api_key"("user_id");

-- AddForeignKey
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

