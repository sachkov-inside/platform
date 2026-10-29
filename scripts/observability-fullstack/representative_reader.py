"""Private representative reader. Original envelopes remain private until observed.

No native activation is exported by the public fullstack selector. Keys live only
in the admitted resident process. A query cannot acquire inventory's receive cap.
"""
import http.client
import json
import math
from pathlib import Path
import time

MAX_BYTES=65536
_GATEWAY=Path('/gateway/reader.sock')
_SESSION=Path('/private/representative-session.json')
_INVENTORY=object()
_INVENTORY_REQUEST={'jsonrpc':'2.0','id':2,'method':'tools/list','params':{}}
_INITIALIZED_REQUEST={'jsonrpc':'2.0','method':'notifications/initialized'}


def need(ok,reason='representative_reader_contract'):
    if not ok:raise ValueError(reason)


def encoded(value):return json.dumps(value,separators=(',',':'),allow_nan=False).encode()


def unique(pairs):
    result={}
    for key,value in pairs:need(key not in result,'representative_duplicate_key');result[key]=value
    return result


def decode(raw,maximum=MAX_BYTES):
    need(type(raw) is bytes and 0<len(raw)<=maximum,'representative_response_size')
    depth=0;quoted=escaped=False
    for byte in raw:
        if quoted:
            if escaped:escaped=False
            elif byte==92:escaped=True
            elif byte==34:quoted=False
        elif byte==34:quoted=True
        elif byte in (91,123):depth+=1;need(depth<=16,'representative_response_depth')
        elif byte in (93,125):depth-=1;need(depth>=0)
    need(depth==0 and not quoted)
    return json.loads(raw.decode('utf-8'),object_pairs_hook=unique,parse_constant=lambda _:need(False))


