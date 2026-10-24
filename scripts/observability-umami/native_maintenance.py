"""Native SQL proof inside recovery_runtime's already supervised PG18 service.

This module acquires no Docker resources and has no standalone runtime entrypoint.
All SQL/dump calls use the source-bound recovery invocation and project lifecycle.
"""
from contextlib import contextmanager
import hashlib
import json
import subprocess
from pathlib import Path
import uuid
import maintenance
import recovery
import retention_fixture
import setup_database
from runtime import FixtureCommandFailed

SITE='00000000-0000-4000-8000-000000001566'


def expect(actual, expected):
    if actual != expected:
        raise ValueError('native_maintenance_proof_mismatch')


@contextmanager
def expected_membership_refusal():
    try:
        yield
    except FixtureCommandFailed as error:
        if error.returncode != 3 or error.diagnostic != {'phase': 'membership_guard', 'error': 'existing_role_authority'}:
            raise
        return
    raise ValueError('native_maintenance_foreign_membership_accepted')


def exercise(sql, dump, directory, *, restore, progress=None):
    """Persist closed progress without SQL, result rows or exception text."""
    operation={'schema':1,'step':'foreign_membership_setup','outcome':'running','error':None,'returncode':None}
    def mark(step):
        operation['step']=step
        if progress is not None:progress(dict(operation))
    try:
        result=_exercise(sql,dump,directory,mark,restore)
        operation.update(outcome='passed',returncode=0)
        if progress is not None:progress(dict(operation))
        return result
    except BaseException as error:
        category=('timeout' if isinstance(error,(TimeoutError,subprocess.TimeoutExpired)) else
            'command_failed' if isinstance(error,FixtureCommandFailed) else
            'interrupted' if isinstance(error,(KeyboardInterrupt,SystemExit)) else
            'invalid_result' if isinstance(error,ValueError) else 'operation_failed')
        code=getattr(error,'returncode',None)
        operation.update(outcome='failed',error=category,returncode=code if type(code) is int and -128<=code<=255 else None)
        try:
            if progress is not None:progress(dict(operation))
        except BaseException:pass  # Failure diagnostics cannot replace the active SQL/refusal failure.
        raise


def _exercise(sql, dump, directory, mark, restore):
    """Check provisioning and journal replay, then leave the owned cluster ready for backup."""
    # A foreign member of the Umami group would inherit the new owner role.
    # Refuse before creating the database or changing that existing role.
    mark('foreign_membership_setup')
    sql('CREATE ROLE umami; CREATE ROLE some_other_app LOGIN; GRANT umami TO some_other_app;',role='pilot_bootstrap',database='postgres')
    mark('membership_guard')
    with expected_membership_refusal():
        sql(setup_database.sql('synthetic-'+'x'*32),role='pilot_bootstrap',database='postgres',fixture_phase='membership_guard')
    mark('membership_untouched')
    untouched=json.loads(sql("SELECT json_build_object('database_absent',NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='umami'),'foreign_membership_preserved',pg_has_role('some_other_app','umami','MEMBER'));",role='pilot_bootstrap',database='postgres'))
    expect(untouched,{'database_absent':True,'foreign_membership_preserved':True})
    mark('foreign_membership_cleanup')
    sql('REVOKE umami FROM some_other_app; DROP ROLE some_other_app; DROP ROLE umami;',role='pilot_bootstrap',database='postgres')
    mark('provision')
    sql(setup_database.sql('synthetic-'+'x'*32),role='pilot_bootstrap',database='postgres')
    # Repeat provisioning to prove idempotency and existing role isolation.
    mark('provision_repeat')
    sql(setup_database.sql('synthetic-'+'x'*32),role='pilot_bootstrap',database='postgres')
    mark('permissions')
    permissions=json.loads(sql("SELECT json_build_object('inside',has_database_privilege('umami','inside','CONNECT'),'logto',has_database_privilege('umami','logto','CONNECT'),'platform',has_database_privilege('platform','inside','CONNECT'),'identity',has_database_privilege('logto_owner','logto','CONNECT'));"))
    expect(permissions,{'inside':False,'logto':False,'platform':True,'identity':True})
    mark('schema')
    sql((recovery.ROOT/'infra/observability/umami/schema-fixture.sql').read_text(),timeout=60)
    mark('seed')
    sql(f"INSERT INTO public.website(website_id,name,domain) VALUES('{SITE}','synthetic','fixture.invalid');")
    sql(retention_fixture.seed_sql(SITE))
    session_id=hashlib.md5(b'ttl-session-recent').hexdigest();session_id=str(uuid.UUID(session_id))
    # More than one batch of children share one parent, whose mapping must survive.
    mark('large_children')
    sql(f"INSERT INTO public.event_data(event_data_id,website_id,website_event_id,data_key,data_type) SELECT md5('many-child-'||n)::uuid,'{SITE}',md5('ttl-event-recent')::uuid,'synthetic',1 FROM generate_series(1,1101)n;")
    mark('snapshot')
    dump()
    mark('journal')
    directory.mkdir(mode=0o700)
    journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
    maintenance.append(journal,request_id=str(uuid.uuid4()),website_id=SITE,kind='session',target_id=session_id)
    opened=[]
    mark('replay_before_restore')
    result=maintenance.restore(journal,sql,lambda:opened.append(True))
    expect(result['state'],'complete');expect(opened,[True])
    mark('replay_assertions')
    expect(sql("SELECT count(*) FROM public.event_data WHERE data_key='synthetic';").strip(),'0')
    expect(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_recent';").strip(),'0')
    mark('reset_database')
    sql("SELECT format('TRUNCATE TABLE %I.%I CASCADE',schemaname,tablename) FROM pg_tables WHERE schemaname='public';\n\\gexec\n")
    mark('restore_snapshot')
    restore()
    mark('restored_rows')
    expect(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_recent';").strip(),'1')
    mark('replay_after_restore')
    result=maintenance.restore(journal,sql,lambda:opened.append(True))
    expect(result['state'],'complete');expect(opened,[True,True])
    mark('post_restore_assertions')
    expect(sql("SELECT count(*) FROM public.website_event WHERE event_name IN('ttl_recent','ttl_expired','ttl_null');").strip(),'0')
    expect(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_retained';").strip(),'1')
    mark('cleanup')
    sql('DROP DATABASE umami; DROP ROLE umami;',role='pilot_bootstrap',database='postgres')
    return {'foreign_membership_refused': True, 'role_isolation': True,
            'journal_replayed_after_restore': True, 'multiple_child_batches': True}
