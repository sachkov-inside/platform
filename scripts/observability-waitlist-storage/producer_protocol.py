"""Waitlist-owned closed witness; bounded child lifetime is shared with the accepted tracking owner."""
from pathlib import Path
import re
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import source_status
HERE=Path(__file__).resolve().parent

# Reuse the accepted bounded native-child owner and shared strict JSON decoder.
import importlib.util
_spec=importlib.util.spec_from_file_location('waitlist_native_child_owner', HERE.parent/'observability-tracking-storage/producer_protocol.py')
_owner=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_owner)

def capture(*,environment=None,diagnostic=None):
    # Leave the original caller/default owner arguments identical when omitted.
    optional={} if diagnostic is None else {'diagnostic':diagnostic}
    return _owner.capture(argv=['node',str(HERE/'producer.mjs')],environment=environment,**optional)


REQUIRED = {
    'apps/backend/dist/entrypoints/api/create-api-application.js',
    'apps/backend/dist/entrypoints/api/api-delivery-lifecycle.js',
    'apps/backend/dist/modules/sales-funnel/sales-funnel.module.js',
    'apps/backend/dist/modules/sales-funnel/adapters/nest/waitlist-confirmation-pump.js',
    'apps/backend/dist/modules/sales-funnel/facets/product-waitlists/product-waitlists.js',
    'apps/backend/dist/infrastructure/observability/technical-telemetry-runtime.js',
    'apps/backend/dist/infrastructure/observability/technical-telemetry.js',
    'apps/backend/dist/infrastructure/prisma/prisma-adapter.js',
    'apps/backend/dist/migrations/index.js',
}


def witness(value):
    keys = {'schema','trace_id','root_id','provider_requests','business','persisted_carrier','native_timer','sdk_shutdown','runtime_module_groups'}
    if (type(value) is not dict or set(value) != keys or type(value['schema']) is not int or value['schema'] != 1
            or type(value['provider_requests']) is not int or value['provider_requests'] != 1
            or any(value[key] != 'passed' for key in ('business','persisted_carrier','native_timer','sdk_shutdown'))
            or type(value['trace_id']) is not str or re.fullmatch(r'[0-9a-f]{32}',value['trace_id']) is None or value['trace_id'] == '0'*32
            or type(value['root_id']) is not str or re.fullmatch(r'[0-9a-f]{16}',value['root_id']) is None or value['root_id'] == '0'*16
            or type(value['runtime_module_groups']) is not list or not 1 <= len(value['runtime_module_groups']) <= 8):
        raise ValueError('invalid waitlist producer witness')
    seen={}
    for group in value['runtime_module_groups']:
        if type(group) is not list or not 1 <= len(group) <= 512: raise ValueError('invalid waitlist module group')
        for row in group:
            if type(row) is not dict or set(row) != {'path','sha256'}: raise ValueError('invalid waitlist module row')
            name,digest=row['path'],row['sha256']
            if (type(name) is not str or not 1 <= len(name) <= 512 or name.startswith('/') or '..' in name.split('/')
                    or (not name.startswith(('apps/backend/dist/','node_modules/','packages/','docs/contracts/dist/'))
                        and name != 'docs/contracts/notifications-v1/schema.json')
                    or any(marker in name for marker in ('private-waitlist','waitlist-storage.example.test'))
                    or any(ord(char) < 32 or ord(char)==127 for char in name)
                    or type(digest) is not str or re.fullmatch(r'[0-9a-f]{64}',digest) is None):
                raise ValueError('invalid waitlist module witness')
            if name in seen: raise ValueError('duplicate waitlist module witness')
            seen[name]=digest
    if not REQUIRED <= set(seen): raise ValueError('production waitlist module witness missing')
    # No IDs, tokens, paths or producer fields enter curated evidence except validated module paths/hashes.
    return {'trace_id':value['trace_id'],'root_id':value['root_id'],'runtime_modules':seen}
