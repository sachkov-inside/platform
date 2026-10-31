"""Dedicated Umami SQL over authenticated PostgreSQL or verified local Docker identity."""
import json
import os
import re
import subprocess
import time

INSPECT='{"id":{{json .Id}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"running":{{json .State.Running}}}'


def query(sql,*,timeout,role='umami',database='umami',run=subprocess.run):
    if (role,database) not in (('umami','umami'),('postgres','postgres')):
        raise ValueError('umami_sql_scope')
    deadline=time.monotonic()+timeout
    def bounded(args,*,payload=None,environment=None):
        remaining=deadline-time.monotonic()
        if remaining<=0:raise TimeoutError('umami_sql_deadline')
        return run(args,input=payload,capture_output=True,text=True,check=True,timeout=remaining,env=environment).stdout
    mode=os.environ.get('INSIDE_UMAMI_SQL_TRANSPORT','postgresql')
    command=['psql','-X','-qAt','-w','-U',role,'-d',database,'-v','ON_ERROR_STOP=1']
    if mode=='docker':
        project=os.environ.get('INSIDE_UMAMI_DATABASE_PROJECT','')
        endpoint=os.environ.get('INSIDE_UMAMI_DOCKER_ENDPOINT','unix:///var/run/docker.sock')
        if re.fullmatch(r'[a-z][a-z0-9-]{0,62}',project) is None or not endpoint.startswith('unix:///') or any(char.isspace() for char in endpoint):
            raise ValueError('umami_database_owner')
        docker=['docker','--host',endpoint]
        environment={key:value for key,value in os.environ.items() if key=='PATH'}
        identity=bounded([*docker,'ps','--no-trunc','--filter','label=com.docker.compose.project='+project,
            '--filter','label=com.docker.compose.service=postgres','--format','{{.ID}}'],environment=environment).strip()
        if re.fullmatch(r'[a-f0-9]{64}',identity) is None:raise ValueError('umami_database_identity')
        actual=json.loads(bounded([*docker,'inspect',identity,'--format',INSPECT],environment=environment))
        if actual!={'id':identity,'project':project,'service':'postgres','running':True} or actual.get('running') is not True:
            raise ValueError('umami_database_identity')
        return bounded([*docker,'exec','-i',identity,*command],payload=sql,environment=environment)
    if mode!='postgresql':raise ValueError('umami_sql_transport')
    environment={key:value for key,value in os.environ.items() if key in
        ('PATH','PGHOST','PGPORT','PGPASSFILE','PGSSLMODE','PGSSLROOTCERT')}
    environment['PGCONNECT_TIMEOUT']='3'
    return bounded(command,payload=sql,environment=environment)
