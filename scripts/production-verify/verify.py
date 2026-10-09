"""Read-only release verification. Results contain check names, never raw private inputs."""
import argparse
import datetime
import json
import pathlib
import subprocess
import sys

from queries import DOMAIN_CATALOG, logto_secret_inventory


def check(name, passed, reason):
    return {'name': name, 'status': 'passed' if passed else 'failed', 'reason': reason}


def verify_release(state, manifest):
    current = state['current']
    checks = [check('deployed release', current['version'] == manifest['version'] and
                    current['sourceSha'] == manifest['source']['sha'], 'version and source SHA match manifest')]
    if 'schema' in manifest:
        checks.append(check('deployed schema', current['schemaIdentity'] == manifest['schema']['identity'],
                            'schema identity matches manifest'))
        previous = manifest['rollback']['previous']
        rollback = state.get('rollback')
        matches = True if rollback is None else previous is not None and (
            isinstance(rollback, dict) and rollback.get('targetVersion') == previous['version'] and
            isinstance(previous['compatible'], bool) and rollback.get('compatible') is previous['compatible'] and
            all(rollback.get(key) == previous[key] for key in
                ['sourceSha', 'manifestSha256', 'schemaIdentity', 'verifiedByWorkflowRunId'] if key in previous))
        checks.append(check('rollback policy', matches, 'null means no rollback offered; recorded target must match manifest'))
    else:
        checks.append(check('deployed image', current['image'] == manifest['image'], 'image digest matches manifest'))
        checks.append(check('deployed migrations', current['migrationsIdentity'] == manifest['migrations']['identity'],
                            'migration identity matches manifest'))
    return checks


def verify_catalog(facts):
    return [
        check('domain schemas', facts['newSchemas'] == 2 and facts['oldSchemas'] == 0, '0082 schema names present'),
        check('physical domain names', facts['oldPhysicalNames'] == [], 'table columns exclude index attributes'),
        check('domain snapshots', all(facts[key] == 0 for key in
              ['membershipAccessRows', 'oldCapabilitiesRows', 'oldPaidSourceRefs']), 'no legacy access/capability/paid source snapshots'),
        check('material formats', isinstance(facts['materialFormats'], dict), 'format_id read directly; formats table is not required'),
    ]


def verify_bot_identity(facts):
    return check('Telegram bot identity', facts['identityMatches'] is True,
                 'getMe numeric ID matches token through application config; logical identity is separate')


def verify_cohort_config(facts):
    if facts['configured'] is False:
        return {'name': 'cohort configuration', 'status': 'not_checked', 'reason': 'not configured; welcome without date is allowed'}
    return check('cohort read', facts['configured'] is True and facts['readPassed'] is True,
                 'application config accepted URL/UUID; deployed adapter read products.v1 envelope')


def verify_readiness(body, manifest, process):
    expected = manifest['schema']['identity']
    return check(process + ' readiness', body.get('status') == 'ready' and
                 body.get('process') == process and body['release']['release'] == manifest['version'] and
                 body['release']['sourceSha'] == manifest['source']['sha'] and body['schema']['identity'] == expected,
                 'live readiness accepts release and schema identity')


def verify_container(container, expected_image, expected_sha):
    state = container['State']
    return [check('container health', state.get('Running') is True and state.get('Health', {}).get('Status') == 'healthy'
                  and state.get('OOMKilled') is False and container['RestartCount'] == 0, 'running, healthy, no OOM/restarts'),
            check('container image', container['Config']['Image'] == expected_image and container['revision'] == expected_sha,
                  'digest and image revision match manifest')]


def run(args, *, data=None, timeout=30, strip=True):
    # Raw stderr may contain request bodies, credentials or database values. Never propagate it.
    completed = subprocess.run(args, input=data, text=True, capture_output=True, timeout=timeout, check=False)
    if completed.returncode != 0:
        raise RuntimeError('read command failed')
    return completed.stdout.strip() if strip else completed.stdout


def sql(query, database='inside', container='inside-production-database-postgres-1'):
    user = run(['docker', 'exec', container, 'printenv', 'POSTGRES_USER'])
    return json.loads(run(['docker', 'exec', '-i', '--env',
                           'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=15000',
                           container, 'psql', '--no-psqlrc', '-v', 'ON_ERROR_STOP=1', '-U', user,
                           '-d', database, '-At'], data=query))


