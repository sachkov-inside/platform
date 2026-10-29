"""D1-pinned private stored projection. Native/raw-format acceptance stays distinct.

Collector14fddc710f71b6be68fb0907027c8bd3b6559696 and server
 da556abac1fd41590811b8e0dcbcbdea242dd285 own these columns. Unsupported
surfaces remain unknown; a semantic subset never proves full privacy.
"""
import copy
import importlib.util
import json
import math
from pathlib import Path
import re

_PRIVACY_PATH=Path(__file__).resolve().parents[1]/'observability-pilot/collector_privacy.py'
_PRIVACY_SPEC=importlib.util.spec_from_file_location('_representative_collector_privacy',_PRIVACY_PATH)
_PRIVACY=importlib.util.module_from_spec(_PRIVACY_SPEC);_PRIVACY_SPEC.loader.exec_module(_PRIVACY)

TRACE_COLUMNS=('name','trace_id','span_id','parent_span_id','start_ns','duration_nano','flags','kind','status_code',
    'resources_string','resource','scope','attributes_string','attributes_number','attributes_bool','attributes',
    'attributes_promoted','events','links','trace_state','status_message','status_code_string')
LOG_COLUMNS=('id','trace_id','span_id','trace_flags','timestamp_ns','observed_timestamp_ns','severity_text','severity_number',
    'body','body_v2','body_promoted','attributes_string','attributes_number','attributes_bool','resources_string',
    'resource','scope_name','scope_version','scope_string')
METRIC_COLUMNS=('env','temporality','metric_name','fingerprint','unix_milli','value','flags','description','unit','type',
    'is_monotonic','labels','attrs','scope_attrs','resource_attrs')
METRIC_GROUP_COLUMNS=tuple(k for k in METRIC_COLUMNS if k not in ('unix_milli','value','flags'))+('samples_json',)
METRIC_PARTITIONS=('metrics_0','metrics_1','metrics_2','metrics_3')
META_COLUMNS=('temporality','metric_name','description','unit','type','is_monotonic','attr_name','attr_type','attr_datatype',
    'attr_string_value','first_reported_unix_milli','last_reported_unix_milli')
UNKNOWN=('span.dropped_attributes_count','span.dropped_events_count','span.dropped_links_count','link.attributes',
    'link.trace_state','link.flags','metric.exemplars','log.dropped_attributes_count','resource.schema_url','scope.schema_url')
_LIMIT=" LIMIT 1001 SETTINGS max_execution_time=5, max_rows_to_read=100000, max_result_rows=1001, result_overflow_mode='throw'"


def need(ok,reason='representative_stored_contract'):
    if not ok:raise ValueError(reason)


def scan(value):
    # Inspect complete supported raw surfaces BEFORE selecting or coercing. The
    # wire decoder already enforces64KiB per response; dictionary expansion is
    # bounded separately and does not grant a larger query receive capability.
    count=0;characters=0
    def visit(item,depth=0):
        nonlocal count,characters
        count+=1;need(depth<=16 and count<=65536,'representative_stored_size')
        if type(item) is dict:
            for key,child in item.items():visit(key,depth+1);visit(child,depth+1)
        elif type(item) is list:
            for child in item:visit(child,depth+1)
        elif type(item) is str:
            characters+=len(item);need(characters<=1048576,'representative_stored_size')
            _PRIVACY.assert_clean(item)
        elif type(item) in (int,float):need(math.isfinite(item),'representative_stored_number')
        else:need(item is None or type(item) is bool)
    visit(value)


def _integer(value,maximum=2**63-1):
    need(type(value) is str and re.fullmatch('0|[1-9][0-9]{0,19}',value) is not None)
    number=int(value);need(number<=maximum);return number


def _object(value):
    if type(value) is str:
        def unique(pairs):
            result=dict(pairs);need(len(result)==len(pairs));return result
        value=json.loads(value,object_pairs_hook=unique,parse_constant=lambda _:need(False))
    need(type(value) is dict);return value


