"""Fixed private collector challenges. Native processing/insertion completion remains unproved."""
import copy
import frame
import queries

KINDS=('backend','telegram','foreign','missing','unknown_family','sentinel')


def challenge(value,kind):
    if kind not in KINDS:raise ValueError('collector')
    actual=frame.payload(value);unsafe=copy.deepcopy(actual['resourceMetrics'][0])
    attributes=unsafe['resource']['attributes']
    service=next(item for item in attributes if item['key']=='service.name')
    if kind=='missing':attributes.remove(service)
    elif kind in ('backend','telegram','foreign'):
        service['value']['stringValue']={'backend':'platform-api','telegram':'inside-telegram','foreign':'foreign-service'}[kind]
    elif kind=='unknown_family':
        metric=copy.deepcopy(unsafe['scopeMetrics'][0]['metrics'][0])
        metric['name']='inside.postgresql.server.private_canary'
        unsafe['scopeMetrics'][0]['metrics']=[metric]
    else:
        for metric in unsafe['scopeMetrics'][0]['metrics']:
            metric['gauge']['dataPoints'][0]['attributes']=[{'key':'private_canary','value':{'stringValue':'controlled-private'}}]
    # The controlled challenge precedes the new actual frame. Ordering alone is NOT a completion proof.
    return {'resourceMetrics':[unsafe,*actual['resourceMetrics']]}


def run(source):
    for kind in KINDS:
        value=source.acquire();source.before_unsafe_upload();source.upload(challenge(value,kind));source.stored(value)
        source.ledger.accept(value)
        if kind in ('backend','telegram','foreign','missing'):
            observed=queries.protocol_read(source.token,source.verify_storage,value,budget=source.remaining())
            if observed['freshness']!='fresh':raise ValueError('storage')
    # Deliberate acceptance prerequisite, never bypassed by an argument/environment or a healthy query.
    # Exact pinned end-to-end processing/insertion completion proof must be independently established
    # before a separately reviewed source change can permit the native privacy case to pass.
    raise ValueError('storage')
