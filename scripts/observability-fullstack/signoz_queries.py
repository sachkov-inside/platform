"""Finite private representative reads. Source-model recipes; native storage proof is pending.

A trusted controller creates a fresh reader for each live poll using its CURRENT captured
cut, not the planned phase end. No agent-provided window, SQL, path or transport lives here.
"""
from dataclasses import dataclass, field
import importlib.util
import json
import math
from pathlib import Path
import re

import core_layout

_spec=importlib.util.spec_from_file_location('_representative_metric_recipe',
    Path(__file__).resolve().parents[1]/'observability-signoz/metric_recipe.py')
_metric=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_metric)
PATH='/api/v5/query_range'
MAX_BYTES=65536
_API_LAG_SECONDS=json.loads((core_layout.ROOT/'infra/observability/fullstack/profile.json').read_text())['thresholds']['ingestion_lag_seconds']
if not (type(_API_LAG_SECONDS) is int and 0<_API_LAG_SECONDS<=600):raise ValueError('representative_query_profile')
BIND_COLUMNS=('query_phase','query_cut_ms','query_source_sha')
OPERATIONS=('retained_probes','source_status','api_lag','readiness_metrics','readiness_logs','readiness_traces','correlated_traces','correlated_logs','web_initial','web_current')
WEB_SLOTS=('info','epoch','observed','positive','negative','up')
WEB_COLUMNS=tuple(field for slot in WEB_SLOTS for field in (slot,slot+'_ms',slot+'_series'))+('duplicate_samples','flagged_samples','bad_samples')
LAG_COLUMNS=('raw_count','sample_ms','flagged_samples','bad_samples')
CORRELATION_COLUMNS=('raw_count','distinct_ids','first_ms','last_ms','bad_ids')
SOURCE_COLUMNS=('source','available','observed_at_seconds','available_sample_ms','observed_sample_ms','available_series','observed_series','duplicate_samples','flagged_samples','bad_samples','evaluation_ms')
COUNT_COLUMNS=('raw_count','distinct_indices','min_index','max_index','noninteger_indices','flagged_samples','first_ms','last_ms')


def need(ok):
    if not ok:raise ValueError('representative_query_contract')


def number(value,*,integer=False,minimum=0,maximum=2**53-1):
    return type(value) in (int,float) and minimum<=value<=maximum and math.isfinite(value) and (not integer or value==int(value))


def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)


@dataclass(frozen=True,repr=False)
class Request:
    """Opaque in-process capability for one source/phase/cut; never a public artifact."""
    _owner:object=field(repr=False)
    _operation:str
    _binding:str
    _payload:str

    @property
    def path(self):return PATH

    @property
    def payload(self):return json.loads(self._payload)


def object_pairs(pairs):
    value={}
    for key,item in pairs:
        need(key not in value);value[key]=item
    return value


def rows(status,body,columns):
    need(type(status) is int and status==200 and type(body) is bytes and 0<len(body)<=MAX_BYTES)
    # Reject deeply nested hostile JSON before the stdlib decoder allocates it.
    depth=0;quoted=escaped=False
    for byte in body:
        if quoted:
            if escaped:escaped=False
            elif byte==92:escaped=True
            elif byte==34:quoted=False
        elif byte==34:quoted=True
        elif byte in (91,123):depth+=1;need(depth<=16)
        elif byte in (93,125):depth-=1;need(depth>=0)
    need(depth==0 and not quoted)
    value=json.loads(body.decode('utf-8'),object_pairs_hook=object_pairs,parse_constant=lambda _:need(False))
    need(type(value) is dict and set(value)=={'status','data'} and value['status']=='success')
    value=value['data'];need(type(value) is dict and set(value)<={'type','data','meta'} and value.get('type')=='scalar')
    data=value.get('data');need(type(data) is dict and set(data)=={'results'})
    results=data['results'];need(type(results) is list and len(results)==1)
    table=results[0];need(type(table) is dict and set(table)=={'queryName','columns','data'} and table['queryName']=='A')
    fields=table['columns'];need(type(fields) is list and len(fields)==len(columns))
    names=[]
    for entry in fields:
        need(type(entry) is dict and set(entry)<={'name','queryName','aggregationIndex','meta','columnType','signal','fieldContext','fieldDataType','materialized'} and type(entry.get('name')) is str)
        names.append(entry['name'])
    need(len(set(names))==len(names) and set(names)==set(columns))
    data=table['data'];need(type(data) is list and 1<=len(data)<=4)
    need(all(type(row) is list and len(row)==len(names) for row in data))
    return [dict(zip(names,row)) for row in data]


