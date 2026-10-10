-- Disposable #461 cluster only. This is a proof ownership marker, not a product migration.
CREATE SCHEMA proof_461;
CREATE TABLE proof_461.owner (session text PRIMARY KEY);
INSERT INTO proof_461.owner VALUES ('platform-461-codex-20261010-identity');
CREATE DATABASE telegram461;
\connect telegram461
CREATE SCHEMA proof_461;
CREATE TABLE proof_461.owner (session text PRIMARY KEY);
INSERT INTO proof_461.owner VALUES ('platform-461-codex-20261010-identity');