def _maps(row,names):
    result={}
    for name in names:
        item=_object(row[name]);need(not set(item)&set(result),'representative_stored_attribute_collision')
        result.update(item)
    return result


def span_facts(rows,*,trace_id,release):
    scan(rows);need(type(rows) is list and len(rows)<=1000)
    facts=[]
    for row in rows:
        need(type(row) is dict and set(row)==set(TRACE_COLUMNS))
        resource=_object(row['resources_string']);need(resource==_object(row['resource']),'representative_stored_resource_copy')
        if row['trace_id']!=trace_id:continue
        need(resource.get('service.version')==release)
        start=_integer(row['start_ns']);duration=_integer(row['duration_nano']);need(0<start<=start+duration<2**63)
        need(type(row['flags']) is int and 0<=row['flags']<2**32)
        need(type(row['kind']) is int and type(row['status_code']) is int)
        attrs=_maps(row,('attributes_string','attributes_number','attributes_bool'))
        need(attrs==_object(row['attributes']),'representative_stored_attribute_copy')
        promoted=_object(row['attributes_promoted']);need(all(k in attrs and type(attrs[k]) is type(v) and attrs[k]==v for k,v in promoted.items()))
        # Source-promoted HTTP status is an actual integer; only this literal
        # source-owned scalar conversion is admitted by the common SDK semantics.
        if 'http.response.status_code' in attrs:
            status=attrs['http.response.status_code'];need(type(status) is int and status==200)
            attrs['http.response.status_code']=str(status)
        need(type(row['events']) is list and not row['events'])
        links=json.loads(row['links']) if type(row['links']) is str else row['links']
        need(type(links) is list)
        for link in links:
            need(type(link) is dict and set(link)=={'traceId','spanId','refType'} and link['refType']=='CHILD_OF'
                and link['traceId']==trace_id and link['spanId']==row['parent_span_id'])
        need(len(links)<=1)
        need(type(row['trace_state']) is str and type(row['status_message']) is str and row['status_code_string'] in ('Unset','UNSET',''))
        facts.append({'name':row['name'],'trace_id':row['trace_id'],'span_id':row['span_id'],'parent_span_id':row['parent_span_id'],
            'start':start,'end':start+duration,'duration':duration,'flags':row['flags'],'kind':row['kind'],'status_code':row['status_code'],
            'resource':resource,'scope':_object(row['scope']),'attributes':attrs,'extras':{'trace_state':row['trace_state'],
                'status_message':row['status_message'],'dropped_attributes_count':None,'dropped_events_count':None,
                'dropped_links_count':None,'link_metadata':None}})
    return facts


def recipes(start,cut):
    need(type(start) is int and type(cut) is int and 0<start<cut<2**53 and cut-start<=600000)
    traces=', '.join('toString(toUnixTimestamp64Nano(timestamp)) AS start_ns' if k=='start_ns' else
        'toString(duration_nano) AS duration_nano' if k=='duration_nano' else k for k in TRACE_COLUMNS)
    logs=', '.join('toString(timestamp) AS timestamp_ns' if k=='timestamp_ns' else
        'toString(observed_timestamp) AS observed_timestamp_ns' if k=='observed_timestamp_ns' else k for k in LOG_COLUMNS)
    # Every physical sample remains in a tuple, including duplicate/poison rows.
    # Only identical catalogue maps are shared. Four fixed fingerprint partitions
    # bound each original64KiB wire without discarding any partition.
    queries={'traces':f'SELECT {traces} FROM signoz_traces.distributed_signoz_index_v3 WHERE toUnixTimestamp64Milli(timestamp) >= {start}'+_LIMIT,
        'logs':f'SELECT {logs} FROM signoz_logs.distributed_logs_v2 WHERE intDiv(timestamp,1000000) >= {start}'+_LIMIT}
    for partition,signal in enumerate(METRIC_PARTITIONS):
        queries[signal]=f'''WITH samples AS (
SELECT env, temporality, metric_name, fingerprint,
toJSONString(groupArray(tuple(toString(unix_milli),value,flags))) AS samples_json
FROM signoz_metrics.distributed_samples_v4
WHERE unix_milli >= {start} AND fingerprint % 4 = {partition}
GROUP BY env, temporality, metric_name, fingerprint), series AS (
SELECT DISTINCT env, temporality, metric_name, fingerprint, description, unit, type, is_monotonic,
labels, attrs, scope_attrs, resource_attrs
FROM signoz_metrics.distributed_time_series_v4 WHERE unix_milli >= {start//3600000*3600000}
AND fingerprint % 4 = {partition})
SELECT env, temporality, metric_name, toString(fingerprint) AS fingerprint,
description, unit, type, is_monotonic, labels, attrs, scope_attrs, resource_attrs, samples_json
FROM samples INNER JOIN series USING (env,temporality,metric_name,fingerprint)'''+_LIMIT
    queries['metadata']=f"SELECT {', '.join(META_COLUMNS)} FROM signoz_metrics.distributed_metadata WHERE last_reported_unix_milli >= {start}"+_LIMIT
    return queries


