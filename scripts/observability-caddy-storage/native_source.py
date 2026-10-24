"""Private native text validation BEFORE Alloy label deletion, including excluded routes."""
import json
import re
import caddy_status as status

ROLES={('srv0','subroute'),('srv0','request_body'),('srv0','static_response'),('srv1','subroute'),('srv1','metrics'),('srv1','static_response')}
TYPES={status.TOTAL:'counter',status.ERRORS:'counter',status.FLIGHT:'gauge',status.DURATION.removesuffix('_'):'histogram'}
SAMPLE=re.compile(r'^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})? ([^\s]+)$')
LABEL=re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\[\\"n])*)"(?:,|$)')


def refuse():raise ValueError('closed Caddy native source refused')


def _labels(raw):
    position=0;labels={}
    while position<len(raw):
        match=LABEL.match(raw,position)
        if match is None or match[1] in labels:refuse()
        labels[match[1]]=json.loads('"'+match[2]+'"');position=match.end()
    return labels


def parse(raw):
    try:
        if type(raw) is not bytes or len(raw)>status.MAX_BODY_BYTES:refuse()
        text=raw.decode('utf-8',errors='strict')
        if 'PRIVACY_SENTINEL_1566' in text or 'private-caddy-sentinel' in text:refuse()
        lines=text.splitlines()
        if len(lines)>4096 or any(len(line.encode())>4096 for line in lines):refuse()
        by_role={};identities=set();types={};samples=0
        for line in lines:
            if not line:continue
            if line.startswith('# TYPE '):
                fields=line.split()
                if len(fields)!=4:refuse()
                if fields[2] in TYPES:
                    if fields[2] in types or fields[3]!=TYPES[fields[2]]:refuse()
                    types[fields[2]]=fields[3]
                continue
            if line.startswith('#'):
                if not line.startswith(('# HELP ',)):refuse()
                continue
            match=SAMPLE.fullmatch(line)
            if match is None:refuse()
            samples+=1
            if samples>2000:refuse()
            name=match[1]
            if name=='up':refuse()  # up belongs only to the scraper, never the native registry.
            if name not in status.NAMES:continue  # Other pinned vendor families are explicitly unretained.
            labels=_labels(match[2] or '')
            family=status.DURATION.removesuffix('_') if name.startswith(status.DURATION) else name
            if family not in types:refuse()
            role=(labels.get('server'),labels.get('handler'))
            if role not in ROLES:refuse()
            expected={'server','handler'}
            if name.startswith(status.DURATION):
                expected|={'method','code'}
                if labels.get('method') not in status.METHODS or re.fullmatch('[1-5][0-9]{2}',labels.get('code','')) is None:refuse()
                if name==status.DURATION+'bucket':
                    expected.add('le')
                    if labels.get('le') not in status.BUCKETS:refuse()
            if set(labels)!=expected:refuse()
            value=status.number(match[3])
            if name!=status.DURATION+'sum' and value!=value.to_integral_value():refuse()
            identity=(name,tuple(sorted(labels.items())))
            if identity in identities:refuse()
            identities.add(identity)
            key=tuple(sorted({'__name__':name,'job':'platform-caddy','instance':'pilot',**labels}.items()))
            by_role.setdefault(role,{})[key]=value
        # The same whole histogram/count rules apply to actual native values, not fabricated runtime metrics.
        observations={role:status._observation(rows) for role,rows in by_role.items()}
        return observations.get(('srv0','subroute'))
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError):refuse()
