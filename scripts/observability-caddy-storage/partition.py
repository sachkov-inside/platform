"""Exact primary adaptation witness; no inference from a guessed server/handler name."""
import hashlib
import json
from pathlib import Path
import overlay
import caddy_status

EXPECTED=json.loads((Path(__file__).with_name('fixtures')/'adaptation.json').read_text())


def refuse():raise ValueError('closed Caddy adaptation refused')


def validate_summary(servers):
    try:
        raw=json.dumps(servers,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
        expected=json.dumps(EXPECTED['servers'],sort_keys=True,separators=(',',':')).encode()
        if len(raw)>65536 or raw!=expected:refuse()
        return {'partition':'srv0/subroute','scrape_server':'srv1','admin':'off'}
    except (ValueError,TypeError,RecursionError,OverflowError):refuse()


def validate_adaptation(raw):
    try:
        value=caddy_status.source_status.decode_json(raw)
        canonical=json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()
        if (hashlib.sha256(canonical).hexdigest()!=overlay.ADAPTED_CANONICAL_SHA256
                or value['admin']!={'disabled':True} or value['apps']['http']['metrics']!={}):refuse()
        def routes(items,prefix='routes'):
            result=[]
            for index,route in enumerate(items):
                path=prefix+'/'+str(index)
                result.append({'path':path,'match':route.get('match',[]),'group':route.get('group'),
                               'terminal':route.get('terminal',False),'handlers':[handler['handler'] for handler in route.get('handle',[])]})
                for position,handler in enumerate(route.get('handle',[])):
                    if 'routes' in handler:result.extend(routes(handler['routes'],path+'/handle/'+str(position)+'/routes'))
            return result
        summary={name:{'listen':server['listen'],'routes':routes(server.get('routes',[]))} for name,server in value['apps']['http']['servers'].items()}
        return validate_summary(summary)
    except (ValueError,TypeError,KeyError,RecursionError,OverflowError):refuse()
