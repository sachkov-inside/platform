"""Private ordinary-role result and seven finite gauge snapshots; no acquisition on import."""
import json
import re

MAX=9007199254740991
FIELDS=(('version_num',25),('track_counts',25),('track_activities',25),('read_only',25),
        ('role_safe',16),('database_scope_ok',16),('sampler_role_ok',16),('sample_us',25),
        ('postmaster_us',25),('stats_reset_us',25),('connected_backends',25),('waiting_locks',25),('deadlocks',25))
METRICS=(('backends','connected_backends'),('waiting_locks','waiting_locks'),('deadlocks_since_reset','deadlocks'),
         ('postmaster_start_time_microseconds','postmaster_us'),('statistics_reset_time_microseconds','stats_reset_us'),
         ('sample_time_microseconds','sample_us'))


def refuse(reason='malformed'):raise ValueError(reason) from None


def unique(pairs):
    value={}
    for key,item in pairs:
        if key in value:refuse()
        value[key]=item
    return value


def integer(value,*,positive=False):
    if type(value) is not str or re.fullmatch(r'0|[1-9][0-9]{0,15}',value) is None:refuse()
    result=int(value)
    if result>MAX or positive and result==0:refuse()
    return result


def validate(value):
    keys={'sample_us','postmaster_us','stats_reset_us','connected_backends','waiting_locks','deadlocks'}
    if type(value) is not dict or set(value)!=keys or any(type(v) is not int or not 0<=v<=MAX for v in value.values()):refuse()
    if (any(value[k]<=0 for k in ('sample_us','postmaster_us','stats_reset_us'))
            or any(value[k]>value['sample_us'] for k in ('postmaster_us','stats_reset_us'))
            or any(value[k]>1_000_000 for k in ('connected_backends','waiting_locks'))):refuse()
    return value.copy()


def decode(raw,completed_us):
    try:
        if (type(raw) is not bytes or len(raw)>4096 or not raw.endswith(b'\n') or raw.count(b'\n')!=1
                or raw.startswith(b'\xef\xbb\xbf') or type(completed_us) is not int or not 0<completed_us<=MAX):refuse()
        value=json.loads(raw.decode('utf-8',errors='strict'),object_pairs_hook=unique,parse_constant=lambda _:refuse())
        if (type(value) is not dict or set(value)!={'schema','fields','rows'} or type(value['schema']) is not int
                or value['schema']!=1 or type(value['fields']) is not list or len(value['fields'])!=13
                or type(value['rows']) is not list or len(value['rows'])!=1
                or type(value['rows'][0]) is not list or len(value['rows'][0])!=13):refuse()
        for field,(name,oid) in zip(value['fields'],FIELDS):
            if (type(field) is not dict or set(field)!={'name','oid'} or type(field['name']) is not str
                    or type(field['oid']) is not int or field!={'name':name,'oid':oid}):refuse()
        row=value['rows'][0]
        if (row[:4]!=['180004','on','on','on'] or any(type(v) is not str for v in row[:4])
                or any(type(v) is not bool or not v for v in row[4:7])):refuse()
        if row[9] is None:refuse('identity_unavailable')
        result=dict(zip(('sample_us','postmaster_us','stats_reset_us','connected_backends','waiting_locks','deadlocks'),
                        (integer(v) for v in row[7:])))
        if abs(completed_us-result['sample_us'])>2_000_000:refuse()
        return validate(result)
    except (ValueError,TypeError,KeyError,UnicodeError,OverflowError,RecursionError) as error:
        refuse('identity_unavailable' if type(error) is ValueError and error.args==('identity_unavailable',) else 'malformed')


def _payload(points,stamp):
    metrics=[{'name':'inside.postgresql.server.'+name,'gauge':{'dataPoints':[
        {'attributes':[],'timeUnixNano':str(stamp*1000),'asInt':str(value)}]}} for name,value in points]
    return {'resourceMetrics':[{'resource':{'attributes':[
        {'key':key,'value':{'stringValue':value}} for key,value in (
            ('service.name','inside-postgresql-source'),('deployment.environment.name','isolated-pilot'),('service.version','0.1566.3'))]},
        'scopeMetrics':[{'scope':{'name':'inside-postgresql-source','version':''},'metrics':metrics}]}]}


def payload(value):
    value=validate(value)
    return _payload([(name,value[key]) for name,key in METRICS]+[('available',1)],value['sample_us'])


def unavailable_payload(completed_us):
    if type(completed_us) is not int or not 0<completed_us<=MAX:refuse()
    return _payload([('available',0)],completed_us)


class Ledger:
    """Private continuity facts never cross an ownership replacement or unobserved interval."""
    def __init__(self):self.last=None;self.stable=0;self.transition=False;self.gaps=[];self.continuity='unknown'

    def accept(self,value):
        value=validate(value);previous=self.last
        if previous is None:self.continuity='initial';self.stable=0
        else:
            if value['sample_us']<=previous['sample_us']:refuse()
            restart=value['postmaster_us']!=previous['postmaster_us'];reset=value['stats_reset_us']!=previous['stats_reset_us']
            if restart or reset:
                self.continuity='server_restart' if restart else 'statistics_reset'
                self.gaps.append((value['sample_us'],self.continuity));self.stable=0;self.transition=True
                if len(self.gaps)>16:refuse()
            else:
                if value['deadlocks']<previous['deadlocks']:refuse()
                self.continuity='same_epoch';self.stable+=1
        self.last=value
        return self.report(value['sample_us'])

    def report(self,completed_us,*,owner_current=True,window_start_us=None):
        if type(completed_us) is not int or not 0<completed_us<=MAX:refuse()
        result={'freshness':'missing','continuity':'unknown','count_complete':False,'age_seconds':None}
        if not owner_current:return {**result,'freshness':'unavailable','continuity':'ownership_changed'}
        if self.last is None:return result
        elapsed=completed_us-self.last['sample_us']
        if elapsed<0:refuse()
        continuity=self.continuity
        if window_start_us is not None:
            if type(window_start_us) is not int or not 0<window_start_us<=completed_us:refuse()
            crossing=[kind for stamp,kind in self.gaps if stamp>=window_start_us]
            if crossing:continuity=crossing[-1]
        return {**result,'freshness':'fresh' if elapsed<=10_000_000 else 'stale','continuity':continuity,
                'count_complete':self.continuity=='same_epoch' and self.stable>=(2 if self.transition else 1)
                    and not (window_start_us is not None and any(stamp>=window_start_us for stamp,_ in self.gaps)),
                'age_seconds':min(elapsed/1_000_000,600)}