class NativeReads:
    """Fixed private native transport, no path/URL/SQL policy from the agent."""
    __slots__=('__key','__deadline')
    def __init__(self,key,deadline):
        need(type(key) is str and 0<len(key)<=4096)
        need(type(deadline) in (int,float) and math.isfinite(deadline) and time.monotonic()<deadline)
        self.__key=key;self.__deadline=deadline
    def __repr__(self):return '<PrivateRepresentativeTransport>'
    def _wire(self,host,port,path,payload,*,inventory=None):
        remaining=self.__deadline-time.monotonic();need(remaining>0,'representative_reader_deadline')
        limit=262144 if inventory is _INVENTORY and payload is _INVENTORY_REQUEST and host=='mcp' and path=='/mcp' else MAX_BYTES
        connection=http.client.HTTPConnection(host,port,timeout=min(10,remaining));first=None
        try:
            headers={'Content-Type':'application/json','Connection':'close','SIGNOZ-API-KEY':self.__key}
            if host=='mcp':headers.update({'Accept':'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'})
            connection.request('POST',path,encoded(payload),headers)
            response=connection.getresponse();raw=response.read(limit+1)
            notification=host=='mcp' and payload is _INITIALIZED_REQUEST
            need(type(response.status) is int and response.status in ((200,202,204) if notification else (200,)),'representative_http_status')
            need((notification or 0<len(raw)) and len(raw)<=limit and time.monotonic()<self.__deadline,'representative_reader_deadline_or_size')
            return raw
        except BaseException as error:first=error;raise
        finally:
            try:connection.close()
            except BaseException:
                if first is None:raise
    def _rpc(self,payload,*,inventory=None):
        raw=self._wire('mcp',8000,'/mcp',payload,inventory=inventory)
        value=decode(raw,262144 if inventory is _INVENTORY else MAX_BYTES)
        need(type(value) is dict and set(value)=={'jsonrpc','id','result'} and value['jsonrpc']=='2.0'
             and type(value['id']) is int and value['id']==payload['id'],'representative_mcp_envelope')
        result=value['result'];need(type(result) is dict and result.get('isError',False) is False,'representative_mcp_error')
        return result
    def _ready(self):
        end=min(self.__deadline,time.monotonic()+55)
        while time.monotonic()<end:
            connection=http.client.HTTPConnection('mcp',8000,timeout=min(1,end-time.monotonic()));first=None
            try:
                connection.request('GET','/readyz',headers={'Connection':'close'})
                response=connection.getresponse();raw=response.read(1025)
                need(response.status in (200,503) and len(raw)<=1024,'representative_mcp_readiness')
                if response.status==200:return
            except (OSError,http.client.HTTPException) as error:first=error
            finally:
                try:connection.close()
                except BaseException:
                    if first is None:raise
            time.sleep(min(.1,max(0,end-time.monotonic())))
        raise ValueError('representative_mcp_readiness_deadline')
    def initialize(self):
        self._ready()
        result=self._rpc({'jsonrpc':'2.0','id':1,'method':'initialize','params':{'protocolVersion':'2025-11-25',
            'capabilities':{},'clientInfo':{'name':'platform-representative-reader','version':'1'}}})
        need(result.get('protocolVersion')=='2025-11-25','representative_mcp_version')
        self._wire('mcp',8000,'/mcp',_INITIALIZED_REQUEST)
        result=self._rpc(_INVENTORY_REQUEST,inventory=_INVENTORY)
        need(set(result)<={'tools','nextCursor'} and result.get('nextCursor') in (None,'') and type(result.get('tools')) is list and 1<=len(result['tools'])<=128,'representative_mcp_inventory')
        names=[tool.get('name') for tool in result['tools'] if type(tool) is dict]
        need(len(names)==len(result['tools'])==len(set(names)) and 'signoz_execute_builder_query' in names,'representative_mcp_inventory')
        return {'initialized':True,'tools':len(names)}
    def observe(self,reads,request):
        import signoz_queries
        need(type(reads) is signoz_queries.RepresentativeReads and type(request) is signoz_queries.Request)
        # One immutable Request supplies both transports. MCP reserializes the same
        # object upstream; byte identity of the upstream POST is not asserted.
        payload=request.payload
        raw=self._wire('signoz-signoz-0',8080,'/api/v5/query_range',payload)
        http_value=reads.observe(request,200,raw)
        need(http_value.get('ok') is True or request._operation=='source_status' and http_value.get('reason') in ('unavailable','stale','future'),'representative_http_observation')
        result=self._rpc({'jsonrpc':'2.0','id':3,'method':'tools/call','params':{
            'name':'signoz_execute_builder_query','arguments':{'query':payload}}})
        need(set(result)<={'content','isError'} and 'content' in result,'representative_mcp_ambiguous')
        content=result['content'];need(type(content) is list and len(content)==1,'representative_mcp_notes')
        block=content[0];need(type(block) is dict and set(block)=={'type','text'} and block['type']=='text'
            and type(block['text']) is str,'representative_mcp_text')
        mcp_raw=block['text'].encode('utf-8');decode(mcp_raw)
        mcp_value=reads.observe(request,200,mcp_raw)
        need(mcp_value==http_value and decode(raw)['data']['data']==decode(mcp_raw)['data']['data'],'representative_transport_parity')
        return http_value

    def native_probes(self,release):
        """Separately labeled direct-ingester storage fixtures, NOT privacy proof.

        Unchanged Alloy intentionally drops this private service/metric/attribute
        vocabulary. SDK/privacy/source producers keep their owning Alloy path.
        """
        import representative_scope as scopes
        need(scopes._hex(release,40))
        now_ms=time.time_ns()//1000000
        def attr(key,value):return {'key':key,'value':{'stringValue':value}}
        metrics=[]
        for metric in ('inside_production_source_available','inside_production_source_observed_at_seconds'):
            points=[]
            for case in ('zero','latest','future'):
                for source in ('postgresql','caddy'):
                    stamps=[now_ms-1000,now_ms] if case=='latest' else [now_ms+60000] if case=='future' else [now_ms]
                    for index,stamp in enumerate(stamps):
                        value=(1 if case=='future' or case=='latest' and index==0 else 0) if metric.endswith('available') else stamp/1000
                        points.append({'timeUnixNano':str(stamp*1000000),'asDouble':value,
                            'attributes':[attr('source',source),attr('case',case)]})
            metrics.append({'name':metric,'gauge':{'dataPoints':points}})
        payload={'resourceMetrics':[{'resource':{'attributes':[attr('service.name','platform-task4b-native-probe'),
            attr('service.version',release),attr('service.instance.id','representative-native-probe')]},
            'scopeMetrics':[{'scope':{'name':'platform-task4b-native-probe','version':'1'},'metrics':metrics}]}]}
        remaining=self.__deadline-time.monotonic();need(remaining>0)
        connection=http.client.HTTPConnection('signoz-ingester',4318,timeout=min(5,remaining));first=None
        try:
            connection.request('POST','/v1/metrics',encoded(payload),{'Content-Type':'application/json','Connection':'close'})
            response=connection.getresponse();raw=response.read(16385)
            need(response.status==200 and len(raw)<=16384 and time.monotonic()<self.__deadline)
            value={} if not raw else decode(raw)
            need(type(value) is dict and set(value)<={'partialSuccess'} and value.get('partialSuccess',{})=={},'representative_probe_partial')
        except BaseException as error:first=error;raise
        finally:
            try:connection.close()
            except BaseException:
                if first is None:raise

    def stored(self,reads,value,observed):
        """Only source-fixed private recipes; no agent field or query selection."""
        import representative_stored as stored
        import signoz_queries as queries
        bundle={'metrics':[]}
        for signal,query in stored.recipes(value['start_ms'],value['cut_ms']).items():
            reads._current()
            payload=queries._metric.envelope(query,value['start_ms'],value['cut_ms'],'scalar')
            raw=self._wire('signoz-signoz-0',8080,'/api/v5/query_range',payload)
            rows=stored.raw_rows(raw,signal)
            result=self._rpc({'jsonrpc':'2.0','id':3,'method':'tools/call','params':{
                'name':'signoz_execute_builder_query','arguments':{'query':payload}}})
            need(set(result)<={'content','isError'} and type(result.get('content')) is list and len(result['content'])==1)
            block=result['content'][0];need(type(block) is dict and set(block)=={'type','text'} and block['type']=='text' and type(block['text']) is str)
            mcp_rows=stored.raw_rows(block['text'].encode(),signal)
            need(rows==mcp_rows,'representative_stored_transport_parity');reads._current()
            if signal in stored.METRIC_PARTITIONS:
                bundle['metrics'].extend(rows);need(len(bundle['metrics'])<=1000,'representative_stored_physical_row_cap')
            else:bundle[signal]=rows
        verdict=stored.validate_bundle(bundle,observed=observed,release=value['binding']['source']['commit'],
            start=value['start_ms'],cut=value['cut_ms'])
        for case,query in stored.probe_queries(reads).items():
            reads._current()
            payload=queries._metric.envelope(query,value['start_ms'],value['cut_ms'],'scalar')
            raw=self._wire('signoz-signoz-0',8080,'/api/v5/query_range',payload)
            rows=queries.rows(200,raw,queries.SOURCE_COLUMNS)
            result=self._rpc({'jsonrpc':'2.0','id':3,'method':'tools/call','params':{'name':'signoz_execute_builder_query','arguments':{'query':payload}}})
            need(set(result)<={'content','isError'} and type(result.get('content')) is list and len(result['content'])==1)
            block=result['content'][0];need(type(block) is dict and set(block)=={'type','text'} and block['type']=='text' and type(block['text']) is str)
            need(rows==queries.rows(200,block['text'].encode(),queries.SOURCE_COLUMNS),'representative_probe_parity')
            stored.probe_observation(reads,case,rows);reads._current()
        return verdict