def http(url, method='GET', origin=None, *, redirect=False, bank_rejection_probe=False):
    output_format = '%{redirect_url}\n%{http_code}' if redirect else '\n%{http_code}'
    args = ['curl', '--silent', '--show-error', '--max-time', '20', '--write-out', output_format,
            '--request', method]
    if redirect:
        args += ['--output', '/dev/null']
    if origin:
        args += ['--noproxy', '*', '--resolve', origin + ':443:127.0.0.1']
    if bank_rejection_probe:
        args += ['--header', 'x-inside-production-verify: bank-webhook-rejection']
    output = run(args + [url], strip=False)
    body, status = output.rsplit('\n', 1)
    return int(status), body


def collect_containers(project):
    names = run(['docker', 'ps', '--all', '--filter', 'label=com.docker.compose.project=' + project,
                 '--format', '{{.Names}}']).splitlines()
    if not names:
        raise RuntimeError('no containers')
    containers = json.loads(run(['docker', 'inspect', *names]))
    services = {}
    for container in containers:
        service = container['Config']['Labels']['com.docker.compose.service']
        if service in services:
            raise RuntimeError('duplicate service generation')
        services[service] = container
    return services


def inspect_container(container):
    image = json.loads(run(['docker', 'image', 'inspect', container['Image']]))[0]
    container['revision'] = image['Config'].get('Labels', {}).get('org.opencontainers.image.revision')
    return container


def verify_platform(manifest, state, record):
    record.extend(verify_release(state, manifest))
    for kind, key in [('backend', 'backendImage'), ('web', 'webImage')]:
        record.append(check('state ' + kind + ' image', state['current'][key] == manifest['images'][kind],
                            'state image matches manifest'))
    services = collect_containers('inside-platform-production')
    expected = ['api', 'web', 'mcp', 'billing-worker', 'notifications-worker', 'material-assets-worker',
                'profile-avatars-worker', 'video-deletions-worker', 'rabbitmq']
    record.append(check('service inventory', set(expected).issubset(services), 'required services present'))
    for name in expected:
        container = inspect_container(services[name])
        if name == 'rabbitmq':
            record.append(check(name + ' health', container['State'].get('Health', {}).get('Status') == 'healthy' and
                                container['State']['Running'] is True, 'broker running and healthy'))
            continue
        for item in verify_container(container, manifest['images']['web' if name == 'web' else 'backend'], manifest['source']['sha']):
            record.append(dict(item, name=name + ' ' + item['name']))
        if name not in ['api', 'web', 'mcp']:
            # Docker logs may write JSON to stderr; capture both streams privately.
            logs = read_logs(container)
            record.append(check(name + ' worker ready', '"status":"ready"' in logs, 'worker reports ready since this start'))
            record.append(check(name + ' worker errors', not error_logs(logs), 'no operator/configuration errors since this start'))
    for name, url in [('api', 'http://127.0.0.1:13001/health/ready'), ('web', 'http://127.0.0.1:13000/_health/ready')]:
        status, body = http(url)
        record.append(check(name + ' readiness HTTP', status == 200, 'expected HTTP 200'))
        record.append(verify_readiness(json.loads(body), manifest, name))
    run(['docker', 'exec', services['mcp']['Id'], 'node', 'healthcheck/http-healthcheck.mjs', 'mcp'])
    record.append(check('MCP readiness', True, 'runtime healthcheck passed'))
    verify_public_routes(record)
    queues = run(['docker', 'exec', services['rabbitmq']['Id'], 'rabbitmqctl', 'list_queues', '--vhost', 'inside-production',
                  'name', 'messages', 'consumers'])
    rows = [line.split('\t') for line in queues.splitlines()]
    rows = [row for row in rows if len(row) == 3 and row[1].isdigit() and row[2].isdigit()]
    record.append(check('queue consumers/backlog', bool(rows) and all(int(row[1]) == 0 and int(row[2]) > 0 for row in rows),
                        'observed queues have consumers and zero backlog'))
    memory = int(next(line for line in run(['free', '-m']).splitlines() if line.startswith('Mem:')).split()[-1])
    record.append(check('memory reserve', memory >= 500, 'available memory at least 500 MiB'))
    timer = run(['systemctl', 'list-timers', 'inside-watchdog.timer', '--no-pager'])
    record.append(check('watchdog timer', 'inside-watchdog.timer' in timer, 'watchdog timer listed'))
    record.extend(verify_catalog(sql(DOMAIN_CATALOG)))


