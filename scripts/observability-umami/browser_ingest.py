"""Synthetic native-proof transport inside the already owned private query service.

No listener, resource acquisition or credentials. Reject anything outside the closed
Web payload corpus before calling the pinned native API. Native session tokens die here.
"""
import json
import re
import sys
import uuid
import fixture

SOURCES=('direct','inside','telegram','newsletter','unknown')

def forward(raw):
    if type(raw) is not dict or set(raw)!={'type','payload'} or raw['type']!='event':raise ValueError('browser_native_envelope')
    value=raw['payload']
    if type(value) is not dict or set(value)-{'website','hostname','url','data','ip','userAgent','id'} or not {'website','hostname','url','data','ip','userAgent'}<=set(value):raise ValueError('browser_native_payload')
    if type(value['website']) is not str or str(uuid.UUID(value['website']))!=value['website']:raise ValueError('browser_native_site')
    if 'id' in value and (type(value['id']) is not str or re.fullmatch(r'[a-f0-9]{64}',value['id']) is None):raise ValueError('browser_native_identity')
    if value['hostname']!='127.0.0.1' or value['ip']!='unidentified':raise ValueError('browser_native_client')
    if type(value['userAgent']) is not str or len(value['userAgent'])>512:raise ValueError('browser_native_agent')
    data=value['data']
    if type(data) is not dict or set(data)!={'observation','event','campaign','referrer'} or data['observation']!='browser' or data['event'] not in ('product_view','material_view','access_restricted','checkout_started') or data['campaign'] not in SOURCES or data['referrer'] not in SOURCES:raise ValueError('browser_native_codes')
    if type(value['url']) is not str or re.fullmatch(r'/(products|materials)/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}(?:/locked|/purchase)?\?utm_source='+data['campaign']+'&utm_medium='+data['referrer'],value['url']) is None:raise ValueError('browser_native_address')
    fixture.call(fixture.APP,'/api/send',body=raw)
    return {'accepted':True}

if __name__=='__main__':
    try:
        encoded=sys.stdin.buffer.read(2049)
        if len(encoded)>2048:raise ValueError('browser_native_size')
        print(json.dumps(forward(json.loads(encoded))))
    except (OSError,ValueError,RuntimeError):raise SystemExit('synthetic browser native transport failed') from None