class _Rendezvous:
    """Private inode/birth-bound one-request file channel, never a control listener."""
    @classmethod
    def create(cls,path,session):
        import os
        import representative_scope as scopes
        now=time.monotonic_ns()
        need(type(session) is dict and set(session)=={'nonce','deadline_mono_ns'} and scopes._hex(session['nonce'],32)
            and type(session['deadline_mono_ns']) is int and now<session['deadline_mono_ns']<=now+600*10**9)
        from pathlib import Path
        import stat
        if path==Path('/tmp/representative-reader'):
            parent=path.parent.lstat();need(path.parent==path.parent.resolve() and stat.S_ISDIR(parent.st_mode)
                and parent.st_uid==0 and stat.S_IMODE(parent.st_mode)==0o1777,'representative_native_tmp')
        else:scopes._directory(path.parent)
        path.mkdir(mode=0o700)
        value={'schema':1,'session':session,'pid':os.getpid(),'birth':scopes._process_receipt(os.getpid()),'directory':scopes._directory(path)}
        scopes._write(path/'resident.json',scopes._encoded(value))
        return cls.attach(path,value)
    @classmethod
    def attach(cls,path,expected):
        import representative_scope as scopes
        need(type(expected) is dict and set(expected)=={'schema','session','pid','birth','directory'} and type(expected['schema']) is int and expected['schema']==1)
        need(type(expected['pid']) is int and expected['pid']>1)
        need(type(expected['session']) is dict and set(expected['session'])=={'nonce','deadline_mono_ns'}
            and scopes._hex(expected['session']['nonce'],32) and type(expected['session']['deadline_mono_ns']) is int)
        instance=cls();instance.path=path;instance.binding=expected;instance.last=0;instance.request=None;instance.ack=None
        raw,instance.resident=scopes._read(path/'resident.json',private=True)
        need(scopes._encoded(expected)==raw)
        instance.check();return instance
    def check(self):
        import representative_scope as scopes
        need(time.monotonic_ns()<self.binding['session']['deadline_mono_ns'],'representative_session_deadline')
        need(scopes._directory(self.path)==self.binding['directory'])
        raw,identity=scopes._read(self.path/'resident.json',private=True)
        need(identity==self.resident and raw==scopes._encoded(self.binding),'representative_session_replaced')
        need(scopes._process_receipt(self.binding['pid'])==self.binding['birth'],'representative_resident_birth')
        need({p.name for p in self.path.iterdir()}<={'resident.json','request.json','ack.json'},'representative_channel_closure')
    def submit(self,generation,digest):
        import representative_scope as scopes
        self.check();need(self.request is None)
        need(type(generation) is int and 0<generation<2**53 and scopes._hex(digest,64))
        value={'generation':generation,'digest':digest,'nonce':self.binding['session']['nonce']}
        self.request=(scopes._write(self.path/'request.json',scopes._encoded(value)),value)
    def accept(self,generation,digest):
        import representative_scope as scopes
        self.check();need(type(generation) is int and self.last<generation<2**53 and scopes._hex(digest,64),'representative_channel_replay')
        self.last=generation
    def pending(self):
        import representative_scope as scopes
        self.check()
        if not (self.path/'request.json').exists():return None
        raw,identity=scopes._read(self.path/'request.json',private=True)
        value=decode(raw);need(type(value) is dict and set(value)=={'generation','digest','nonce'} and value['nonce']==self.binding['session']['nonce'])
        self.accept(value['generation'],value['digest']);self.request=(identity,value)
        return value['generation'],value['digest']
    def acknowledge(self,generation,digest,result):
        import representative_scope as scopes
        import representative_agent as agent
        self.check();need(self.request is not None and self.last==generation and self.request[1]['generation']==generation and self.request[1]['digest']==digest)
        raw,identity=scopes._read(self.path/'request.json',private=True)
        need((identity,decode(raw))==self.request)
        agent._finite(result)
        value=self.request[1]|{'result':result}
        self.ack=(scopes._write(self.path/'ack.json',scopes._encoded(value)),value)
    def result(self,generation,digest):
        import representative_scope as scopes
        self.check();need(self.request is not None)
        raw,identity=scopes._read(self.path/'request.json',private=True)
        need((identity,decode(raw))==self.request)
        if not (self.path/'ack.json').exists():return None
        raw,identity=scopes._read(self.path/'ack.json',private=True)
        value=decode(raw);need(type(value) is dict and set(value)=={'generation','digest','nonce','result'}
            and value['generation']==generation and type(value['generation']) is int and value['digest']==digest
            and value['nonce']==self.binding['session']['nonce'])
        import representative_agent as agent
        agent._finite(value['result']);self.ack=(identity,value);return value['result']
    def finish(self):
        import representative_scope as scopes
        self.check()
        for name,receipt in (('request.json',self.request),('ack.json',self.ack)):
            if receipt is not None:
                raw,identity=scopes._read(self.path/name,private=True)
                need((identity,decode(raw))==receipt,'representative_channel_replaced');(self.path/name).unlink()
        self.request=None;self.ack=None
    def close(self):
        self.check();need({p.name for p in self.path.iterdir()}=={'resident.json'})
        (self.path/'resident.json').unlink();self.path.rmdir()


