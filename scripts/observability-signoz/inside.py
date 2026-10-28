"""Owned in-container helper; literal endpoints only, no Docker socket or raw agent query."""
import json
import os
import sys
import time

STEP='entry'


def require(ok):
    if not ok:raise RuntimeError('closed functional control failed')


def disk():
    fs=os.statvfs('/disk');st=os.stat('/disk')
    print(json.dumps({'fsid':fs.f_fsid,'device':st.st_dev,'block':fs.f_frsize,
        'blocks':fs.f_blocks,'available':fs.f_bavail,'files':fs.f_files,'free_files':fs.f_favail}))


def ready(name):
    import http.client
    hosts={'postgres':('signoz-metastore-postgres-0',5432,None),
        'clickhouse':('signoz-telemetrystore-clickhouse-0-0',8123,'/ping'),
        'collector':('signoz-ingester',13133,'/'),
        'server':('signoz-signoz-0',8080,'/api/v1/health')}
    require(name in hosts);host,port,path=hosts[name];end=time.monotonic()+55
    while time.monotonic()<end:
        conn=None
        try:
            if path is None:
                # PostgreSQL native SSLRequest response proves receiver startup, not migrations.
                import socket
                with socket.create_connection((host,port),timeout=1) as sock:
                    sock.sendall(bytes.fromhex('0000000804d2162f'))
                    if sock.recv(1) in (b'N',b'S'):return
            else:
                conn=http.client.HTTPConnection(host,port,timeout=1)
                conn.request('GET',path);response=conn.getresponse();body=response.read(65537)
                if response.status==200 and len(body)<=65536:return
        except (OSError,http.client.HTTPException):pass
        finally:
            if conn:conn.close()
        time.sleep(.25)
    raise RuntimeError('native readiness deadline')


def histogram():
    import hashlib
    import io
    from pathlib import Path
    import tarfile
    payload=Path('/private/histogram.tar.gz').read_bytes()
    require(len(payload)<=16*1024**2 and hashlib.sha256(payload).hexdigest()=='33997073eb6d82b7be4f27f9fc8ec9e28a395e0f20674d5d54bb2fa28a75488d')
    with tarfile.open(fileobj=io.BytesIO(payload),mode='r:gz') as archive:
        members=archive.getmembers();require(len(members)<=16)
        selected=[m for m in members if m.name=='histogram-quantile']
        require(len(selected)==1 and selected[0].isfile() and 0<selected[0].size<=32*1024**2)
        binary=archive.extractfile(selected[0]).read(32*1024**2+1)
        require(len(binary)==selected[0].size and binary.startswith(b'\x7fELF'))
        dest=Path('/histogram/histogramQuantile')
        fd=os.open(dest,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o700)
        with os.fdopen(fd,'wb') as output:output.write(binary)


def functional():
    import functional_witness
    functional_witness.run()


if __name__=='__main__':
    try:
        mode=sys.argv[1]
        if mode=='serve':
            while True:time.sleep(60)
        elif mode=='disk':disk()
        elif mode=='histogram':histogram()
        elif mode=='ready':ready(sys.argv[2]);print('{"ready":1}')
        elif mode=='functional':functional()
        else:raise RuntimeError('unknown internal operation')
    except BaseException as error:
        # Runtime diagnostics never echo native HTTP/query bodies, keys or exception strings.
        native=sys.modules.get('control')
        print(json.dumps({'inside_failed':1,'stage':getattr(native,'FUNCTIONAL_STAGE',STEP),'category':type(error).__name__,
            'http_status':getattr(native,'LAST_HTTP_STATUS',0),'transport':getattr(native,'STEP','none')}))
        sys.exit(1)