def verify_public_routes(record):
    routes = [('POST', '/integrations/telegram/v1/invitations/redeem', 401, 'unauthorized'),
              ('GET', '/billing/cohorts', 200, '"items"'),
              ('POST', '/billing/tbank/notification', 400, 'invalid_notification'),
              ('POST', '/integrations/telegram/v1/communications/authorize', 401, 'unauthorized'),
              ('POST', '/integrations/telegram/v1/communications/validate-content', 401, 'unauthorized'),
              ('POST', '/internal/billing-dispatch/authorize', 401, 'unauthorized'),
              ('POST', '/internal/notifications/dispatch/authorize', 401, 'unauthorized')]
    routes += [('POST', '/integrations/telegram/v1/subscription-activation/' + suffix, 401, 'unauthorized')
               for suffix in ['binding', 'own-access', 'attempts', 'evidence']]
    for method, path, code, needle in routes:
        status, body = http('https://inside.sachkov.dev' + path, method, 'inside.sachkov.dev',
                            bank_rejection_probe=path == '/billing/tbank/notification')
        record.append(check(method + ' ' + path.split('?')[0], status == code and needle in body, 'expected HTTP/body authentication boundary'))

    browser_path = '/communications/visit?token=' + 'A' * 43
    status, body = http('https://sachkov.dev' + browser_path, 'GET', 'sachkov.dev')
    record.append(check('GET /communications/visit', status == 404 and 'Ссылка не найдена.' in body,
                        'new Web origin rejects an invalid visitor token'))
    status, location = http('https://inside.sachkov.dev' + browser_path,
                            origin='inside.sachkov.dev', redirect=True)
    record.append(check('old Web redirect', status == 302 and location == 'https://sachkov.dev' + browser_path,
                        'old Web origin redirects with the same path and query'))


def read_logs(container):
    result = subprocess.run(['docker', 'logs', '--since', container['State']['StartedAt'], container['Id']],
                            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=30)
    if result.returncode != 0:
        raise RuntimeError('logs read failed')
    return result.stdout


def error_logs(logs):
    import re
    return bool(re.search(r'\[ERROR\]|operator_attention|delivery_not_configured|email_dispatch_failed|platform_response_invalid|"level"\s*:\s*"error"', logs))


TELEGRAM_READ = r"""
import {loadApplicationConfig,botTelegramUserIdFromToken} from '/app/dist/config/application-config.js';
import {HttpPlatformCohortAdapter} from '/app/dist/adapters/platform/http-platform-cohort.adapter.js';
const env=process.env;
const config=loadApplicationConfig(env);
async function api(method,body={}) {
 const res=await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),
  redirect:'error',signal:AbortSignal.timeout(10000)});
 const p=await res.json(); if(!res.ok || p.ok!==true) throw new Error('Telegram read failed'); return p.result;
}
const me=await api('getMe');
const wh=await api('getWebhookInfo'); const url=new URL(wh.url);
const chat=await api('getChat',{chat_id:env.TELEGRAM_CANONICAL_CHAT_ID});
const member=await api('getChatMember',{chat_id:env.TELEGRAM_CANONICAL_CHAT_ID,user_id:me.id});
let cohorts={configured:false};
if(config.communityWelcomeCohort){
 let validResponse=false;
 let selected;
 const fetcher=async(input,init)=>{
  const response=await fetch(input,init);
  const body=await response.clone().json();
  validResponse=response.status===200 && new Headers(init.headers).get('x-inside-domain-names')==='products.v1' &&
   Array.isArray(body?.items) && body.items.every(item=>item!==null && typeof item.productId==='string');
  if(validResponse) selected=body.items.find(item=>item.productId.toLowerCase()===config.communityWelcomeCohort.productId.toLowerCase());
  return response;
 };
 const details=await new HttpPlatformCohortAdapter(config.communityWelcomeCohort.url,config.communityWelcomeCohort.productId,fetcher).read();
 // The owning adapter validates calendar dates; an empty fallback must not hide a rejected date.
 const dateAccepted=selected===undefined || selected.startsOn===null ||
  (typeof selected.startsOn==='string' && details.streamStartsOn===selected.startsOn);
 cohorts={configured:true,readPassed:validResponse && dateAccepted};
}
console.log(JSON.stringify({identityMatches:me.is_bot===true && String(me.id)===botTelegramUserIdFromToken(config.botToken),cohorts,webhook:{host:url.hostname,port:url.port,
 path:url.pathname,hasPinnedIp:!!wh.ip_address,pending:wh.pending_update_count,
 allowedUpdates:wh.allowed_updates,lastError:!!wh.last_error_message},chat:{supergroup:chat.type==='supergroup',
 administrator:member.status==='administrator',invite:member.can_invite_users===true,restrict:member.can_restrict_members===true}}));
"""