def _load_scopes():
    import importlib.util
    from pathlib import Path
    import sys
    path=Path(__file__).resolve().with_name('representative_scope.py')
    if 'representative_scope' in sys.modules:
        module=sys.modules['representative_scope'];need(Path(module.__file__).resolve()==path)
    else:
        spec=importlib.util.spec_from_file_location('representative_scope',path)
        module=importlib.util.module_from_spec(spec);sys.modules['representative_scope']=module;spec.loader.exec_module(module)
    return module


def _load_agent(expected):
    """Load one literal module only after the owning scope attests its closure."""
    import importlib.util
    import sys
    scopes=_load_scopes();mirror=scopes._mirror(scopes._DRIVER)
    need({name:item[0] for name,item in mirror.items()}==expected,'representative_scope_mirror')
    name='representative_agent';relative='scripts/observability-fullstack/representative_agent.py'
    path=scopes._DRIVER/relative
    raw,identity=scopes._read(path,private=True,maximum=1048576)
    need([scopes._sha(raw),identity]==mirror[relative],'representative_agent_source')
    existing=sys.modules.get(name)
    need(existing is None or Path(existing.__file__).resolve()==path,'representative_agent_import')
    if existing is None:
        spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec)
        sys.modules[name]=module
        try:exec(compile(raw,str(path),'exec'),module.__dict__)
        except BaseException:sys.modules.pop(name,None);raise
    need(scopes._mirror(scopes._DRIVER)==mirror,'representative_scope_mirror')


