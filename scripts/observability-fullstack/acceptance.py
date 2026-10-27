"""Fixed spec resource gates over measured evidence, never configured container limits."""
import math

LIMITS={'query_max_seconds':(10,False),'ingestion_lag_seconds':(60,False),
    'http_p95_overhead_percent':(5,False),'additional_host_cpu_fraction':(.1,False),
    'minimum_host_memory_free_fraction':(.25,True),'minimum_host_disk_free_fraction':(.25,True)}
FIELDS={'complete','oom','enospc','unexplained_loss','peak_host_used_bytes',*LIMITS}


def assess(value):
    if type(value) is not dict or set(value)!=FIELDS:
        return {'state':'incomplete','minimum_candidate_gib':None}
    booleans=('complete','oom','enospc')
    if any(type(value.get(key)) is not bool for key in booleans):
        return {'state':'incomplete','minimum_candidate_gib':None}
    if any(type(value.get(key)) not in (int,float) or not math.isfinite(value[key]) for key in FIELDS-set(booleans)):
        return {'state':'incomplete','minimum_candidate_gib':None}
    if (any(value[key]<0 for key in ('query_max_seconds','ingestion_lag_seconds','unexplained_loss','additional_host_cpu_fraction'))
            or any(not 0<=value[key]<=1 for key in ('minimum_host_memory_free_fraction','minimum_host_disk_free_fraction'))):
        return {'state':'incomplete','minimum_candidate_gib':None}
    failed=(not value['complete'] or value['oom'] or value['enospc'] or value['unexplained_loss']!=0
        or value['peak_host_used_bytes']<=0 or any(value[key]<limit if lower else value[key]>limit for key,(limit,lower) in LIMITS.items()))
    required=value['peak_host_used_bytes']/.75
    candidate=next((gib for gib in (4,8) if gib*1024**3>=required),None)
    return {'state':'failed' if failed or candidate is None else 'passed',
        'minimum_candidate_gib':candidate,'measured_peak_host_used_bytes':value['peak_host_used_bytes'],
        'required_bytes_with_25pct_reserve':math.ceil(required)}


def validate_profile(value):
    if (type(value) is not dict or value.get('schema')!=1 or value.get('name')!='platform-representative-v1'
            or type(value.get('accounts')) is not int or value['accounts']!=256
            or type(value.get('materials')) is not int or not 256<=value['materials']<=512
            or value.get('pairs')!=[['off','on'],['on','off']]
            or value.get('concurrency')!=8 or value.get('sample_ratio')!=1
            or value.get('phases')!=[{'name':'idle','seconds':10,'requests_per_second':0},
                {'name':'steady','seconds':40,'requests_per_second':10},{'name':'spike','seconds':10,'requests_per_second':40}]
            or value.get('thresholds')!={'query_seconds':10,'ingestion_lag_seconds':60,'http_p95_overhead_percent':5,
                'additional_host_cpu_fraction':.1,'application_reserve_fraction':.25}
            or set(value.get('operations',[]))!={'web_home','web_material','api_catalog','api_account','mcp_discovery','analytics_send','telegram_webhook','logto_discovery'}):
        raise ValueError('representative_fullstack_profile_required')
    return value
