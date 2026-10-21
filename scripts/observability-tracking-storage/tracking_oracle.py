"""Closed whole-vector gate for one genuine API/timer tracking storage success."""
from decimal import Decimal
import json
import math
from pathlib import Path
import re
import sys
import unexpected_keys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'observability-sdk-storage'))
import oracle as sdk_oracle
from diagnostics import ResponseDecode, OracleRefusal, TraceGateRefusal, trace_refusal

BOUNDS = sdk_oracle.BOUNDS
COMMON = {'service.name':'platform-api', 'deployment.environment.name':'test',
          'service.version':'_OTHER', 'scope.name':'inside-collector'}
HEALTH = {'http.server.active_requests':0, 'telemetry.trace.dropped':0,
          'telemetry.trace.export.failures':0, 'telemetry.metric.export.failures':0,
          'telemetry.trace.sampling.ratio':1, 'inside.postgresql.pool.registry_overflow':0,
          }
POOL = {'inside.postgresql.pool.'+key for key in ('available','total','idle','waiting')}
OWNERS = {
    'tracking': ('inside.tracking.duration', 'inside.tracking.operations', 1),
    'http': ('http.server.request.duration', 'http.server.request.count', 1),
    'telegram:communications.execute': ('inside.dependency.duration', 'inside.dependency.operations', 2),
    'postgresql:query': ('inside.dependency.duration', 'inside.dependency.operations', None),
    'postgresql:acquire': ('inside.dependency.duration', 'inside.dependency.operations', None),
}


