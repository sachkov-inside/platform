"""Current Core7 ownership plus the Caddy overlay's live runtime authority checks."""
import overlay
import runtime_identity
import source_status_scenario as core
import hashlib
import native_source
import partition

VERSION_SHA256='2183c70a5dad2054820c8a2dbfaca3e906a1d363c033c0beee843e2c0c3d95c7'
MODULES={'caddy.adapters.caddyfile','http','http.handlers.subroute','http.handlers.request_body',
         'http.handlers.reverse_proxy','http.handlers.static_response','http.handlers.metrics',
         'http.matchers.method','http.matchers.path','http.reverse_proxy.transport.http'}


class Targets(core.OwnedTargets):
    def __init__(self,output,compose,plan,read):
        if plan!=overlay.plan(output):runtime_identity.refuse()
        super().__init__(output,compose,plan,read)
        for role in core.CORE_ROLES:self.check(role)

    def check(self,role):
        if role not in core.CORE_ROLES:runtime_identity.refuse()
        target=self.targets[role]
        current=self.read(self.compose+['ps','--all','-q',role]).strip()
        if current!=target['id'] or self.inspect(role,current)!=target:runtime_identity.refuse()
        raw=self.read(['docker','inspect','--format',runtime_identity.INSPECT,current]).encode()
        runtime_identity.validate(raw,role,self.plan)
        return current

    def native_raw(self):
        cid=self.check('gateway')
        raw=self.read(['docker','exec',cid,'sh','-euc',
            'set -o pipefail; wget -q -T 2 -O - http://127.0.0.1:9091/metrics | head -c 1048577']).encode()
        native_source.parse(raw)
        return raw

    def native_metrics(self):
        return native_source.parse(self.native_raw())

    def caddy_identity(self):
        cid=self.check('gateway')
        version=self.read(['docker','exec',cid,'sh','-euc','set -o pipefail; caddy version | head -c 1025']).encode()
        # command() retains the trailing newline, unlike CI's read_command helper.
        if hashlib.sha256(version).hexdigest()!=VERSION_SHA256:runtime_identity.refuse()
        cid=self.check('gateway')
        raw=self.read(['docker','exec',cid,'sh','-euc',
            'set -o pipefail; caddy list-modules --versions | head -c 65537']).encode()
        if len(raw)>65536 or b'PRIVACY_SENTINEL_1566' in raw or b'private-caddy-sentinel' in raw:runtime_identity.refuse()
        lines=raw.decode('utf-8',errors='strict').splitlines()
        if len(lines)>1024 or any(len(line.encode())>512 for line in lines):runtime_identity.refuse()
        present={line.split()[0] for line in lines if line.split()}
        if not MODULES<=present:runtime_identity.refuse()
        cid=self.check('gateway')
        adapted=self.read(['docker','exec',cid,'sh','-euc',
            'set -o pipefail; caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile --pretty | head -c 1048577']).encode()
        return partition.validate_adaptation(adapted)

    def change(self,role,action):
        if role not in ('gateway','alloy','vmauth') or action not in ('stop','start'):runtime_identity.refuse()
        cid=self.check(role)
        self.read(['docker',action,*(['--time','2'] if action=='stop' else []),cid])
        self.check(role)
