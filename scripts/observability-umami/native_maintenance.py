"""Explicit disposable PG18 proof; never part of ordinary stdlib unit discovery.

UMAMI_FOUNDATION_CACHE names the source-bound receipt from foundation.py.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch
import uuid
import foundation
import maintenance
import recovery
import retention_fixture
import setup_database
import sql_transport

SITE='00000000-0000-4000-8000-000000001566'


class NativeMaintenance(unittest.TestCase):
    def test_external_deletion_authority_survives_database_restore_and_cascades_multiple_batches(self):
        cache=foundation.validate(json.loads(Path(os.environ['UMAMI_FOUNDATION_CACHE']).read_text()))
        name='inside-umami-maintenance-'+uuid.uuid4().hex[:12]
        def docker(args,*,payload=None,timeout=30):
            try:
                return subprocess.run(['docker',*args],input=payload,capture_output=True,text=True,check=True,timeout=timeout).stdout
            except subprocess.CalledProcessError as error:
                # This entry point creates only its own synthetic corpus, never a caller DSN.
                detail=(error.stderr or '').splitlines()
                raise RuntimeError('synthetic native command: '+(detail[0] if detail else 'no diagnostic')) from None
        identifier=None
        try:
            identifier=docker(['create','--name',name,'--label','inside.umami.maintenance='+name,
                '--label','com.docker.compose.project='+name,'--label','com.docker.compose.service=postgres',
                '--network','none','--memory','512m','--cpus','0.5','--pids-limit','128',
                '-e','POSTGRES_USER=pilot_bootstrap','-e','POSTGRES_PASSWORD=synthetic-bootstrap',
                '-e','PLATFORM_DATABASE_PASSWORD=synthetic-platform','-e','LOGTO_DATABASE_PASSWORD=synthetic-logto',cache['image']]).strip()
            self.assertRegex(identifier,r'^[a-f0-9]{64}$')
            docker(['start',identifier])
            deadline=time.monotonic()+60
            while True:
                try:
                    docker(['exec',identifier,'pg_isready','-h','127.0.0.1','-U','pilot_bootstrap','-d','postgres'],timeout=3);break
                except RuntimeError:
                    if time.monotonic()>deadline:raise
                    time.sleep(.1)
            def sql(payload,*,timeout=12,role='umami',database='umami'):
                return docker(['exec','-i',identifier,'psql','-X','-qAt','-U',role,'-d',database,'-v','ON_ERROR_STOP=1'],payload=payload,timeout=timeout)
            sql(setup_database.sql('synthetic-'+'x'*32),role='pilot_bootstrap',database='postgres')
            endpoint=docker(['context','inspect','--format','{{.Endpoints.docker.Host}}']).strip()
            with patch.dict(os.environ,{'INSIDE_UMAMI_SQL_TRANSPORT':'docker',
                    'INSIDE_UMAMI_DATABASE_PROJECT':name,'INSIDE_UMAMI_DOCKER_ENDPOINT':endpoint}):
                self.assertEqual(sql_transport.query('SELECT 1;',timeout=10).strip(),'1')
            # Repeat provisioning to prove idempotency and existing role isolation.
            sql(setup_database.sql('synthetic-'+'x'*32),role='pilot_bootstrap',database='postgres')
            permissions=json.loads(sql("SELECT json_build_object('inside',has_database_privilege('umami','inside','CONNECT'),'logto',has_database_privilege('umami','logto','CONNECT'),'platform',has_database_privilege('platform','inside','CONNECT'),'identity',has_database_privilege('logto_owner','logto','CONNECT'));"))
            self.assertEqual(permissions,{'inside':False,'logto':False,'platform':True,'identity':True})
            sql((recovery.ROOT/'infra/observability/umami/schema-fixture.sql').read_text(),timeout=60)
            sql(f"INSERT INTO public.website(website_id,name,domain) VALUES('{SITE}','synthetic','fixture.invalid');")
            sql(retention_fixture.seed_sql(SITE))
            session_id=hashlib.md5(b'ttl-session-recent').hexdigest();session_id=str(uuid.UUID(session_id))
            # More than one batch of children share one parent, whose mapping must survive.
            sql(f"INSERT INTO public.event_data(event_data_id,website_id,website_event_id,data_key,data_type) SELECT md5('many-child-'||n)::uuid,'{SITE}',md5('ttl-event-recent')::uuid,'synthetic',1 FROM generate_series(1,1101)n;")
            dump=docker(['exec',identifier,'pg_dump','-U','umami','-d','umami','--data-only','--no-owner','--no-privileges'],timeout=30)
            with tempfile.TemporaryDirectory() as directory:
                journal=Path(directory)/'deletions.json';maintenance.initialize(journal)
                maintenance.append(journal,request_id=str(uuid.uuid4()),website_id=SITE,kind='session',target_id=session_id)
                opened=[]
                result=maintenance.restore(journal,sql,lambda:opened.append(True))
                self.assertEqual(result['state'],'complete');self.assertEqual(opened,[True])
                self.assertEqual(sql("SELECT count(*) FROM public.event_data WHERE data_key='synthetic';").strip(),'0')
                self.assertEqual(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_recent';").strip(),'0')
                sql("SELECT format('TRUNCATE TABLE %I.%I CASCADE',schemaname,tablename) FROM pg_tables WHERE schemaname='public';\n\\gexec\n")
                sql(dump,timeout=30)
                self.assertEqual(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_recent';").strip(),'1')
                result=maintenance.restore(journal,sql,lambda:opened.append(True))
                self.assertEqual(result['state'],'complete');self.assertEqual(opened,[True,True])
                self.assertEqual(sql("SELECT count(*) FROM public.website_event WHERE event_name IN('ttl_recent','ttl_expired','ttl_null');").strip(),'0')
                self.assertEqual(sql("SELECT count(*) FROM public.website_event WHERE event_name='ttl_retained';").strip(),'1')
        finally:
            if identifier is not None:
                owned=docker(['inspect',identifier,'--format','{{index .Config.Labels "inside.umami.maintenance"}}']).strip()
                self.assertEqual(owned,name)
                docker(['rm','--force','--volumes',identifier])


if __name__=='__main__':unittest.main()