ACTIVATION_READ = r"""
import { HttpActivationPlatform } from '/app/dist/adapters/platform/http-activation-platform.adapter.js';
const env=process.env;
if(!env.PLATFORM_ACTIVATION_URL || !env.PLATFORM_ACTIVATION_SECRET){
 console.log(JSON.stringify({configured:false}));
}else{
 const observations=[];
 const allowed=new Set(['/integrations/telegram/v1/subscription-activation/binding','/integrations/telegram/v1/subscription-activation/own-access']);
 const fetcher=async(input,init)=>{
  const url=new URL(input); if(url.origin!=='https://inside.sachkov.dev'||!allowed.has(url.pathname)) throw new Error('read outside allowlist');
  const header=new Headers(init.headers).get('x-inside-domain-names');
  const response=await fetch(input,init);observations.push({status:response.status,header});return response;
 };
 const adapter=new HttpActivationPlatform(env.PLATFORM_ACTIVATION_URL,env.PLATFORM_ACTIVATION_SECRET,fetcher);
 const identityRef='release-ops:production-verify:unbound';
 const binding=await adapter.binding(identityRef);
 const own=await adapter.own({accountRef:identityRef,identityRef,linkRef:'62000000-0000-4000-8000-000000000001',linkRevision:1});
 console.log(JSON.stringify({configured:true,bindingUnlinked:binding?.ok===true && binding.value.state==='unlinked',
 ownConflict:own?.ok===false && own.error.code==='identity_conflict',observations}));
}
"""



