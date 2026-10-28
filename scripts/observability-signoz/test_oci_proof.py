"""Tampered public metadata must never establish image identity, even with valid JSON."""
import copy
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import unittest

import image_proof
import lifecycle


def packet(root):
    shutil.copytree(lifecycle.CONFIG/'oci',root)
    return copy.deepcopy(lifecycle.verify_packet())


def rechain(root,lock,*,config_change=None,child_change=None,index_change=None):
    """Change a synthetic trust root coherently so semantic checks, not hash mismatch, decide."""
    row=next(r for r in lock['images'] if r['repository']=='docker.io/library/python')
    metadata=lock['image_config_metadata'][row['repository']]['amd64']
    def load(d):return json.loads((root/(d.split(':')[1]+'.json')).read_bytes())
    def store(value,old):
        raw=json.dumps(value,separators=(',',':')).encode();d='sha256:'+hashlib.sha256(raw).hexdigest()
        if d!=old:(root/(old.split(':')[1]+'.json')).unlink()
        (root/(d.split(':')[1]+'.json')).write_bytes(raw)
        return d,len(raw)
    index=load(row['index_digest']);child=load(row['linux_amd64_manifest']);config=load(metadata['config_digest'])
    if config_change:config_change(config)
    config_digest,config_size=store(config,metadata['config_digest']);metadata['config_digest']=config_digest
    child['config'].update(digest=config_digest,size=config_size)
    if child_change:child_change(child)
    old_child=row['linux_amd64_manifest'];child_digest,child_size=store(child,old_child);row['linux_amd64_manifest']=child_digest
    selected=next(d for d in index['manifests'] if d['digest']==old_child);selected.update(digest=child_digest,size=child_size)
    if index_change:index_change(index,selected)
    index_digest,_=store(index,row['index_digest']);row['index_digest']=index_digest;row['pinned']=row['repository']+'@'+index_digest


class OCIProof(unittest.TestCase):
    def test_all_seven_original_pins_have_exact_immutable_complete_local_proofs(self):
        lock=lifecycle.verify_packet();proofs=image_proof.load(lifecycle.CONFIG/'oci',lock)
        self.assertEqual(set(proofs),{r['pinned'] for r in lock['images']})
        self.assertEqual(len(list((lifecycle.CONFIG/'oci').iterdir())),21)
        for row in lock['images']:
            proof=proofs[row['pinned']]
            self.assertEqual(proof.runtime_reference,row['repository']+'@'+row['linux_amd64_manifest'])
            self.assertEqual(proof.config_digest,lock['image_config_metadata'][row['repository']]['amd64']['config_digest'])

    def test_any_raw_byte_mutation_missing_extra_symlink_hardlink_and_size_refuse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'oci';lock=packet(root)
            for file in sorted(root.iterdir()):
                original=file.read_bytes();file.write_bytes(original+b' ')
                with self.subTest(document=file.name),self.assertRaises(image_proof.ProofError):image_proof.load(root,lock)
                file.write_bytes(original)
            first=next(root.iterdir());original=first.read_bytes();first.unlink()
            with self.assertRaises(image_proof.ProofError):image_proof.load(root,lock)
            foreign=Path(tmp)/'foreign';foreign.write_bytes(original);first.symlink_to(foreign)
            with self.assertRaises(image_proof.ProofError):image_proof.load(root,lock)
            first.unlink();first.hardlink_to(foreign)
            with self.assertRaises(image_proof.ProofError):image_proof.load(root,lock)
            first.unlink();first.write_bytes(b' '*(image_proof.MAX_DOCUMENT_BYTES+1))
            with self.assertRaises(image_proof.ProofError):image_proof.load(root,lock)
            first.write_bytes(original);(root/'extra.json').write_text('{}')
            with self.assertRaises(image_proof.ProofError):image_proof.load(root,lock)

    def test_duplicate_nonfinite_deep_wide_and_oversized_json_refuse(self):
        bad=['{"x":1,"x":2}','{"x":NaN}','{"x":1e999}','['*18+'0'+']'*18,
             json.dumps(list(range(2049))),json.dumps('x'*65537),' '*(image_proof.MAX_DOCUMENT_BYTES+1)]
        for index,raw in enumerate(bad):
            with self.subTest(index=index),self.assertRaises(image_proof.ProofError):image_proof.decode(raw)

    def test_coherently_rehashed_but_invalid_chain_platform_config_and_layer_shapes_refuse(self):
        cases=[{'index_change':lambda i,d:i['manifests'].append(copy.deepcopy(d))},
               {'index_change':lambda i,d:d['platform'].update(architecture='arm64')},
               {'index_change':lambda i,d:d['platform'].update(variant='v3')},
               {'index_change':lambda i,d:d.update(size=d['size']+1)},
               {'index_change':lambda i,d:d.update(mediaType='application/vnd.oci.image.index.v1+json')},
               {'child_change':lambda c:c['config'].update(size=c['config']['size']+1)},
               {'child_change':lambda c:c['config'].update(digest='sha256:'+'f'*64)},
               {'child_change':lambda c:c.update(layers=[])},
               {'child_change':lambda c:c['layers'][0].update(size=True)},
               {'child_change':lambda c:c['layers'][0].update(mediaType='unknown')},
               {'config_change':lambda c:c.update(os='windows')},
               {'config_change':lambda c:c.update(architecture='arm64')},
               {'config_change':lambda c:c['rootfs'].update(type='foreign')},
               {'config_change':lambda c:c['rootfs'].update(diff_ids=[])},
               {'config_change':lambda c:c['config'].update(Cmd=['foreign'])},
               {'config_change':lambda c:c['config'].update(Volumes={'/foreign':{}})}]
        for index,change in enumerate(cases):
            with self.subTest(index=index),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp)/'oci';lock=packet(root);rechain(root,lock,**change)
                with self.assertRaises(image_proof.ProofError):image_proof.load(root,lock)


if __name__=='__main__':unittest.main()
