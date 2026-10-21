"""Tracking-owned finite facts for the first unexpected-key trace refusal."""
from pathlib import Path
import re
import weakref

NAME = 'tracking-unexpected-keys.json'
MAX_BYTES = 512
MESSAGE = 'closed tracking unexpected-key observation refused'
_FIELDS = {'schema','scope','source','state','gate','role','known_keys','other'}
_CATALOG = (
    ('a01','span_attr:http.route'),('a02','span_attr:http.request.method'),
    ('a03','span_attr:http.request.outcome'),('a04','span_attr:http.response.status_code'),
    ('a05','span_attr:messaging.system'),('a06','span_attr:messaging.destination.name'),
    ('a07','span_attr:messaging.operation.name'),('a08','span_attr:messaging.operation.type'),
    ('a09','span_attr:pgboss.job.state'),('a10','span_attr:error.type'),
    ('a11','span_attr:dependency.name'),('a12','span_attr:dependency.operation'),
    ('a13','span_attr:dependency.outcome'),('a14','span_attr:tracking.operation'),
    ('a15','span_attr:tracking.outcome'),('a16','span_attr:waitlist.operation'),
    ('a17','span_attr:waitlist.outcome'),('a18','span_attr:email.lane'),
    ('a19','span_attr:messaging.message.id'),('a20','span_attr:pgboss.job.retry_count'),
    ('a21','span_attr:messaging.batch.message_count'),
)
_ROLES = {'POST /communications/tracking/resolve':'root','tracking deliver':'delivery',
          'telegram communications.execute':'provider','postgresql query':'postgresql_query',
          'postgresql acquire':'postgresql_acquire'}
_IDS = tuple(identity for identity,_ in _CATALOG)
_OWNERS = weakref.WeakSet()


def _refuse():raise ValueError(MESSAGE) from None


def _sha(value):return type(value) is str and re.fullmatch('[0-9a-f]{40}',value) is not None


def validate(value,*,source):
    if (not _sha(source) or type(value) is not dict or any(type(key) is not str for key in value)
            or set(value)!=_FIELDS or type(value['schema']) is not int or value['schema']!=1
            or any(type(value[key]) is not str for key in ('scope','source','state','gate','role'))
            or value['scope']!='tracking' or value['source']!=source or type(value['other']) is not bool):_refuse()
    keys=value['known_keys']
    if (type(keys) is not list or len(keys)>21 or any(type(key) is not str or key not in _IDS for key in keys)
            or keys!=sorted(set(keys))):_refuse()
    state=value['state']
    if state=='observed':
        if (value['gate']!='trace_gate_06_unexpected_key' or value['role'] not in _ROLES.values()
                or not (keys or value['other'])):_refuse()
        gate='trace_gate_06_unexpected_key';role=next(role for role in _ROLES.values() if role==value['role'])
    elif state in ('unknown','refused'):
        if value['gate']!='unknown' or value['role']!='unknown' or keys or value['other']:_refuse()
        gate=role='unknown'
    else:_refuse()
    return dict(schema=1,scope='tracking',source=source,state=next(item for item in ('observed','unknown','refused') if item==state),
                gate=gate,role=role,known_keys=[identity for identity in _IDS if identity in keys],other=value['other'])


def _projection(source,state='unknown'):
    if not _sha(source) or state not in ('unknown','refused'):_refuse()
    return dict(schema=1,scope='tracking',source=source,state='unknown' if state=='unknown' else 'refused',gate='unknown',role='unknown',known_keys=[],other=False)


class _Observation:
    __slots__ = ('_output','_source','_value','_latched','_closed','__weakref__')

    def __init__(self,output):
        self._output=output;self._source=self._value=None;self._latched=self._closed=False

    def __enter__(self):return self

    def __exit__(self,kind,error,traceback):
        if self._closed:return False
        self._closed=True
        initial=BaseException.__traceback__.__get__(error) if error is not None else None
        try:
            if self._source is not None:
                import producer_phase
                producer_phase.write_unexpected_keys(self._output/NAME,self._value,source=self._source)
        except BaseException:
            if error is None:_refuse()
        finally:
            if error is not None:BaseException.__traceback__.__set__(error,initial)
        return False


def create(output):
    if type(output) is not type(Path()):_refuse()
    owner=_Observation(output);_OWNERS.add(owner)
    return owner


def admit(value):
    if type(value) is _Observation and value in _OWNERS:return value
    return None


def bind_source(observation,source):
    owner=admit(observation)
    if owner is None or owner._closed:return
    if not _sha(source):
        if not owner._latched:
            owner._latched=True
            if owner._source is not None:owner._value=_projection(owner._source,'refused')
        return
    if owner._source is None:
        owner._source=source;owner._value=_projection(source,'refused' if owner._latched else 'unknown')
    elif owner._source!=source and not owner._latched:
        owner._value=_projection(owner._source,'refused');owner._latched=True


def observe(observation,row,mandatory,optional):
    owner=admit(observation)
    if owner is None or owner._closed or owner._latched:return
    try:
        if (owner._source is None or type(row) is not dict or type(mandatory) is not set or type(optional) is not dict
                or any(type(key) is not str for key in row) or any(type(key) is not str for key in mandatory)
                or any(type(key) is not str for key in optional) or type(row.get('name')) is not str):raise ValueError()
        role=_ROLES[row['name']]
        unexpected=set(row)-mandatory-set(optional)
        if not unexpected:return
        known=[identity for identity,key in _CATALOG if key in unexpected]
        owner._value=validate(dict(schema=1,scope='tracking',source=owner._source,state='observed',
            gate='trace_gate_06_unexpected_key',role=role,known_keys=known,
            other=bool(unexpected-{key for _,key in _CATALOG})),source=owner._source)
        owner._latched=True
    except Exception:
        owner._latched=True
        if owner._source is not None:owner._value=_projection(owner._source,'refused')
