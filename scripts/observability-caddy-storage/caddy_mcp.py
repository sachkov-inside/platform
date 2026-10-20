"""Opt-in strict MCP wire parsing; no arbitrary queries or public vendor metadata."""
import json
import math
import re
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-pilot'))
import source_status
import collector_privacy

MAX_BYTES=1_048_576


def refuse():raise ValueError('closed Caddy MCP refusal')


def _unique(pairs):
    result={}
    for key,value in pairs:
        if key in result:refuse()
        result[key]=value
    return result


def _constant(*_):refuse()


def _bounded(value,path=(),depth=0):
    if depth>16:refuse()
    if type(value) is dict:
        for key,item in value.items():
            if len(key)>128:refuse()
            _bounded(item,(*path,key),depth+1)
    elif type(value) is list:
        if len(value)>1000:refuse()
        for index,item in enumerate(value):_bounded(item,(*path,index),depth+1)
    elif type(value) is str:
        cap=MAX_BYTES if path==('result','content',0,'text') else 1024
        if len(value.encode())>cap or collector_privacy.SENTINEL in value or 'private-caddy-sentinel' in value:refuse()
    elif type(value) in (int,float):
        if not math.isfinite(value) or abs(value)>2**53-1:refuse()
    elif type(value) not in (bool,type(None)):refuse()


def body(result):
    try:
        if (type(result) is not dict or set(result) not in ({'content'},{'content','isError'})
                or 'isError' in result and result['isError'] is not False
                or type(result['content']) is not list or len(result['content'])!=1):refuse()
        content=result['content'][0]
        if type(content) is not dict or set(content)!={'type','text'} or content['type']!='text' or type(content['text']) is not str:refuse()
        raw=content['text'].encode('utf-8',errors='strict')
        if len(raw)>MAX_BYTES:refuse()
        # The designated embedded string has a separate complete VM JSON contract.
        value=source_status.decode_json(raw)
        collector_privacy.assert_clean(value)
        return raw
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError,RuntimeError):refuse()


def _identifier(value,cap=128):
    if type(value) is not str or re.fullmatch('[a-z][a-z0-9_]{0,'+str(cap-1)+'}',value) is None:refuse()


def _schema(value):
    allowed={'type','title','description','properties','required','additionalProperties','items','enum','default','pattern','format',
             'minimum','maximum','minLength','maxLength','minItems','maxItems','oneOf','anyOf','allOf'}
    if type(value) is not dict or set(value)-allowed:refuse()
    if 'type' in value and value['type'] not in ('object','array','string','number','integer','boolean','null'):refuse()
    for key in ('title','description','pattern','format'):
        if key in value and type(value[key]) is not str:refuse()
    for key in ('minimum','maximum','minLength','maxLength','minItems','maxItems'):
        if key in value and type(value[key]) not in (int,float):refuse()
    if 'additionalProperties' in value and type(value['additionalProperties']) is not bool:refuse()
    if 'default' in value and type(value['default']) not in (str,int,float,bool,type(None)):refuse()
    if 'enum' in value and (type(value['enum']) is not list or any(type(v) not in (str,int,float,bool,type(None)) for v in value['enum'])):refuse()
    properties=value.get('properties',{})
    if type(properties) is not dict or len(properties)>64:refuse()
    for key,item in properties.items():_identifier(key,64);_schema(item)
    required=value.get('required',[])
    if type(required) is not list or len(required)>64 or any(type(v) is not str for v in required) or len(set(required))!=len(required) or set(required)-set(properties):refuse()
    if 'items' in value:_schema(value['items'])
    for key in ('oneOf','anyOf','allOf'):
        if key in value:
            if type(value[key]) is not list or not 1<=len(value[key])<=64:refuse()
            for item in value[key]:_schema(item)


def _initialize(value):
    if (type(value) is not dict or set(value)!={'protocolVersion','capabilities','serverInfo'} or value['protocolVersion']!='2024-11-05'
            or type(value['capabilities']) is not dict or type(value['serverInfo']) is not dict or set(value['serverInfo'])!={'name','version'}
            or any(type(v) is not str or not 1<=len(v)<=128 for v in value['serverInfo'].values())):refuse()
    fields={'tools':{'listChanged'},'prompts':{'listChanged'},'resources':{'listChanged','subscribe'},'logging':set(),'completions':set()}
    for key,item in value['capabilities'].items():
        if key not in fields or type(item) is not dict or set(item)-fields[key] or any(type(v) is not bool for v in item.values()):refuse()


def _discovery(value):
    if type(value) is not dict or set(value)!={'tools'} or type(value['tools']) is not list or not 1<=len(value['tools'])<=256:refuse()
    seen=set();query=None
    for tool in value['tools']:
        if type(tool) is not dict or not {'name','inputSchema'}<=set(tool) or set(tool)-{'name','inputSchema','description','annotations'}:refuse()
        name=tool['name'];_identifier(name)
        if name in seen:refuse()
        seen.add(name);_schema(tool['inputSchema'])
        if tool['inputSchema'].get('type')!='object' or 'description' in tool and type(tool['description']) is not str:refuse()
        annotations=tool.get('annotations',{})
        if type(annotations) is not dict or set(annotations)-{'title','readOnlyHint','destructiveHint','idempotentHint','openWorldHint'}:refuse()
        for key,item in annotations.items():
            if type(item) is not (str if key=='title' else bool):refuse()
        if name=='query':query=tool
    if query is None:refuse()
    properties=query['inputSchema'].get('properties',{})
    expected={'query':'string','time':'string','step':'string','timeout':'string','trace':'boolean','nocache':'boolean'}
    if (set(properties)!=set(expected) or any(properties[key].get('type')!=kind for key,kind in expected.items())
            or query['inputSchema'].get('required')!=['query']
            or query.get('annotations',{}).get('readOnlyHint') is not True
            or query.get('annotations',{}).get('destructiveHint') is not False
            or query.get('annotations',{}).get('openWorldHint') is not True):refuse()


def decode_response(raw,expected_id):
    try:
        if type(raw) is not bytes or len(raw)>MAX_BYTES or type(expected_id) is not int or expected_id not in (1,2,3,4):refuse()
        value=json.loads(raw.decode('utf-8',errors='strict'),object_pairs_hook=_unique,parse_constant=_constant)
        _bounded(value)
        if (type(value) is not dict or set(value)!={'jsonrpc','id','result'} or value['jsonrpc']!='2.0'
                or type(value['id']) is not int or value['id']!=expected_id):refuse()
        if expected_id in (3,4):body(value['result'])
        elif expected_id==1:_initialize(value['result'])
        else:_discovery(value['result'])
        return value
    except (ValueError,TypeError,KeyError,UnicodeError,RecursionError,OverflowError):refuse()