def raw_rows(raw,signal):
    from representative_reader import decode
    need(signal in ('traces','logs','metadata',*METRIC_PARTITIONS))
    value=decode(raw);scan(value)
    need(type(value) is dict and set(value)=={'status','data'} and value['status']=='success')
    data=value['data'];need(type(data) is dict and set(data)<={'type','data','meta'} and data.get('type')=='scalar')
    need(type(data['data']) is dict and set(data['data'])=={'results'})
    results=data['data']['results'];need(type(results) is list and len(results)==1)
    table=results[0];need(type(table) is dict and set(table)=={'queryName','columns','data'} and table['queryName']=='A')
    columns=table['columns'];need(type(columns) is list)
    names=[]
    for entry in columns:
        need(type(entry) is dict and set(entry)<={'name','queryName','aggregationIndex','meta','columnType','signal','fieldContext','fieldDataType','materialized'} and type(entry.get('name')) is str)
        names.append(entry['name'])
    expected=METRIC_GROUP_COLUMNS if signal in METRIC_PARTITIONS else {'traces':TRACE_COLUMNS,'logs':LOG_COLUMNS,'metadata':META_COLUMNS}[signal]
    need(len(names)==len(set(names)) and set(names)==set(expected))
    rows=table['data'];need(type(rows) is list and len(rows)<=1000)
    need(all(type(row) is list and len(row)==len(names) for row in rows))
    result=[dict(zip(names,row)) for row in rows]
    if signal not in METRIC_PARTITIONS:return result
    expanded=[]
    for group in result:
        need(type(group['fingerprint']) is str and _integer(group['fingerprint'],2**64-1)%4==METRIC_PARTITIONS.index(signal))
        need(type(group['samples_json']) is str)
        points=decode(group['samples_json'].encode())
        need(type(points) is list and len(points)>0)
        metadata={key:item for key,item in group.items() if key!='samples_json'}
        for point in points:
            need(type(point) is list and len(point)==3,'representative_stored_sample_tuple')
            stamp,value,flags=point
            stamp=_integer(stamp,2**53-1)
            need(0<stamp<2**53 and type(value) in (int,float) and math.isfinite(value)
                and type(flags) is int and 0<=flags<2**32,'representative_stored_sample_tuple')
            expanded.append(metadata|{'unix_milli':stamp,'value':value,'flags':flags})
            need(len(expanded)<=1000,'representative_stored_physical_row_cap')
    # Sorting preserves multiplicity and EVERY field. No set/distinct/latest
    # operation is applied to the indeterminately ordered groupArray samples.
    return sorted(expanded,key=lambda row:json.dumps(row,sort_keys=True,separators=(',',':'),allow_nan=False))


