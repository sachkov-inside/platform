"""The existing digest-pinned VM MCP asset, materialized only in the private owned directory."""
from contextlib import contextmanager
import io
import json
import os
from pathlib import Path
import platform
import tarfile
import artifact
import pilot

NAME='mcp-victoriametrics'
UNPACKED_BYTES=pilot.PLUGIN_UNPACKED_BUDGET_BYTES


@contextmanager
def unpack(output,raw):
    if type(raw) is not bytes or len(raw)>pilot.COMPRESSED_ASSET_MEMORY_BUDGET_BYTES:artifact.refuse()
    with artifact.directory(output) as directory_fd:
        created=False;identity=None
        try:
            with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz') as archive:
                selected=None;total=0
                for count,entry in enumerate(archive,1):
                    total+=entry.size
                    if count>64 or entry.size<0 or total>UNPACKED_BYTES:artifact.refuse()
                    if Path(entry.name).name==NAME:
                        if selected is not None or not entry.isfile():artifact.refuse()
                        selected=entry
                if selected is None:artifact.refuse()
                try:descriptor=os.open(NAME,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o700,dir_fd=directory_fd)
                except OSError:artifact.refuse()
                created=True;info=os.fstat(descriptor);identity=(info.st_dev,info.st_ino)
                with os.fdopen(descriptor,'wb') as target,archive.extractfile(selected) as source:
                    copied=0
                    while True:
                        chunk=source.read(65536)
                        if not chunk:break
                        copied+=len(chunk)
                        if copied>selected.size or copied>UNPACKED_BYTES:artifact.refuse()
                        target.write(chunk)
                    if copied!=selected.size:artifact.refuse()
            yield output/NAME
        finally:
            if created:
                current=os.stat(NAME,dir_fd=directory_fd,follow_symlinks=False)
                if (current.st_dev,current.st_ino)!=identity:artifact.refuse()
                os.unlink(NAME,dir_fd=directory_fd)


@contextmanager
def executable(output):
    if platform.system()!='Linux' or platform.machine() not in ('x86_64','aarch64','arm64'):artifact.refuse()
    architecture='arm64' if platform.machine() in ('aarch64','arm64') else 'x86_64'
    lock=json.loads((pilot.CONFIG/'inputs.lock.json').read_text())
    assets=lock['artifacts'][NAME]['assets']
    matches=[asset for asset in assets if asset['name']==NAME+'_Linux_'+architecture+'.tar.gz']
    if len(matches)!=1:artifact.refuse()
    with unpack(output,pilot.downloaded_asset(matches[0])) as path:yield path