class RepresentativeReads:
    """Prepared trusted controller interface; no runtime, key or reader authority is granted."""
    def __init__(self,layout,phase,start_ms,cut_ms,*,web=None):
        need(type(layout) is core_layout.Layout)
        layout.validate(layout.plan,layout.manifest)
        manifest=layout.manifest
        need(manifest['core']==core_layout.SIGNOZ and manifest['owner']==core_layout.OWNER and manifest['profile']==core_layout.PROFILE)
        _metric.FixedMetricReads(phase,start_ms,cut_ms)
        need(type(manifest['source']) is dict and set(manifest['source'])=={'commit','tree'}
            and all(type(value) is str and re.fullmatch('[a-f0-9]{40}',value) is not None for value in manifest['source'].values()))
        need(cut_ms<=((2**63-1)//1000000))
        if web is not None:
            need(type(web) is dict and set(web)=={'ok','positive_count','not_found_count','process_start_seconds','observed_at_seconds'} and web['ok'] is True)
            need(all(number(web[k],integer=True,minimum=1) for k in ('positive_count','not_found_count')))
            need(all(number(web[k],minimum=.001,maximum=1e12-1) for k in ('process_start_seconds','observed_at_seconds')))
            need(web['process_start_seconds']<=web['observed_at_seconds']<=cut_ms/1000)
        self._web=encoded(web)
        self._start,self._cut,self._phase=start_ms,cut_ms,phase
        self._owner=object()
        self._binding=encoded({key:manifest[key] for key in ('source','root','root_identity','profile','project','nonce')}
            |{'phase':phase,'pair':phase//6 if phase<12 else None,'mode':('on' if phase%6>=3 else 'off') if phase<12 else 'outage' if phase==12 else 'recovery','start_ms':start_ms,'cut_ms':cut_ms})

    @property
    def binding(self):return json.loads(self._binding)

    def prepare(self,operation,parameters):
        need(type(operation) is str and operation in OPERATIONS and type(parameters) is dict and parameters=={})
        if operation=='web_current':need(self._web!='null')
        if operation!='retained_probes':
            query=self._source_query() if operation=='source_status' else self._lag_query() if operation=='api_lag' else self._web_query() if operation.startswith('web_') else self._signal_query(operation)
            return self._request(operation,query+_metric.LIMITS)
        base=_metric.FixedMetricReads(self._phase,self._start,self._cut).call('retained_sample_count',{})
        query=base['compositeQuery']['queries'][0]['spec']['query']
        old='countIf(flags != 0) AS flagged_samples'
        need(query.count(old)==1)
        query=query.replace(old,old+', if(count()=0,0,min(unix_milli)) AS first_ms, if(count()=0,0,max(unix_milli)) AS last_ms')
        query=query.replace('min(value) AS min_index','if(count()=0,0,min(value)) AS min_index').replace('max(value) AS max_index','if(count()=0,0,max(value)) AS max_index')
        # Include future latest samples so the parser refuses them, never falls back to old data.
        upper=f' AND unix_milli <= {self._cut}';need(query.count(upper)==2)
        query=query.replace(upper,'')
        return self._request(operation,query)

    def _request(self,operation,query):
        need(query.endswith(_metric.LIMITS));query=query[:-len(_metric.LIMITS)]
        sha=self.binding['source']['commit']
        # These constants bind a native query RESULT to the dispatched request.
        # They are NOT telemetry attributes or independent native source proof.
        bound=f"SELECT *, {self._phase} AS query_phase, {self._cut} AS query_cut_ms, '{sha}' AS query_source_sha FROM ({query})"+_metric.LIMITS
        return Request(self._owner,operation,self._binding,encoded(_metric.envelope(bound,self._start,self._cut,'scalar')))

    def _rows(self,status,body,columns):
        data=rows(status,body,(*columns,*BIND_COLUMNS))
        for row in data:
            need(type(row['query_phase']) is int and row['query_phase']==self._phase)
            need(type(row['query_cut_ms']) is int and row['query_cut_ms']==self._cut)
            need(type(row['query_source_sha']) is str and row['query_source_sha']==self.binding['source']['commit'])
            for column in BIND_COLUMNS:del row[column]
        return data

    def _web_query(self):
        sha=self.binding['source']['commit']
        # Unknown Prometheus types become Gauge; requests_total's actual counter
        # remains Cumulative and retains _total with suffix trimming disabled.
        slots="""multiIf(metric_name = 'inside_web_http_source_info','info',
metric_name = 'inside_web_http_process_start_time_seconds','epoch',
metric_name = 'inside_web_http_observed_at_seconds','observed',
metric_name = 'up','up',attrs['route'] = '/_health/live','positive','negative')"""
        fields=[]
        for slot in WEB_SLOTS:
            fields.extend((f"anyIf(latest_value, slot = '{slot}') AS {slot}",
                f"maxIf(sample_ms, slot = '{slot}') AS {slot}_ms",
                f"sumIf(series_count, slot = '{slot}') AS {slot}_series"))
        return f"""WITH series AS (
SELECT DISTINCT env, temporality, metric_name, fingerprint, {slots} AS slot
FROM signoz_metrics.distributed_time_series_v4
WHERE unix_milli >= {self._start//3600000*3600000}
AND resource_attrs['service.name'] = 'platform-web-http' AND resource_attrs['service.instance.id'] = 'web'
AND ((metric_name = 'up' AND temporality = 'Unspecified') OR
(attrs['service'] = 'platform-web' AND attrs['environment'] = 'isolated-pilot' AND attrs['source_sha'] = '{sha}'
AND ((metric_name IN ('inside_web_http_source_info','inside_web_http_process_start_time_seconds','inside_web_http_observed_at_seconds') AND temporality = 'Unspecified') OR
(metric_name = 'inside_web_http_requests_total' AND temporality = 'Cumulative'
AND attrs['method'] = 'GET' AND attrs['outcome'] = 'completed'
AND ((attrs['route'] = '/_health/live' AND attrs['code'] = '200') OR (attrs['route'] = '_unmatched' AND attrs['code'] = '404'))))))
), latest AS (
SELECT slot, argMax(value, unix_milli) AS latest_value, max(unix_milli) AS sample_ms,
uniqExact(fingerprint) AS series_count, count() - uniqExact(unix_milli) AS duplicates,
countIf(flags != 0) AS flagged, countIf(NOT isFinite(value) OR value < 0 OR
(slot IN ('positive','negative') AND value != floor(value))) AS bad
FROM signoz_metrics.distributed_samples_v4 INNER JOIN series USING (env, temporality, metric_name, fingerprint)
WHERE unix_milli >= {self._start} GROUP BY slot)
SELECT {', '.join(fields)}, sum(duplicates) AS duplicate_samples,
sum(flagged) AS flagged_samples, sum(bad) AS bad_samples FROM latest"""

    def _web_observation(self,operation,data):
        need(len(data)==1);row=data[0]
        need(all(number(row[k],integer=True) and row[k]==0 for k in ('duplicate_samples','flagged_samples','bad_samples')))
        for slot in WEB_SLOTS:
            need(number(row[slot],minimum=0,maximum=1e12-1 if slot in ('epoch','observed') else 2**53-1))
            need(type(row[slot+'_series']) in (int,float) and not isinstance(row[slot+'_series'],bool) and row[slot+'_series']==1)
            need(number(row[slot+'_ms'],integer=True) and self._start<=row[slot+'_ms']<=self._cut)
        need(row['info']==row['up']==1 and row['epoch']>0 and row['epoch']<=row['observed']<=self._cut/1000)
        need(self._cut/1000-row['observed']<=10)
        need(all(number(row[k],integer=True,minimum=1) for k in ('positive','negative')))
        if operation=='web_current':
            expected=json.loads(self._web)
            need(row['epoch']==expected['process_start_seconds'] and row['observed']>=expected['observed_at_seconds'])
            need(row['positive']>=expected['positive_count'] and row['negative']>=expected['not_found_count'])
            need(all(row[slot+'_ms']/1000>=expected['observed_at_seconds'] for slot in ('positive','negative')))
        return {'ok':True}

    def _lag_query(self):
        # SDK v1 becomes _OTHER under the UNCHANGED canonical Alloy version policy.
        # It is not the separate emitter's source SHA, nor native source attestation.
        # All native metric names/types remain untouched; no VM-promoted aliases.
        return f"""SELECT count() AS raw_count, max(unix_milli) AS sample_ms,
countIf(flags != 0) AS flagged_samples, countIf(NOT isFinite(value)) AS bad_samples
FROM signoz_metrics.distributed_samples_v4
WHERE unix_milli >= {self._start}
AND (env, temporality, metric_name, fingerprint) GLOBAL IN
(SELECT env, temporality, metric_name, fingerprint FROM signoz_metrics.distributed_time_series_v4
WHERE unix_milli >= {self._start//3600000*3600000}
AND resource_attrs['service.name'] = 'platform-api' AND resource_attrs['service.version'] = '_OTHER')"""

    def _signal_query(self,operation):
        if operation=='readiness_metrics':return 'SELECT toUInt8(1) AS count'
        signal='traces' if operation.endswith('traces') else 'logs'
        if signal=='traces':
            table='signoz_traces.distributed_signoz_index_v3'
            stamp='toUnixTimestamp64Milli(timestamp)'
            identity='tuple(trace_id,span_id)'
        else:
            table='signoz_logs.distributed_logs_v2'
            stamp='intDiv(timestamp,1000000)'
            identity='id'
        window=f'{stamp} >= {self._start}'
        if operation.startswith('readiness_'):
            # A bounded readable native store, including count0, is NOT new data/source proof.
            return f'SELECT count() AS count FROM {table} WHERE {window}'
        sha=self.binding['source']['commit']
        # This is the separate existing SDK emitter (release=source SHA), not the
        # normal app's v1 resources. Counts alone prove neither actor nor MCP parity.
        trace_set=f"""SELECT trace_id FROM signoz_traces.distributed_signoz_index_v3
WHERE toUnixTimestamp64Milli(timestamp) >= {self._start}
AND `resource_string_service$$name` = 'platform-api'
AND resources_string['service.version'] = '{sha}'"""
        return f"""SELECT count() AS raw_count, uniqExact({identity}) AS distinct_ids,
if(count()=0,0,min({stamp})) AS first_ms, if(count()=0,0,max({stamp})) AS last_ms,
countIf(NOT match(trace_id,'^[0-9a-f]{{32}}$') OR trace_id = '{'0'*32}') AS bad_ids
FROM {table} WHERE {window} AND resources_string['service.version'] = '{sha}'
AND {'`resource_string_service$$name`' if signal=='traces' else "resources_string['service.name']"} = 'platform-api'
AND trace_id GLOBAL IN ({trace_set})"""

    def _source_query(self):
        # Catalog rows are per HOUR; DISTINCT prevents repeated hourly catalog rows
        # multiplying real samples. No upper-time filter may hide a future latest row.
        return f"""WITH series AS (
SELECT DISTINCT env, temporality, metric_name, fingerprint, attrs['source'] AS source
FROM signoz_metrics.distributed_time_series_v4
WHERE metric_name IN ('inside_production_source_available','inside_production_source_observed_at_seconds')
AND temporality = 'Unspecified' AND unix_milli >= {self._start//3600000*3600000}
AND resource_attrs['service.name'] = 'platform-owner-cache'
AND resource_attrs['service.instance.id'] = 'production-host'
AND attrs['source'] IN ('postgresql','caddy')
), latest AS (
SELECT source, metric_name, argMax(value, unix_milli) AS latest_value,
max(unix_milli) AS sample_ms, uniqExact(fingerprint) AS series_count,
count() - uniqExact(unix_milli) AS duplicates, countIf(flags != 0) AS flagged,
countIf(NOT isFinite(value) OR (metric_name = 'inside_production_source_available' AND value NOT IN (0,1)) OR
(metric_name = 'inside_production_source_observed_at_seconds' AND value <= 0)) AS bad
FROM signoz_metrics.distributed_samples_v4 INNER JOIN series USING (env, temporality, metric_name, fingerprint)
WHERE unix_milli >= {self._start} GROUP BY source, metric_name)
SELECT source,
anyIf(latest_value, metric_name = 'inside_production_source_available') AS available,
anyIf(latest_value, metric_name = 'inside_production_source_observed_at_seconds') AS observed_at_seconds,
maxIf(sample_ms, metric_name = 'inside_production_source_available') AS available_sample_ms,
maxIf(sample_ms, metric_name = 'inside_production_source_observed_at_seconds') AS observed_sample_ms,
sumIf(series_count, metric_name = 'inside_production_source_available') AS available_series,
sumIf(series_count, metric_name = 'inside_production_source_observed_at_seconds') AS observed_series,
sum(duplicates) AS duplicate_samples, sum(flagged) AS flagged_samples, sum(bad) AS bad_samples,
{self._cut} AS evaluation_ms FROM latest GROUP BY source"""

    def _sources(self,data):
        need(len(data)==2);sources={};cut=self._cut/1000
        for row in data:
            source=row['source'];need(type(source) is str and source in ('postgresql','caddy') and source not in sources)
            need(all(number(row[k],integer=True) for k in ('available_sample_ms','observed_sample_ms','available_series','observed_series','duplicate_samples','flagged_samples','bad_samples','evaluation_ms')))
            need(row['evaluation_ms']==self._cut and row['available_series']==row['observed_series']==1)
            need(row['duplicate_samples']==row['flagged_samples']==row['bad_samples']==0)
            need(number(row['available']) and row['available'] in (0,1) and number(row['observed_at_seconds'],minimum=.001))
            available_ms,observed_ms=row['available_sample_ms'],row['observed_sample_ms']
            need(self._start<=available_ms<=self._cut and self._start<=observed_ms<=self._cut)
            sources[source]={'available':int(row['available']),'observed_at_seconds':row['observed_at_seconds'],
                'observed_age_seconds':cut-row['observed_at_seconds'],
                'sample_time_seconds':observed_ms/1000,'sample_age_seconds':(self._cut-observed_ms)/1000,
                'available_sample_time_seconds':available_ms/1000,'available_sample_age_seconds':(self._cut-available_ms)/1000}
        values=list(sources.values());reason='ready'
        if any(v['observed_age_seconds']<0 for v in values):reason='future'
        elif any(max(v['observed_age_seconds'],v['sample_age_seconds'],v['available_sample_age_seconds'])>10 for v in values):reason='stale'
        elif any(v['available']==0 for v in values):reason='unavailable'
        return {'ok':reason=='ready','reason':reason,'evaluation_seconds':cut,'sources':sources}

    def observe(self,request,status,body):
        need(type(request) is Request and request._owner is self._owner and request._binding==self._binding)
        expected=self.prepare(request._operation,{})
        need(request._payload==expected._payload)
        try:
            operation=request._operation
            if operation=='source_status':return self._sources(self._rows(status,body,SOURCE_COLUMNS))
            if operation.startswith('web_'):return self._web_observation(operation,self._rows(status,body,WEB_COLUMNS))
            if operation.startswith('readiness_'):
                data=self._rows(status,body,('count',));need(len(data)==1 and number(data[0]['count'],integer=True,maximum=100000))
                if operation=='readiness_metrics':need(data[0]['count']==1)
                return {'ok':True}
            if operation=='api_lag':
                data=self._rows(status,body,LAG_COLUMNS);need(len(data)==1);value=data[0]
                need(all(number(v,integer=True) for v in value.values()))
                need(0<value['raw_count']<=100000 and value['flagged_samples']==value['bad_samples']==0)
                need(self._start<=value['sample_ms']<=self._cut and (self._cut-value['sample_ms'])/1000<=_API_LAG_SECONDS)
                return {'ok':True,'age_seconds':(self._cut-value['sample_ms'])/1000,'sample_time_seconds':value['sample_ms']/1000}
            if operation.startswith('correlated_'):
                data=self._rows(status,body,CORRELATION_COLUMNS);need(len(data)==1);value=data[0]
                need(all(number(v,integer=True) for v in value.values()))
                count=value['raw_count'];need(count<=100000 and value['distinct_ids']==count and value['bad_ids']==0)
                if count==0:need(all(v==0 for v in value.values()))
                else:need(self._start<=value['first_ms']<=value['last_ms']<=self._cut)
                return {'ok':True,'count':int(count)}
            data=self._rows(status,body,COUNT_COLUMNS);need(len(data)==1)
            value=data[0]
            need(all(number(v,integer=True) for v in value.values()))
            count=value['raw_count'];need(count<=400 and value['distinct_indices']==count and value['noninteger_indices']==value['flagged_samples']==0)
            if count==0:need(all(v==0 for v in value.values()))
            else:
                need(value['min_index']==1 and value['max_index']==count)
                need(self._start<=value['first_ms']<=value['last_ms']<=self._cut)
            return {'ok':True,'count':int(count)}
        except (ValueError,TypeError,OverflowError,RecursionError):return {'ok':False,'reason':'schema'}
