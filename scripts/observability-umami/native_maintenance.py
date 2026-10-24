"""Native SQL proof inside recovery_runtime's already supervised PG18 service.

This module acquires no Docker resources and has no standalone runtime entrypoint.
All SQL/dump calls use the source-bound recovery invocation and project lifecycle.
"""
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import uuid
import maintenance
import recovery
import retention_fixture
import setup_database

SITE='00000000-0000-4000-8000-000000001566'


def expect(actual, expected):
    if actual != expected:
        raise ValueError('native_maintenance_proof_mismatch')


@contextmanager
def expected_membership_refusal():
    try:
        yield
    except RuntimeError:
        # The expected rejection is verified by unchanged database/membership state next.
        return
    raise ValueError('native_maintenance_foreign_membership_accepted')


def exercise(sql, dump, directory):
    """Check provisioning and journal replay, then leave the owned cluster ready for backup."""
    # A foreign member of the Umami group would inherit the new owner role.
    # Refuse before creating the database or changing that existing role.
    sql('CREATE ROLE umami; CREATE ROLE some_other_app LOGIN; GRANT umami TO some_other_app;',role='pilot_bootstrap',database='postgres')
    with expected_membership_refusal():
        sql(setup_database.sql('synthetic-'+'x'*32),role='pilot_bootstrap',database='postgres')
    untouched=json.loads(sql("SELECT json_build_object('database_absent',NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='umami'),'foreign_membership_preserved',pg_has_role('some_other_app','umami','MEMBER'));",role='pilot_bootstrap',database='postgres'))
    expect(untouched,{'database_absent':True,'foreign_membership_preserved':True})
    sql('REVOKE umami FROM some_other_app; DROP ROLE some_other_app; DROP ROLE umami;',role='pilot_bootstrap',database='postgres')
    sql(setup_database.sql('synthetic-'+'x'*32),role='pilot_bootstrap',database='postgres')
    # Repeat provisioning to prove idempotency and existing role isolation.
    sql(setup_database.sql('synthetic-'+'x'*32),role='pilot_bootstrap',database='postgres')
    permissions=json.loads(sql("SELECT json_build_object('inside',has_database_privilege('umami','inside','CONNECT'),'logto',has_database_privilege('umami','logto','CONNECT'),'platform',has_database_privilege('platform','inside','CONNECT'),'identity',has_database_privilege('logto_owner','logto','CONNECT'));"))
    expect(permissions,{'inside':False,'logto':False,'platform':True,'identity':True})
    sql((recovery.ROOT/'infra/observability/umami/schema-fixture.sql').read_text(),timeout=60)
    sql(f"INSERT INTO public.website(website_id,name,domain) VALUES('{SITE}','synthetic','fixture.invalid');")
    sql(retention_fixture.seed_sql(SITE))
    session_id=hashlib.md5(b'ttl-session-recent').hexdigest();session_id=str(uuid.UUID(session_id))
    # More than one batch of children share one parent, whose mapping must survive.
    sql(f"INSERT INTO public.event_data(event_data_id,website_id,website_event_id,data_key,data_type) SELECT md5('many-child-'||n)::uuid,'{SITE}',md5('ttl-event-recent')::uuid,'synthetic',1 FROM generate_series(1,1101)n;")
    snapshot=dump()
    directory.mkdir(mode=0o700)
    journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
    maintenance.append(journal,request_id=str(uuid.uuid4()),website_id=SITE,kind='session',target_id=session_id)
    opened=[]
    result=maintenance.restore(journal,sql,lambda:opened.append(True))
    expect(result['state'],'complete');expect(opened,[True])
    expect(sql("SELECT count(*) FROM public.event_data WHERE data_key='synthetic';").strip(),'0')
    expect(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_recent';").strip(),'0')
    sql("SELECT format('TRUNCATE TABLE %I.%I CASCADE',schemaname,tablename) FROM pg_tables WHERE schemaname='public';\n\\gexec\n")
    sql(snapshot,timeout=30)
    expect(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_recent';").strip(),'1')
    result=maintenance.restore(journal,sql,lambda:opened.append(True))
    expect(result['state'],'complete');expect(opened,[True,True])
    expect(sql("SELECT count(*) FROM public.website_event WHERE event_name IN('ttl_recent','ttl_expired','ttl_null');").strip(),'0')
    expect(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_retained';").strip(),'1')
    sql('DROP DATABASE umami; DROP ROLE umami;',role='pilot_bootstrap',database='postgres')
    return {'foreign_membership_refused': True, 'role_isolation': True,
            'journal_replayed_after_restore': True, 'multiple_child_batches': True}