def verify_telegram(manifest, state, record):
    record.extend(verify_release(state, manifest))
    operation = json.loads(pathlib.Path('/var/lib/inside/telegram-deployments/operation.json').read_text())
    record.append(check('operation succeeded', operation['status'] == 'succeeded' and operation['version'] == manifest['version'],
                        'successful operation for selected release'))
    services = collect_containers('inside-production-telegram')
    app = inspect_container(services['app'])
    record.extend(verify_container(app, manifest['image'], manifest['source']['sha']))
    bindings = app['NetworkSettings']['Ports'].values()
    record.append(check('loopback only', all(binding['HostIp'] == '127.0.0.1' for ports in bindings if ports for binding in ports),
                        'every published port is loopback'))
    status, ready = http('http://127.0.0.1:3303/ready')
    record.append(check('Telegram readiness', status == 200 and json.loads(ready).get('status') == 'ready', 'expected live ready response'))
    paths = ['/webhooks/telegram', '/integrations/platform/v1/identity-links',
             '/integrations/platform/v1/identity-links/release-probe/confirm',
             '/integrations/platform/v1/community-entitlements', '/integrations/platform/v1/communications',
             '/integrations/identity/v1/sign-in']
    paths += ['/integrations/identity/v1/sign-in/release-probe/' + suffix for suffix in ['status', 'consume', 'account-link']]
    routes = [(method, path, 401 if method == 'POST' else 404) for path in paths for method in ['POST', 'GET']]
    routes += [('GET', '/ready', 404), ('GET', '/metrics', 404), ('POST', '/unknown', 404),
               ('POST', paths[2] + '/nested', 404), ('POST', paths[6] + '/nested', 404)]
    for method, path, expected in routes:
        status, _ = http('https://telegram.sachkov.dev' + path, method, 'telegram.sachkov.dev')
        record.append(check(method + ' ' + path, status == expected, 'expected allowlist/authentication boundary'))
    status, metrics = http('http://127.0.0.1:3303/metrics')
    values = {line.split()[0]: float(line.split()[1]) for line in metrics.splitlines() if line and not line.startswith('#')}
    errors = ['inside_telegram_update_failed_total', 'inside_telegram_delivery_api_retryable_total',
              'inside_telegram_delivery_transport_unknown_total', 'inside_telegram_community_effects_unknown',
              'inside_telegram_reconciliation_failure_total', 'inside_telegram_reconciliation_degraded_total']
    record.append(check('Telegram error counters', status == 200 and all(values.get(name) == 0 for name in errors),
                        'five counters are zero since start; community_effects_unknown gauge is currently zero'))
    record.append(check('Telegram startup logs', not error_logs(read_logs(app)), 'no contract/operator/delivery errors since app start'))
    telegram = json.loads(run(['docker', 'exec', '-i', app['Id'], 'node', '--input-type=module'], data=TELEGRAM_READ, timeout=60))
    record.append(verify_bot_identity(telegram))
    webhook = telegram['webhook']
    allowed = ['message', 'chat_member', 'my_chat_member', 'chat_join_request', 'callback_query']
    record.append(check('Telegram webhook', webhook['host'] == 'telegram.sachkov.dev' and webhook['port'] == '88' and
                        webhook['path'] == '/webhooks/telegram' and webhook['hasPinnedIp'] is True and
                        webhook['pending'] == 0 and webhook['lastError'] is False and sorted(webhook['allowedUpdates']) == sorted(allowed),
                        'existing relay registration, allowed updates, no pending/errors; never setWebhook'))
    record.append(check('Telegram bot administration', all(telegram['chat'].values()), 'supergroup administrator with invite/restrict rights'))
    record.append(verify_cohort_config(telegram['cohorts']))
    activation = json.loads(run(['docker', 'exec', '-i', app['Id'], 'node', '--input-type=module'], data=ACTIVATION_READ))
    if activation['configured']:
        record.append(check('activation domain header', len(activation['observations']) == 2 and all(
            item['status'] == 200 and item['header'] == 'products.v1' for item in activation['observations']) and
            activation['bindingUnlinked'] is True and activation['ownConflict'] is True,
            'two synthetic unbound reads accept products.v1; positive bound access is not exercised'))
    else:
        record.append({'name': 'activation domain header', 'status': 'not_checked', 'reason': 'activation is not configured'})


class VerificationFailed(Exception):
    pass


class Checks(list):
    """Stop at the first failed assertion; callers must decide the next action."""
    def append(self, item):
        super().append(item)
        if item['status'] == 'failed':
            raise VerificationFailed()

    def extend(self, items):
        for item in items:
            self.append(item)


def verify_logto_inventory(facts):
    return check('Logto test application credentials', facts['applications'] == 1 and
                 (facts['activeSecrets'] > 0 or facts['legacySecretPresent'] is True),
                 'active timestamp-based secret or legacy secret exists; values never returned')


