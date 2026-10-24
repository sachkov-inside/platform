"""Explicit one-time dedicated Umami role/database provisioning in the existing cluster.

Run only after deployment authorization. Password travels through stdin, never argv
or logs. Existing login/group CONNECT rights are preserved when PUBLIC is revoked.
"""
import os
from pathlib import Path
import stat
import subprocess


def sql(password):
    if type(password) is not str or not 32<=len(password)<=256 or any(ord(char)<33 or ord(char)>126 for char in password):
        raise ValueError('umami_password')
    literal="'"+password.replace("'","''")+"'"
    return """SET statement_timeout='5s';
SELECT pg_advisory_lock(1566,366);
BEGIN;
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='umami') AND
(EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='umami') OR roleid=(SELECT oid FROM pg_roles WHERE rolname='umami')) OR
 EXISTS(SELECT 1 FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname='umami') AND datname<>'umami'))
THEN RAISE EXCEPTION 'existing Umami role authority requires owner review'; END IF;
IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='umami') THEN CREATE ROLE umami; END IF;
END $$;
ALTER ROLE umami LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 8 PASSWORD """+literal+""";
ALTER ROLE umami SET statement_timeout='5s';
ALTER ROLE umami SET idle_in_transaction_session_timeout='10s';
COMMIT;
SELECT 'CREATE DATABASE umami OWNER umami' WHERE NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='umami')
\\gexec
BEGIN;
DO $$ DECLARE database_name text; role_name text; BEGIN
IF NOT EXISTS(SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname='umami' AND r.rolname='umami') THEN
RAISE EXCEPTION 'unexpected Umami database owner'; END IF;
FOREACH database_name IN ARRAY ARRAY['inside','logto','postgres','template1'] LOOP
  IF EXISTS(SELECT 1 FROM pg_database WHERE datname=database_name) THEN
    FOR role_name IN SELECT rolname FROM pg_roles WHERE rolname NOT IN ('umami','pg_database_owner') AND has_database_privilege(oid,database_name,'CONNECT') LOOP
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO %I',database_name,role_name);
    END LOOP;
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC',database_name);
    EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM umami',database_name);
  END IF;
END LOOP;
END $$;
REVOKE CONNECT ON DATABASE umami FROM PUBLIC;
GRANT CONNECT ON DATABASE umami TO umami;
COMMIT;
SELECT pg_advisory_unlock(1566,366);
"""


def main():
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--password-file',type=Path,required=True)
    args=parser.parse_args()
    if os.environ.get('INSIDE_UMAMI_SETUP_ENABLED')!='true':raise ValueError('umami_setup_disabled')
    fd=os.open(args.password_file,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,'r') as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or stat.S_IMODE(info.st_mode)!=0o600 or info.st_nlink!=1:
            raise ValueError('umami_password_file')
        password=stream.read(258).rstrip('\n')
    import sql_transport
    sql_transport.query(sql(password),timeout=60,role='postgres',database='postgres')
    print('Umami dedicated database prepared; analytics remain disabled')


if __name__=='__main__':
    try:main()
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        raise SystemExit('Umami database setup refused or failed') from None