def metrics(raw):
    try:
        body = sdk_oracle.decode(raw)
        if type(body) is not dict or set(body) not in ({'status','data'}, {'status','data','stats'}) or body['status'] != 'success':
            raise ValueError()
        if 'stats' in body: sdk_oracle._native_stats(body['stats'])
        data = body['data']
        if type(data) is not dict or set(data) != {'resultType','result'} or data['resultType'] != 'vector': raise ValueError()
        rows = data['result']
        if type(rows) is not list or len(rows) > 512: raise ValueError()
        seen, values, scrape = set(), {}, 0
        for row in rows:
            if type(row) is not dict or set(row) != {'metric','value'}: raise ValueError()
            labels, sample = row['metric'], row['value']
            if (type(labels) is not dict or not all(type(v) is str for v in labels.values()) or '__name__' not in labels
                    or type(sample) is not list or len(sample) != 2 or type(sample[0]) not in (int,float,Decimal)
                    or not math.isfinite(sample[0]) or sample[0] <= 0): raise ValueError()
            value = sdk_oracle.number(sample[1]); identity = tuple(sorted(labels.items()))
            if identity in seen: raise ValueError()
            seen.add(identity)
            if 'job' in labels:
                sdk_oracle._self_scrape(labels); scrape += 1; continue
            if any(labels.get(k) != v for k,v in COMMON.items()) or labels.get('scope.version','') not in ('','unknown'): raise ValueError()
            name = labels['__name__']; keys = {'__name__',*COMMON,'scope.version'}
            bucket = labels.get('le')
            if name in HEALTH or name in POOL:
                owner = 'health'
                if bucket is not None or (name in HEALTH and value != HEALTH[name]): raise ValueError()
                # Sixteen registered production pools, each with max=10, from technical-telemetry/prisma-adapter.
                # This synchronous success fixture has no pending driver acquisition at SDK shutdown.
                if name in POOL and (value != int(value) or not 0 <= value <= 160 or name.endswith('.waiting') and value != 0 or name.endswith('.available') and value not in (0,1)): raise ValueError()
            else:
                keys.add('le')
                if name.startswith('inside.tracking.'):
                    owner = 'tracking'; expected_labels = {'operation':'deliver','outcome':'completed'}
                elif name.startswith('http.server.request.'):
                    owner = 'http'; expected_labels = {'http.request.method':'POST','http.route':'/communications/tracking/resolve','http.request.outcome':'completed','http.response.status_code':'200'}
                elif name.startswith('inside.dependency.'):
                    dependency, operation = labels.get('dependency'), labels.get('operation')
                    owner = str(dependency)+':'+str(operation)
                    if owner not in OWNERS or owner in ('tracking','http'): raise ValueError()
                    expected_labels = {'dependency':dependency,'operation':operation,'outcome':'completed'}
                else: raise ValueError()
                keys.update(expected_labels)
                if any(labels.get(k) != v for k,v in expected_labels.items()): raise ValueError()
                prefix, counter, fixed_count = OWNERS[owner]
                if name not in (counter,prefix+'_count',prefix+'_sum',prefix+'_bucket'): raise ValueError()
                if name.endswith('_bucket') and bucket not in BOUNDS or not name.endswith('_bucket') and bucket is not None: raise ValueError()
                if name.endswith('_sum'):
                    if value > 60: raise ValueError()
                elif value != int(value) or not 0 <= value <= 64: raise ValueError()
                elif not name.endswith('_bucket') and (value < 1 or fixed_count is not None and value != fixed_count): raise ValueError()
            if set(labels)-keys: raise ValueError()
            logical = (owner,name,bucket)
            if logical in values: raise ValueError()
            values[logical] = value
        expected = {('health', name, None) for name in {*HEALTH,*POOL}}
        counts = {}
        for owner,(prefix,counter,fixed_count) in OWNERS.items():
            count = values.get((owner,counter,None))
            total_count = values.get((owner,prefix+'_count',None))
            if count is not None and total_count is not None and count != total_count: raise ValueError()
            count = count if count is not None else total_count
            if count is not None: counts[owner] = int(count)
            buckets = [values.get((owner,prefix+'_bucket',b)) for b in BOUNDS]
            present = [v for v in buckets if v is not None]
            if present != sorted(present) or count is not None and any(v > count for v in present): raise ValueError()
            if buckets[-1] is not None and count is not None and buckets[-1] != count: raise ValueError()
            total = values.get((owner,prefix+'_sum',None))
            if total is not None and count is not None:
                # Any present cumulative bucket already constrains the possible nonnegative sum.
                for bound,value in zip(BOUNDS[:-1],buckets[:-1]):
                    if value is not None and total+1e-12 < (count-value)*float(bound): raise ValueError()
                if all(value is not None for value in buckets):
                    minimum=maximum=0; previous_count=0; previous_bound=0.0
                    for bound,value in zip(BOUNDS,buckets):
                        increment=value-previous_count
                        minimum += increment*previous_bound
                        maximum = math.inf if bound == '+Inf' and increment > 0 else maximum+(increment*float(bound) if bound != '+Inf' else 0)
                        previous_count=value
                        if bound != '+Inf': previous_bound=float(bound)
                    if total+1e-12 < minimum or total-1e-12 > maximum: raise ValueError()
            if total is not None and count == 1:
                for bound,value in zip(BOUNDS,buckets):
                    if value is not None and value != int(bound == '+Inf' or total <= float(bound)): raise ValueError()
            expected |= {(owner,counter,None),(owner,prefix+'_count',None),(owner,prefix+'_sum',None)}
            expected |= {(owner,prefix+'_bucket',b) for b in BOUNDS}
        idle = values.get(('health','inside.postgresql.pool.idle',None)); total = values.get(('health','inside.postgresql.pool.total',None))
        available = values.get(('health','inside.postgresql.pool.available',None))
        if available == 0 and any(values.get(('health','inside.postgresql.pool.'+key,None),0) != 0 for key in ('total','idle','waiting')): raise ValueError()
        if idle is not None and total is not None and idle > total: raise ValueError()
        if set(values) != expected: return None
        return {'tracking_series':19, 'sdk_series':len(values), 'self_scrape_series':scrape,
                'full_vector_series':len(rows), 'privacy':'passed',
                'dependency_counts':{k:v for k,v in counts.items() if ':' in k}}
    except (ValueError,TypeError,KeyError,UnicodeError,OverflowError,RecursionError) as error:
        raise OracleRefusal('Tracking storage metric contract failed',
                            'response_decode' if isinstance(error, ResponseDecode) else 'oracle_refusal') from None