def _serve_corpus(channel,native,session,session_identity):
    """The SAME thread loads/prepares/observes its opaque scope for every read."""
    from pathlib import Path
    import representative_agent as agent
    import representative_scope as scopes
    import signoz_queries as queries
    need(agent.OPERATIONS==queries.OPERATIONS,'representative_operation_catalogue')
    scope=None;reads=None;generation=None;digest=None;observations={};first=None;sdk=None
    def read(operation):
        nonlocal scope,reads,generation,digest,first,sdk
        try:
            channel.check()
            if scope is None:
                # First actual agent request causes acquisition of the current
                # trusted digest. No response is prepared or cached in advance.
                while time.monotonic_ns()<session['deadline_mono_ns']:
                    pending=channel.pending()
                    if pending is not None:break
                    time.sleep(.01)
                else:raise ValueError('representative_session_deadline')
                generation,digest=pending;scope=scopes.load_current(digest)
                reads=queries.RepresentativeReads.from_native_scope(scope)
                value=scopes._check_reader(scope)
                need(value['generation']==generation and value['binding']==session['binding'])
            need(operation not in observations,'representative_operation_replay')
            scopes._check_reader(scope)
            request=reads.prepare(operation,{})
            # Each HTTP and MCP wire deadline is additionally bounded by the
            # original read scope, not the resident's longer control clock.
            bounded=NativeReads(native._NativeReads__key,min(session['deadline_mono_ns'],scopes._check_reader(scope)['deadline_mono_ns'])/10**9)
            observation=bounded.observe(reads,request)
            if operation=='web_current':sdk=bounded.stored(reads,scopes._check_reader(scope),session['sdk'])
            scopes._check_reader(scope);channel.check();observations[operation]=observation
            return observation
        except BaseException:
            if first is None:
                import sys
                first=sys.exc_info()
            raise
    with agent.server(session['agent_key'],read,_GATEWAY) as server:
        while time.monotonic_ns()<session['deadline_mono_ns'] and (len(observations)<10 or server.denials<4) and first is None:
            server.handle_request()
            if scope is not None:scopes._check_reader(scope)
        if first is not None:raise first[1].with_traceback(first[2])
        need(set(observations)==set(agent.OPERATIONS) and server.denials==4,'representative_corpus_deadline')
        need(all(v.get('ok') is True for v in observations.values()),'representative_actual_source_unavailable')
        scopes._check_reader(scope);channel.check()
        need(scopes._read(_SESSION,private=True,maximum=65536)==(scopes._encoded(session),session_identity),'representative_session_changed')
        read_end=scopes._check_reader(scope)['deadline_mono_ns']
        channel.acknowledge(generation,digest,{'reads':10})
        # Keep the socket alive for the finite protocol negatives, then wait for
        # the digest exec to attest and unlink its exact request/ack generation.
        while time.monotonic_ns()<read_end:
            if not (channel.path/'request.json').exists():break
            server.handle_request()
        else:raise ValueError('representative_scope_deadline')
    return {'reads':10,'sdk':sdk}