def private_link_challenge(payload):
    # The unchanged primary precondition runs FIRST. This explicit secondary
    # unsupported challenge cannot be misreported as that SDK-shaped precondition.
    _PRIVACY.require_supported_links(payload)
    value=copy.deepcopy(payload)
    for resource in value['traces']['resourceSpans']:
        for scope in resource['scopeSpans']:
            for span in scope['spans']:
                for link in span.get('links',[]):
                    link['traceState']='private='+_PRIVACY.SENTINEL
                    link['attributes']=[{'key':'link.secret','value':{'stringValue':_PRIVACY.SENTINEL}}]
    return value


def _semantic_leaf():
    import representative_scope as scopes
    need('scripts/observability-sdk-storage/sdk_semantics.py' in scopes._MIRROR,'representative_semantic_closure_unavailable')
    path=Path(__file__).resolve().parents[1]/'observability-sdk-storage/sdk_semantics.py'
    spec=importlib.util.spec_from_file_location('_representative_sdk_semantics',path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


def metric_facts(rows,*,release,start,cut):
    scan(rows);need(type(rows) is list and len(rows)<=1000)
    latest={};identities=set();minmax={};frames={};semantic=_semantic_leaf()
    for row in rows:
        need(type(row) is dict and set(row)==set(METRIC_COLUMNS))
        resource=_object(row['resource_attrs']);scope=_object(row['scope_attrs']);raw_attrs=_object(row['attrs'])
        need(all(type(k) is str and type(v) is str for mapping in (resource,scope,raw_attrs) for k,v in mapping.items()))
        need(type(row['metric_name']) is str and type(row['labels']) is str)
        # Pinned exporter label.go merges point, scope, resource in that order,
        # then forces __name__. Each separate original copy remains scanned.
        need(_object(row['labels'])=={**raw_attrs,**scope,**resource,'__name__':row['metric_name']},'representative_stored_label_copy')
        if resource.get('service.name')=='platform-api':
            need(resource.get('service.version') in (release,'_OTHER'),'representative_stored_source')
        if resource.get('service.name')!='platform-api' or resource.get('service.version')!=release:continue
        need(type(row['unix_milli']) is int and start<=row['unix_milli']<=cut,'representative_stored_future')
        need(type(row['flags']) is int and row['flags']==0 and type(row['value']) in (int,float)
            and math.isfinite(row['value']) and row['value']>=0)
        need(type(row['fingerprint']) is str and _integer(row['fingerprint'],2**64-1)>=0)
        need(type(row['temporality']) is str and type(row['description']) is str)
        identity=(row['env'],row['temporality'],row['metric_name'],row['fingerprint'])
        point_identity=identity+(row['unix_milli'],)
        need(point_identity not in identities,'representative_stored_duplicate');identities.add(point_identity)
        attrs=raw_attrs.copy()
        need(set(scope)>={'__scope.name__','__scope.version__','__scope.schema_url__'})
        name,version,schema=(scope[k] for k in ('__scope.name__','__scope.version__','__scope.schema_url__'))
        need(all(type(v) is str for v in (name,version,schema)) and schema=='')
        scope_attrs={k:v for k,v in scope.items() if k not in ('__scope.name__','__scope.version__','__scope.schema_url__')}
        need(attrs.pop('__temporality__',None)==row['temporality'])
        native=row['metric_name'];logical=native
        family=next((prefix for prefix in ('inside.dependency.duration','http.server.request.duration') if native.startswith(prefix+'.')),None)
        suffix=native[len(family)+1:] if family else None
        if suffix in ('min','max'):
            need(row['type']=='Gauge' and row['temporality']=='Unspecified' and row['is_monotonic'] is False and row['unit']=='s'
                and row['value']<=60 and resource=={'service.name':'platform-api','service.version':release,'deployment.environment.name':'test'}
                and not scope_attrs and name=='inside-collector' and version in ('','unknown'))
            key=(family,tuple(sorted(attrs.items())),row['unix_milli'])
            need(suffix not in minmax.setdefault(key,{}),'representative_stored_duplicate')
            minmax[key][suffix]=row['value'];continue
        if family:
            need(suffix in ('count','sum','bucket'));logical=family+'_'+suffix
        kinds={'Gauge':'gauge','Sum':'sum','Histogram':'histogram'}
        temporalities={'Unspecified':'unspecified','Cumulative':'cumulative'}
        need(row['type'] in kinds and row['temporality'] in temporalities and type(row['is_monotonic']) is bool)
        fact={'name':logical,'native_name':native,'value':row['value'],'timestamp':row['unix_milli']/1000,
            'resource':resource,'scope':{'name':name,'version':version,'attributes':scope_attrs},'attributes':attrs,
            'kind':kinds[row['type']],'unit':row['unit'],'temporality':temporalities[row['temporality']],
            'monotonic':row['is_monotonic'],'flags':row['flags'],'exemplars':None}
        frames.setdefault(row['unix_milli'],[]).append(fact)
        if identity not in latest or latest[identity][0]<row['unix_milli']:latest[identity]=(row['unix_milli'],fact)
    # EVERY old/unselected physical point reaches the unchanged semantic owner
    # before current logical facts are selected. Partial frames may be pending
    # only after every present scalar/attribute/metadata/histogram predicate passes.
    for frame in frames.values():semantic.metrics(frame,release=release)
    for (family,owner,stamp),values in minmax.items():
        sums=[f['value'] for f in frames.get(stamp,[]) if f['name']==family+'_sum' and tuple(sorted(f['attributes'].items()))==owner]
        need(len(sums)==1 and all(value==sums[0] for value in values.values()),'representative_stored_histogram_extrema')
    return [item[1] for item in latest.values()]


def validate_bundle(bundle,*,observed,release,start,cut):
    """Distinct Sig semantic verdict. No VM/raw-privacy PASS is manufactured."""
    need(type(bundle) is dict and set(bundle)=={'traces','logs','metrics','metadata'})
    scan(bundle);_PRIVACY.assert_link_preserved(bundle['traces'])
    for signal,columns in (('logs',LOG_COLUMNS),('metadata',META_COLUMNS)):
        need(type(bundle[signal]) is list and len(bundle[signal])<=1000
            and all(type(row) is dict and set(row)==set(columns) for row in bundle[signal]))
    spans=span_facts(bundle['traces'],trace_id=observed['trace_id'],release=release)
    need(all(start*1000000<=row['start']<=row['end']<=cut*1000000 for row in spans),'representative_stored_future')
    metrics=metric_facts(bundle['metrics'],release=release,start=start,cut=cut)
    semantic=_semantic_leaf()
    trace=semantic.spans(spans,trace_id=observed['trace_id'],root_id=observed['root_id'],release=release)
    metric=semantic.metrics(metrics,release=release)
    need(trace is not None and metric is not None,'representative_sdk_pending')
    return {'sdk_span_semantics':trace['sdk_span_semantics'],'sdk_metric_semantics':metric['sdk_metric_semantics'],
        'stored_spans':trace['stored_spans'],'logical_series':metric['logical_series'],
        'unknown_fields':sorted(set(UNKNOWN)|{'span.'+v for v in trace['unknown_fields']}|{'metric.'+v for v in metric['unknown_fields']}),
        'full_privacy':'unknown','original_vm_oracle':'not_applicable',
        'native_probe_cases':native_probe_cases(bundle['metrics'],release=release,cut=cut)}


def native_probe_cases(rows,*,release,cut):
    """Separate test-owned zero/latest/future samples, never current app health."""
    scan(rows);groups={}
    for row in rows:
        resource=_object(row['resource_attrs'])
        if resource.get('service.name')!='platform-task4b-native-probe':continue
        need(resource=={'service.name':'platform-task4b-native-probe','service.version':release,'service.instance.id':'representative-native-probe'})
        need(set(row)==set(METRIC_COLUMNS) and type(row['flags']) is int and row['flags']==0
            and row['temporality']=='Unspecified' and row['type']=='Gauge' and row['is_monotonic'] is False
            and type(row['value']) in (int,float) and math.isfinite(row['value']) and type(row['unix_milli']) is int)
        attrs=_object(row['attrs']);need(set(attrs)=={'source','case','__temporality__'} and attrs['__temporality__']=='Unspecified'
            and attrs['source'] in ('postgresql','caddy') and attrs['case'] in ('zero','latest','future'))
        need(_object(row['scope_attrs'])=={'__scope.name__':'platform-task4b-native-probe','__scope.version__':'1','__scope.schema_url__':''})
        need(row['metric_name'] in ('inside_production_source_available','inside_production_source_observed_at_seconds'))
        key=attrs['case'],attrs['source'],row['metric_name']
        groups.setdefault(key,[]).append(row)
    expected={(case,source,name) for case in ('zero','latest','future') for source in ('postgresql','caddy')
        for name in ('inside_production_source_available','inside_production_source_observed_at_seconds')}
    need(set(groups)==expected,'representative_native_probe_missing')
    for (case,source,name),group in groups.items():
        need(len({r['fingerprint'] for r in group})==1 and len(group)==(2 if case=='latest' else 1))
        group=sorted(group,key=lambda row:row['unix_milli'])
        stamps=[row['unix_milli'] for row in group];need(len(set(stamps))==len(stamps))
        if case=='future':need(cut<stamps[-1]<=cut+60000,'representative_native_probe_future')
        else:need(cut-600000<=stamps[0]<=stamps[-1]<=cut,'representative_native_probe_stale')
        for index,row in enumerate(group):
            expected_value=(1 if case=='future' or case=='latest' and index==0 else 0) if name.endswith('available') else row['unix_milli']/1000
            need(row['value']==expected_value,'representative_native_probe_value')
        other='inside_production_source_observed_at_seconds' if name.endswith('available') else 'inside_production_source_available'
        need(stamps==sorted(row['unix_milli'] for row in groups[(case,source,other)]))
    return ['zero','latest_zero','future']


def probe_queries(reads):
    import signoz_queries
    need(type(reads) is signoz_queries.RepresentativeReads);reads._current()
    base=reads._source_query()
    for old in ("resource_attrs['service.name'] = 'platform-owner-cache'","resource_attrs['service.instance.id'] = 'production-host'",
                "AND attrs['source'] IN ('postgresql','caddy')"):
        need(base.count(old)==1,'representative_probe_recipe_changed')
    base=base.replace("resource_attrs['service.name'] = 'platform-owner-cache'","resource_attrs['service.name'] = 'platform-task4b-native-probe'")
    base=base.replace("resource_attrs['service.instance.id'] = 'production-host'","resource_attrs['service.instance.id'] = 'representative-native-probe'")
    return {case:base.replace("AND attrs['source'] IN ('postgresql','caddy')", "AND attrs['source'] IN ('postgresql','caddy') AND attrs['case'] = '"+case+"'")+signoz_queries._metric.LIMITS for case in ('zero','latest','future')}


def probe_observation(reads,case,rows):
    need(case in ('zero','latest','future') and type(rows) is list and len(rows)==2)
    if case!='future':
        value=reads._sources(rows)
        need(value['ok'] is False and value['reason']=='unavailable' and all(v['available']==0 for v in value['sources'].values()))
        return
    need({row['source'] for row in rows}=={'postgresql','caddy'})
    cut=reads._cut
    import signoz_queries
    for row in rows:
        need(all(signoz_queries.number(v,integer=k not in ('available','observed_at_seconds')) for k,v in row.items() if k!='source'))
        need(row['evaluation_ms']==cut and row['available_series']==row['observed_series']==1
            and row['duplicate_samples']==row['flagged_samples']==row['bad_samples']==0
            and row['available']==1 and row['available_sample_ms']==row['observed_sample_ms']
            and cut<row['available_sample_ms']<=cut+60000 and row['observed_at_seconds']==row['observed_sample_ms']/1000)
    # The unchanged owner rejects future latest native sample timestamps rather
    # than falling back to an older usable row. Other malformed shapes are
    # excluded above and by the independently scanned raw native-probe corpus.
    try:reads._sources(rows)
    except ValueError:return
    raise ValueError('representative_future_probe_not_refused')
