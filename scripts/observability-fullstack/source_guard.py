"""Native authority negatives use the caller's already supervised synthetic PostgreSQL only."""
import json

ROLE='postgres_source_reader'
SNAPSHOT="""SELECT json_build_object('role',(SELECT json_build_object('super',rolsuper,'createdb',rolcreatedb,'createrole',rolcreaterole,'replication',rolreplication,'bypass',rolbypassrls,'inherit',rolinherit,'login',rolcanlogin,'limit',rolconnlimit,'settings',rolconfig) FROM pg_roles WHERE rolname='postgres_source_reader'),'dependencies',(SELECT count(*) FROM pg_shdepend WHERE refclassid='pg_authid'::regclass AND refobjid=(SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader')),'comment',shobj_description((SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader'),'pg_authid'));"""
CASES=(
    ('schema_owner','CREATE SCHEMA source_authority_canary AUTHORIZATION postgres_source_reader;',
        "SELECT (nspowner=(SELECT oid FROM pg_roles WHERE rolname='postgres_source_reader'))::int FROM pg_namespace WHERE nspname='source_authority_canary';",'DROP SCHEMA source_authority_canary;'),
    ('table_acl','CREATE TABLE public.source_acl_canary(id integer); GRANT SELECT ON public.source_acl_canary TO postgres_source_reader;',
        "SELECT has_table_privilege('postgres_source_reader','public.source_acl_canary','SELECT')::int;",'DROP TABLE public.source_acl_canary;'),
    ('database_create','GRANT CREATE ON DATABASE inside TO postgres_source_reader;',
        "SELECT has_database_privilege('postgres_source_reader','inside','CREATE')::int;",'REVOKE CREATE ON DATABASE inside FROM postgres_source_reader;'))


def refusal(compose,sql,bootstrap):
    # Stop immediately after the actual owning guard. psql exposes the server SQLSTATE;
    # a generic command/connection/SQL failure can never stand in for this refusal.
    parts=bootstrap.split('\nALTER ROLE ',1)
    if len(parts)!=2 or not parts[0].endswith('END $$;') or parts[0].count('DO $$')!=1:raise ValueError('source_guard_boundary')
    script='\\set ON_ERROR_STOP off\n'+parts[0]+'\n\\echo :SQLSTATE\n\\quit\n'
    if sql(compose,script,timeout=5).strip()!='P1567':raise ValueError('source_guard_refusal_not_proved')


def prove(compose,sql,bootstrap):
    results={}
    for name,prepare,authority,cleanup in CASES:
        sql(compose,prepare,database='inside',timeout=5)
        before=json.loads(sql(compose,SNAPSHOT,timeout=5))
        if sql(compose,authority,database='inside',timeout=5).strip()!='1':raise ValueError('source_guard_negative_not_established')
        refusal(compose,sql,bootstrap)
        after=json.loads(sql(compose,SNAPSHOT,timeout=5))
        if before!=after or sql(compose,authority,database='inside',timeout=5).strip()!='1':raise ValueError('source_guard_changed_foreign_authority')
        sql(compose,cleanup,database='inside',timeout=5)
        sql(compose,bootstrap,timeout=5)
        results[name]='refused_unchanged'
    return results