def read_current(digest):
    from pathlib import Path
    scopes=_load_scopes();scope=scopes.load_current(digest);value=scopes._consume(scope)
    # Mirror/import closure has now passed; no ambient application imports before it.
    _load_agent(value['mirror'])
    raw,_=scopes._read(Path('/tmp/representative-reader/resident.json'),private=True)
    binding=decode(raw);need(binding['session']['nonce']==value['binding']['nonce'])
    channel=_Rendezvous.attach(Path('/tmp/representative-reader'),binding)
    channel.submit(value['generation'],digest)
    first=None
    try:
        while time.monotonic_ns()<value['deadline_mono_ns']:
            scopes._check_reader(scope)
            result=channel.result(value['generation'],digest)
            if result is not None:
                need(result=={'reads':10} and type(result['reads']) is int)
                scopes._check_reader(scope);channel.finish()
                return {'read_verified':True,'generation':value['generation'],'digest':digest,'reads':10}
            time.sleep(.01)
        raise ValueError('representative_scope_deadline')
    except BaseException as error:first=error;raise
    finally:
        if channel.request is not None:
            try:channel.finish()
            except BaseException:
                if first is None:raise


def resident():
    """Literal no-argv control process; unchanged bootstrap owns viewer lifecycle."""
    import importlib.util
    import os
    from pathlib import Path
    import sys
    scopes=_load_scopes();need(sys.platform=='linux','representative_native_linux_required')
    private=Path('/private');scopes._directory(private)
    raw,identity=scopes._read(_SESSION,private=True,maximum=65536)
    session=decode(raw)
    need(type(session) is dict and set(session)=={'schema','binding','native','deadline_mono_ns','mirror','agent_key','sdk'}
        and type(session['schema']) is int and session['schema']==1)
    now=time.monotonic_ns()
    need(type(session['deadline_mono_ns']) is int and now<session['deadline_mono_ns']<=now+600*10**9)
    mirror=scopes._mirror(scopes._DRIVER);need({name:item[0] for name,item in mirror.items()}==session['mirror'])
    need(scopes._process_receipt(1)=={k:session['native'][k] for k in ('start_ticks','netns','pidns')})
    # Every import is literal and file-attested; no module/path/plugin selection.
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    path=scopes._DRIVER/'control.py'
    existing=sys.modules.get('control')
    need(existing is None or Path(existing.__file__).resolve()==path)
    spec=importlib.util.spec_from_file_location('control',path);control=importlib.util.module_from_spec(spec);sys.modules['control']=control;spec.loader.exec_module(control)
    control.DEADLINE=session['deadline_mono_ns']/10**9
    channel=None;first=None;corpus={}
    def exercise(_proxy,key):
        nonlocal channel
        native=NativeReads(key,control.DEADLINE);native.initialize();native.native_probes(session['binding']['source']['commit'])
        channel=_Rendezvous.create(Path('/tmp/representative-reader'),{'nonce':session['binding']['nonce'],'deadline_mono_ns':session['deadline_mono_ns']})
        corpus.update(_serve_corpus(channel,native,session,identity))
        need(scopes._read(_SESSION,private=True,maximum=65536)==(raw,identity))
        need(scopes._mirror(scopes._DRIVER)==mirror)
    control.FUNCTIONAL_HOOK=exercise
    try:
        result=control.bootstrap()
        return {'bootstrap':True,'viewer_admin_denied':result['admin_read_denied']==1,'viewer_revoked_denied':result['revoke_denied']==1,'reads':10,'sdk':corpus['sdk']}
    except BaseException as error:first=error;raise
    finally:
        control.FUNCTIONAL_HOOK=None
        if channel is not None:
            try:channel.close()
            except BaseException:
                if first is None:raise


if __name__=='__main__':
    import sys
    try:
        if len(sys.argv)==1:value=resident()
        else:need(len(sys.argv)==2);value=read_current(sys.argv[1])
        print(encoded(value).decode())
    except BaseException:
        # Native credentials/telemetry/exception text never cross stdout/stderr.
        print('{"representative_reader_failed":true}');sys.exit(1)
