"""Real Telegram process with synthetic ingress and a TLS Bot API peer on an internal network."""
import copy
import json
from pathlib import Path
import secrets
import time

HERE=Path(__file__).resolve().parent


def configure(output,plan,images):
    directory=output/'telegram';directory.mkdir(mode=0o700)
    password=secrets.token_hex(24)
    values={'NODE_ENV':'production','DATABASE_URL':'postgresql://telegram_owner:'+password+'@postgres:5432/inside_telegram',
        'WORKERS_ENABLED':'true','HOST':'0.0.0.0','PORT':'3002','TELEGRAM_BOT_IDENTITY':'inside','TELEGRAM_CANONICAL_CHAT_ID':'-1000000000000',
        'TELEGRAM_WEBHOOK_SECRET':'synthetic_webhook_secret_for_runtime_smoke','PLATFORM_INTEGRATION_SECRET':'synthetic_linking_secret_for_runtime_smoke',
        'TELEGRAM_WELCOME_TEXT':'synthetic','TELEGRAM_LINK_RECEIPT_TEXT':'synthetic','TELEGRAM_LINKED_MEMBER_TEXT':'synthetic',
        'TELEGRAM_LINKED_NON_MEMBER_TEXT':'synthetic','TELEGRAM_LINKED_UNAVAILABLE_TEXT':'synthetic',
        'TELEGRAM_DELIVERY_MODE':'live','TELEGRAM_MEMBERSHIP_MODE':'disabled','TELEGRAM_BOT_TOKEN':'1566:synthetic',
        'PLATFORM_EVIDENCE_DELIVERY_MODE':'disabled','TELEGRAM_COMMUNITY_CONTRACT_VERSION':'inside.community-entitlement.v2',
        'TELEGRAM_COMMUNITY_MODE':'disabled','TELEGRAM_COMMUNITY_REMOVALS_ENABLED':'false','TELEGRAM_SIGN_IN_ENABLED':'false',
        'TELEGRAM_NOTIFICATIONS_ENABLED':'false','TELEGRAM_MARKETING_ENABLED':'false','TELEGRAM_ACTIVATION_ENABLED':'false',
        'NODE_EXTRA_CA_CERTS':'/trust/provider.pem'}
    (directory/'application.env').write_text(''.join(key+'='+value+'\n' for key,value in values.items()));(directory/'application.env').chmod(0o600)
    (directory/'database.password').write_text(password);(directory/'database.password').chmod(0o600)
    common={'image':images['telegram'],'pull_policy':'never','init':True,'read_only':True,'tmpfs':['/tmp:size=16m,mode=1777'],
        'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'networks':['pilot','telemetry'],'mem_limit':'512m','cpus':1,'pids_limit':256,
        'env_file':[str(directory/'application.env')],'volumes':[str(output/'trust')+':/trust:ro'],'logging':{'driver':'none'}}
    plan['services']['telegram']={**common,'environment':{'INSIDE_OTEL_ENABLED':'false','INSIDE_OTEL_ENDPOINT':'http://inside-telemetry:4318','INSIDE_OTEL_SAMPLE_RATIO':'1'},
        'healthcheck':{'test':['CMD','node','dist/operations/check-readiness.js'],'interval':'15s','timeout':'8s','retries':4,'start_period':'15s'}}
    plan['services']['telegram-migrations']={**copy.deepcopy(common),'command':['node','dist/database/migrate.js']}
    peer=copy.deepcopy(plan['services']['provider']);peer['environment']={};peer['command']=['node','/resource/bot-provider.mjs']
    peer['sysctls']={'net.ipv4.ip_unprivileged_port_start':'0'}
    peer['volumes']=[str(HERE/'bot-provider.mjs')+':/resource/bot-provider.mjs:ro',str(output/'provider-tls')+':/provider-tls:ro']
    peer['networks']={'pilot':{'aliases':['api.telegram.org']}}
    peer['logging']={'driver':'none'}
    plan['services']['bot-provider']=peer
    plan['services']['loadgen']['volumes'].append(str(output/'trust')+':/trust:ro')


def initialize(output,compose,invoke,sql):
    password=(output/'telegram/database.password').read_text()
    if len(password)!=48 or any(char not in '0123456789abcdef' for char in password):raise ValueError('synthetic_telegram_password')
    sql(compose,"CREATE ROLE telegram_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 12 PASSWORD '"+password+"';\n"
        "ALTER ROLE telegram_owner SET statement_timeout='5s';\nCREATE DATABASE inside_telegram OWNER telegram_owner;\n"
        "REVOKE CONNECT ON DATABASE inside_telegram FROM PUBLIC; GRANT CONNECT ON DATABASE inside_telegram TO telegram_owner;")
    invoke(compose,['run','--rm','--no-deps','telegram-migrations'],timeout=60)
    invoke(compose,['up','-d','bot-provider','telegram'],timeout=30)


def establish(compose,invoke,wait,sql,actors):
    if type(actors) is not int or actors!=256:raise ValueError('fixed_telegram_corpus_required')
    # The real delivery worker polls every 250ms. Bound admission instead of relaxing
    # the durable-delivery deadline or changing production transport pacing.
    # Preserve the former composed setup ceiling: client45s + durable ledger30s.
    deadline=time.monotonic()+75
    def remaining(limit=75):
        value=min(limit,deadline-time.monotonic())
        if value<=0:raise TimeoutError('synthetic_telegram_setup_deadline')
        return value
    def bounded_sql(*args,**options):
        options['timeout']=remaining(options.get('timeout',5))
        return sql(*args,**options)
    for start in range(0,actors,64):
        value=json.loads(invoke(compose,['exec','-T','loadgen','node','/resource/fullstack.mjs','telegram-establish',str(start)],timeout=remaining(45)))
        if type(value) is not dict or set(value)!={'accepted'} or type(value['accepted']) is not int or value['accepted']!=64:
            raise ValueError('all_telegram_batch_contacts_required')
        wait(lambda:processed(compose,bounded_sql,1000000+start,1000000+start+64,64),bool,budget=remaining(30),probe='synthetic_telegram_seed_processed')
    if processed(compose,bounded_sql,1000000,1000000+actors,actors) is None:
        raise ValueError('all_telegram_contacts_required')
    remaining()


def processed(compose,sql,start,end,expected):
    if any(type(number) is not int for number in (start,end,expected)) or not 0<start<=end or not 0<=expected<=1000:raise ValueError('synthetic_telegram_range')
    delivery=" FROM start_response_deliveries WHERE trigger_update_id >= "+str(start)+" AND trigger_update_id < "+str(end)
    value=json.loads(sql(compose,"SELECT json_build_object('accepted',count(*),'processed',count(*) FILTER(WHERE state='processed' AND payload IS NULL),'failed',count(*) FILTER(WHERE state='failed'),'planned',(SELECT count(*)"+delivery+"),'delivered',(SELECT count(*)"+delivery+" AND state='delivered')) FROM telegram_updates WHERE update_id >= "+str(start)+" AND update_id < "+str(end)+";",role='telegram_owner',database='inside_telegram',timeout=5))
    if type(value) is not dict or set(value)!={'accepted','processed','failed','planned','delivered'} or any(type(number) is not int or number<0 for number in value.values()):raise ValueError('synthetic_telegram_ledger')
    return value if value=={'accepted':expected,'processed':expected,'failed':0,'planned':expected,'delivered':expected} else None
