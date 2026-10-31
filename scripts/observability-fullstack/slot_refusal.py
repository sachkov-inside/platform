"""One closed first-refusal leaf shared by ordinary and diagnostic collectors."""
import json

MAX_US=600_000_000
MAX_BYTES=2048


def validate(value,phase,enabled,missed,*,count_unknown=False):
    def need(ok):
        if not ok:raise ValueError('closed_slot_refusal')
    def integer(v,maximum=MAX_US):return type(v) is int and 0<=v<=maximum
    need(integer(phase,11) and type(enabled) is bool and ((count_unknown and missed is None) or integer(missed,400)))
    need(type(value) is dict and type(value.get('schema')) is int and value['schema']==1)
    state=value.get('state')
    if state=='not_refused':need(set(value)=={'schema','state'} and (missed is None or missed==0))
    elif state=='unavailable':
        need(set(value)=={'schema','state','reason'} and type(value['reason']) is str and value['reason'] in ('clock','bounds','capture'))
    elif state=='captured':
        need(set(value)=={'schema','state','phase','mode','decision_us','slots'} and (missed is None or missed>0))
        need(integer(value['phase'],11) and value['phase']==phase and value['mode']==('on' if enabled else 'off'))
        at=value['decision_us'];rows=value['slots'];need(integer(at) and type(rows) is list and len(rows)==8)
        previous=-1
        for row in rows:
            need(type(row) is list and len(row)==6 and all(integer(v) for v in row))
            kind,stage,acquired,changed,age,elapsed=row
            need(kind<=7 and stage in ((0,1,2) if enabled else (1,2)) and previous<=acquired<=changed<=at)
            need(age==at-acquired and elapsed==at-changed and elapsed<=age)
            previous=acquired
    else:need(False)
    need(len(json.dumps(value,separators=(',',':'),allow_nan=False).encode())<=MAX_BYTES
        and len(json.dumps(value,indent=2,allow_nan=False).encode())<=4096)
    return value


def project(load,phase,enabled):
    """Diagnostic corruption is unknown, never a new body failure or a fabricated zero."""
    try:return validate(load['slot_refusal'],phase,enabled,load['missed'])
    except (KeyError,TypeError,ValueError):return {'schema':1,'state':'unavailable','reason':'capture'}