def verify_host(application, version, logto_app_id=None, validated_context=None):
    import hashlib
    record = Checks()
    result = {'application': application, 'version': version, 'checks': record,
              'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    stage = 'manifest/state'
    try:
        directory = '/srv/inside/releases' if application == 'platform' else '/srv/inside/telegram/releases'
        state_dir = '/var/lib/inside/deployments' if application == 'platform' else '/var/lib/inside/telegram-deployments'
        raw = pathlib.Path(directory, version, 'release-manifest.json').read_bytes()
        state_raw = pathlib.Path(state_dir, 'state.json').read_text()
        context = {'application': application, 'version': version, 'manifestRaw': raw.decode(), 'stateRaw': state_raw}
        if validated_context is None:
            validate_context(context)
        elif context != validated_context:
            raise RuntimeError('validated journal changed during verification')
        manifest = json.loads(raw)
        state = json.loads(state_raw)
        record.append(check('selected version', manifest['version'] == version, 'manifest is the requested release'))
        digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
        record.append(check('manifest digest', state['current']['manifestSha256'] == digest, 'manifest bytes match deployed state'))
        stage = 'runtime reads'
        if application == 'platform':
            verify_platform(manifest, state, record)
        else:
            verify_telegram(manifest, state, record)
        stage = 'Logto credential inventory'
        if logto_app_id is not None:
            facts = sql(logto_secret_inventory(logto_app_id), 'logto')
            record.append(verify_logto_inventory(facts))
        else:
            record.append({'name': 'Logto test application credentials', 'status': 'not_checked', 'reason': 'no test app selected'})
        result['sourceSha'] = manifest['source']['sha']
        result['passed'] = True
    except VerificationFailed:
        result['passed'] = False
    except Exception:
        record.append({'name': stage, 'status': 'not_checked', 'reason': 'read or input shape failed; private stderr suppressed'})
        result['passed'] = False
    return result


def validate_context(context):
    validator = pathlib.Path(__file__).with_name('validate-context.mjs')
    run(['node', str(validator)], data=json.dumps(context))


def main():
    import re
    import shlex
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--application', required=True, choices=['platform', 'telegram'])
    parser.add_argument('--version', required=True)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument('--host', help='SSH alias; verification source is sent in memory, never installed')
    target.add_argument('--local', action='store_true', help='run on the production host')
    parser.add_argument('--logto-app-id', help='optional existing test application; reads counts only')
    args = parser.parse_args()
    if not re.fullmatch(r'v[1-9][0-9]*', args.version):
        parser.error('version must be vN')
    if args.host:
        if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.@-]*', args.host):
            parser.error('invalid SSH alias')
        context_source = "import sys,json,pathlib\na,v=sys.argv[1:]\nd='/srv/inside/releases' if a=='platform' else '/srv/inside/telegram/releases'\ns='/var/lib/inside/deployments' if a=='platform' else '/var/lib/inside/telegram-deployments'\nprint(json.dumps({'application':a,'version':v,'manifestRaw':pathlib.Path(d,v,'release-manifest.json').read_text(),'stateRaw':pathlib.Path(s,'state.json').read_text()}))\n"
        try:
            context = json.loads(run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', args.host,
                                      shlex.join(['python3', '-', args.application, args.version])], data=context_source))
            validate_context(context)
        except Exception:
            print(json.dumps({'passed': False, 'checks': [{'name': 'manifest/state schema', 'status': 'not_checked',
                                                          'reason': 'journal read or canonical schema validation failed'}]}))
            return 1
        source = pathlib.Path(__file__).read_text()
        queries = pathlib.Path(__file__).with_name('queries.py').read_text()
        bootstrap = "VALIDATED_CONTEXT=" + repr(context) + "\nimport sys,types\nq=types.ModuleType('queries')\nsys.modules['queries']=q\nexec(" + repr(queries) + ",q.__dict__)\nexec(compile(" + repr(source) + ",'production-verify','exec'))\n"
        remote = ['python3', '-', '--local', '--application', args.application, '--version', args.version]
        if args.logto_app_id is not None:
            remote += ['--logto-app-id', args.logto_app_id]
        completed = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', args.host, shlex.join(remote)],
                                   input=bootstrap, text=True, capture_output=True, timeout=300)
        try:
            result = json.loads(completed.stdout)
            # Only this source's result crosses SSH. A failed transport is not a passing verification.
            if completed.returncode not in [0, 1] or not isinstance(result, dict) or not isinstance(result.get('passed'), bool):
                raise ValueError('remote result')
        except (ValueError, TypeError):
            result = {'passed': False, 'checks': [{'name': 'SSH verification', 'status': 'not_checked',
                                                  'reason': 'remote verification unavailable; private stderr suppressed'}]}
    else:
        result = verify_host(args.application, args.version, args.logto_app_id, globals().get('VALIDATED_CONTEXT'))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except subprocess.TimeoutExpired:
        print(json.dumps({'passed': False, 'checks': [{'name': 'SSH verification', 'status': 'not_checked', 'reason': 'verification timeout'}]}))
        sys.exit(1)
