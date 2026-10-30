"""Full-stack exact-source images through the existing owned image-preparation lifecycle."""
import argparse
import json
import os
import signal
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'observability-resource'))
import hosted
import preparation
import binding
from storage_policy import FULLSTACK_IMAGE_PREPARATION_GROWTH_BYTES,FLOOR_BYTES,CLEANUP_HEADROOM_BYTES
import disk_feedback
import preparation_evidence


def preparation_budget(platform, free):
    if platform!='linux' or free < FLOOR_BYTES+FULLSTACK_IMAGE_PREPARATION_GROWTH_BYTES+CLEANUP_HEADROOM_BYTES:
        raise ValueError('fullstack_preparation_disk_admission')
    return FULLSTACK_IMAGE_PREPARATION_GROWTH_BYTES


def signoz_preloads():
    import core_layout
    lifecycle=core_layout.signoz_lifecycle()
    lock=lifecycle.verify_packet(lifecycle.MCP512_PROFILE)
    proofs=lifecycle.image_proof.load(lifecycle.CONFIG/'oci',lock)
    return tuple(proofs[row['pinned']].runtime_reference for row in lock['images'])


def preload_inventory(*, representative=False):
    pins=json.loads((binding.ROOT/'infra/observability/pilot/inputs.lock.json').read_text())['images']
    pins.update(json.loads((binding.ROOT/'infra/observability/umami/inputs.lock.json').read_text())['images'])
    pins.pop('postgres',None)
    pins['rabbitmq']='ghcr.io/sachkov-inside/rabbitmq:4.2.4-alpine@sha256:83522278ca69414e4895b3ea3c0f943c63ad316c063f9cda9c32fd42fe800f47'
    return tuple(sorted(set(pins.values()) | (set(signoz_preloads()) if representative else set())))


def prepare(metadata, images, consumer):
    return _prepare(metadata,images,consumer,representative=False)


def prepare_representative(metadata, images, consumer):
    """Private combined preparation, same owner and one original 16GiB baseline."""
    return _prepare(metadata,images,consumer,representative=True)


def _prepare(metadata, images, consumer, *, representative):
    source,disk=hosted.metadata_source(metadata)
    if not disk['ready'] or images.exists():raise ValueError('fresh_admitted_fullstack_required')
    identity=hosted.runtime.pilot.daemon.identify(hosted.runtime.ci.read_command)
    pilot=hosted.runtime.pilot
    pilot.FROZEN_DOCKER_ENDPOINT=identity['endpoint'];pilot.FROZEN_DOCKER_IDENTITY=identity
    owner='inside-platform-production-smoke-cache-'+source['run_id']+'-'+source['run_attempt']+'-full'
    pins=preload_inventory(representative=representative)
    growth=preparation_budget(sys.platform,pilot.shutil.disk_usage(identity['storage']).free)
    record=disk_feedback.Record(source['checkout_sha'])
    evidence=preparation_evidence.Record(metadata,source['checkout_sha'],record)
    try:
        with preparation.acquire(images,source['checkout_sha'],owner,identity,consumer,web=True,applications=True) as stage:
            record.attempt()
            with pilot.disk_budget(Path(identity['storage']),growth_bytes=growth,observe_samples=True) as samples:
                record.entered(samples)
                for role,dockerfile,target,context,seconds in (
                        ('backend','apps/backend/Dockerfile','backend-production','.',600),
                        ('foundation','infra/production/database/Dockerfile',None,'infra/production/database',180),
                        ('web','apps/web/Dockerfile','web-production','.',600),
                        ('telegram','apps/telegram/infra/production/Dockerfile',None,'.',600),
                        ('logto','infra/identity/logto/Dockerfile',None,'infra/identity/logto',600)):
                    evidence.mark('build_'+role)
                    args=['docker','build','--file',dockerfile,'--label',preparation.LABEL+'='+stage.receipt['token'],
                        '--iidfile',str(stage.iidfile(role)),'--tag',stage.receipt['tags'][('backend','foundation','web','telegram','logto').index(role)]]
                    if role=='telegram':args+=['--build-arg','SOURCE_COMMIT='+source['checkout_sha'],'--build-arg','RELEASE_VERSION=v1']
                    if target:args+=['--target',target,'--build-arg','INSIDE_RELEASE_VERSION=v1','--build-arg','INSIDE_SOURCE_SHA='+source['checkout_sha']]
                    hosted.command(args+[context],seconds,pass_fds=stage.pass_fds());stage.capture()
                    evidence.completed()
                    if role=='backend':record.after_backend_build()
                record.first_pull()
                for index,image in enumerate(pins):
                    evidence.mark('preload_'+str(index))
                    hosted.command(['docker','pull',*(['--platform','linux/amd64'] if representative and image in signoz_preloads() else []),image],90,pass_fds=stage.pass_fds())
                    evidence.completed()
                evidence.mark('manifest')
                value={'schema':3,'source':source['checkout_sha'],'owner':owner}
                for role in ('backend','foundation','web','telegram','logto'):value[role]=stage.iidfile(role).read_text().strip()
                with os.fdopen(os.open(images,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),'w') as stream:json.dump(value,stream)
                evidence.completed()
            record.require()
    finally:evidence.persist()


if __name__=='__main__':
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata',type=Path,required=True);parser.add_argument('--images',type=Path,required=True)
    parser.add_argument('--consumer',required=True);args=parser.parse_args()
    prepare(args.metadata,args.images,args.consumer)