def _gate06_detail(row,mandatory,expected,optional,observation=None):
    # Called only after the unchanged complete-row predicate has already refused.
    if not mandatory <= set(row):return 'missing_mandatory'
    if set(row)-mandatory-set(optional):
        unexpected_keys.observe(observation,row,mandatory,optional)
        return 'unexpected_key'
    if any(row.get(k) != v for k,v in expected.items()):return 'expected_value'
    if any(row[k] != optional[k] for k in set(row)&set(optional)):return 'optional_value'
    return None


def traces(raw, *, trace_id, root_id, observation=None):
    try:
        from telegram_http_storage import _timestamp_matches
        if (type(raw) is not str or len(raw.encode()) > sdk_oracle.MAX_BYTES
                or type(trace_id) is not str or re.fullmatch(r'[0-9a-f]{32}',trace_id) is None or trace_id == '0'*32
                or type(root_id) is not str or re.fullmatch(r'[0-9a-f]{16}',root_id) is None or root_id == '0'*16): raise TraceGateRefusal('tracking','trace_gate_01')
        try:
            rows = [sdk_oracle.decode(line) for line in raw.splitlines() if line.strip()]
        except ResponseDecode:raise
        except (ValueError,TypeError,KeyError,UnicodeError,OverflowError,RecursionError):
            raise TraceGateRefusal('tracking','trace_decode') from None
        if len(rows) > 68: raise TraceGateRefusal('tracking','trace_gate_02')
        parsed, roles, main, providers, sql = {}, {}, {}, [], {'query':0,'acquire':0}
        for row in rows:
            if type(row) is not dict or not all(type(v) is str for v in row.values()): raise TraceGateRefusal('tracking','trace_gate_03')
            name, identity = row.get('name'), row.get('span_id')
            if identity is None or re.fullmatch(r'[0-9a-f]{16}',identity) is None or identity == '0'*16 or identity in parsed: raise TraceGateRefusal('tracking','trace_gate_04')
            if name == 'POST /communications/tracking/resolve':
                role, kind = 'root','2'
                attrs = {'http.request.method':'POST','http.route':'/communications/tracking/resolve','http.request.outcome':'completed','http.response.status_code':'200'}
            elif name == 'tracking deliver':
                role, kind = 'delivery','1'; attrs = {'tracking.operation':'deliver','tracking.outcome':'completed'}
            elif name == 'telegram communications.execute':
                role, kind = 'provider','3'; attrs = {'dependency.name':'telegram','dependency.operation':'communications.execute','dependency.outcome':'completed'}
            elif name in ('postgresql query','postgresql acquire'):
                role, kind = 'postgresql','3'; operation = name.split(' ')[1]
                attrs = {'dependency.name':'postgresql','dependency.operation':operation,'dependency.outcome':'completed'}
                sql[operation] += 1
            else: raise TraceGateRefusal('tracking','trace_gate_05')
            expected = {'trace_id':trace_id,'resource_attr:service.name':'platform-api','resource_attr:deployment.environment.name':'test',
                        'resource_attr:service.version':'_OTHER','scope_name':'inside-collector','kind':kind,'status_code':'0','flags':'769' if role=='delivery' else '257','_msg':'-',
                        '_stream':'{name='+json.dumps(name)+',resource_attr:service.name="platform-api"}',
                        **{'span_attr:'+key:value for key,value in attrs.items()}}
            mandatory = {*expected,'name','span_id','start_time_unix_nano','end_time_unix_nano','duration','_time','_stream_id'}
            optional = {'scope_version':'','trace_state':'','status_message':'','dropped_attributes_count':'0','dropped_events_count':'0','dropped_links_count':'0'}
            if role == 'root': optional['parent_span_id']=''
            else: mandatory.add('parent_span_id')
            if (not mandatory <= set(row) or set(row)-mandatory-set(optional) or any(row.get(k) != v for k,v in expected.items())
                    or any(row[k] != optional[k] for k in set(row)&set(optional))): raise TraceGateRefusal('tracking','trace_gate_06',detail=_gate06_detail(row,mandatory,expected,optional,observation))
            for key in ('start_time_unix_nano','end_time_unix_nano','duration'):
                if re.fullmatch(r'0|[1-9][0-9]{0,18}',row[key]) is None: raise TraceGateRefusal('tracking','trace_gate_07')
            start,end,duration = (int(row[k]) for k in ('start_time_unix_nano','end_time_unix_nano','duration'))
            if (not 0 < start <= end < 2**63 or duration != end-start or duration > 60_000_000_000
                    or not _timestamp_matches(row['_time'],start) or re.fullmatch(r'0{16}[0-9a-f]{32}',row['_stream_id']) is None): raise TraceGateRefusal('tracking','trace_gate_08')
            if role in ('root','delivery'):
                if role in main: raise TraceGateRefusal('tracking','trace_gate_09')
                main[role]=row
                if role == 'root' and identity != root_id or role == 'delivery' and row['parent_span_id'] != root_id: raise TraceGateRefusal('tracking','trace_gate_10')
            elif role == 'provider': providers.append(row)
            parent = row.get('parent_span_id')
            if role != 'root' and (re.fullmatch(r'[0-9a-f]{16}',parent) is None or parent == '0'*16 or parent == identity): raise TraceGateRefusal('tracking','trace_gate_11')
            parsed[identity]=row
            roles[identity]=role
        if len(providers)>2 or sum(sql.values())>64: raise TraceGateRefusal('tracking','trace_gate_12')
        delivery = main.get('delivery')
        for provider in providers:
            if provider['parent_span_id'] != root_id and delivery is not None and provider['parent_span_id'] != delivery['span_id']: raise TraceGateRefusal('tracking','trace_gate_13')
        if len({row['parent_span_id'] for row in providers}) != len(providers): raise TraceGateRefusal('tracking','trace_gate_14')
        # Every visible neighboring edge is checked before returning pending.
        for row in rows:
            parent_id=row.get('parent_span_id')
            if roles[row['span_id']] == 'postgresql':
                # Production driver observations run directly in HTTP or delivery TechnicalScope.
                # The owned provider does no SQL, and nested SQL is not part of this vertical.
                if parent_id in roles and roles[parent_id] not in ('root','delivery'): raise TraceGateRefusal('tracking','trace_gate_15')
                if delivery is not None and parent_id not in (root_id,delivery['span_id']): raise TraceGateRefusal('tracking','trace_gate_16')
            parent = parsed.get(parent_id)
            if parent is not None and row is not delivery:
                if not int(parent['start_time_unix_nano']) <= int(row['start_time_unix_nano']) <= int(row['end_time_unix_nano']) <= int(parent['end_time_unix_nano']): raise TraceGateRefusal('tracking','trace_gate_17')
            visited = set(); current=row
            while current.get('parent_span_id') in parsed:
                if current['span_id'] in visited: raise TraceGateRefusal('tracking','trace_gate_18')
                visited.add(current['span_id']); current=parsed[current['parent_span_id']]
        if set(main) != {'root','delivery'} or len(providers) != 2 or not all(sql.values()): return None
        if int(delivery['start_time_unix_nano']) < int(main['root']['start_time_unix_nano']): raise TraceGateRefusal('tracking','trace_gate_19')
        expected_parents = {root_id,delivery['span_id']}
        if {row['parent_span_id'] for row in providers} != expected_parents: raise TraceGateRefusal('tracking','trace_gate_20')
        for row in rows:
            if row is main['root']: continue
            if row['parent_span_id'] not in parsed: return None
        return {'stored_spans':len(rows),'tracking_spans':1,'provider_spans':2,'postgresql_counts':sql,
                'privacy':'passed','persisted_causality':'passed'}
    except (ValueError,TypeError,KeyError,UnicodeError,OverflowError,RecursionError) as error:
        raise trace_refusal(error,scope='tracking') from None
