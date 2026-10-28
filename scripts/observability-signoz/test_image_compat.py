"""The actual checked-image admission against a CLI without inspect --platform."""
import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import lifecycle
from test_lifecycle import benign_engine

UNSUPPORTED_PLATFORM=(b"unknown flag: --platform\n\nUsage:  docker image inspect [OPTIONS] IMAGE [IMAGE...]\n\n"
                      b"Run 'docker image inspect --help' for more information\n")


class ImageCompatibility(unittest.TestCase):
    def setUp(self):
        self.lock=lifecycle.verify_packet()
        self.row=next(r for r in self.lock['images'] if r['repository']=='docker.io/library/python')
        metadata=self.lock['image_config_metadata'][self.row['repository']]['amd64']
        self.image={'Os':'linux','Architecture':'amd64','Id':metadata['config_digest'],
            'Descriptor':{'mediaType':'application/vnd.oci.image.manifest.v1+json','digest':self.row['linux_amd64_manifest'],
                          'size':1000,'platform':{'os':'linux','architecture':'amd64'}},
            'Config':{native:metadata[key] for native,key in [('Entrypoint','entrypoint'),('Cmd','cmd'),('WorkingDir','working_dir'),('User','user')]},
            'RepoDigests':[self.row['pinned']]}

    def inspect(self,image):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp).resolve();directory=root/'engine';directory.mkdir(mode=0o700)
            script=root/'native'
            script.write_text('#!'+sys.executable+'\nimport sys\nif "--platform" in sys.argv:\n sys.stderr.buffer.write('+repr(UNSUPPORTED_PLATFORM)+');sys.exit(125)\nprint('+repr(json.dumps([image]))+')\n')
            script.chmod(0o700);engine=benign_engine(directory);engine.invocation=script;engine.cli=script
            native=script.lstat();engine.invocation_identity=(native.st_dev,native.st_ino,native.st_mode,str(script))
            engine.anon=root/'anon';engine.endpoint='unix:///private/daemon.sock';engine.identity={}
            with patch.object(engine,'identify',return_value={}):return lifecycle.checked_image(engine,self.row,'amd64')

    def test_plain_inspect_keeps_exact_pinned_selected_image_admission(self):
        admitted=self.inspect(self.image)
        self.assertEqual(admitted['architecture'],'amd64')
        self.assertEqual(admitted['child_manifest'],self.row['linux_amd64_manifest'])
        self.assertEqual(admitted['reference'],self.row['pinned'])
        self.assertEqual(admitted['selected_image_id'],self.image['Id'])

    def test_full_public_signature_matches_original_capture_and_is_finitely_classified(self):
        self.assertEqual(len(UNSUPPORTED_PLATFORM),138)
        self.assertEqual(hashlib.sha256(UNSUPPORTED_PLATFORM).hexdigest(),'516a44de03fb57fe3ea32e666823006a85e577675a6cb536fc9354446f62d44b')
        self.assertEqual(lifecycle.stderr_category(UNSUPPORTED_PLATFORM),'unknown_platform_flag')
        self.assertEqual(lifecycle.stderr_category(UNSUPPORTED_PLATFORM+b'private-key'),'unclassified')

    def test_missing_or_wrong_architecture_child_config_and_attachment_still_refuse(self):
        cases=[]
        for field,value,reason in [('Architecture','arm64','image_platform'),('Descriptor',None,'selected_image_descriptor'),
                                   ('Id','sha256:'+'f'*64,'selected_image_identity'),('RepoDigests',[],'image_index_identity')]:
            cases.append(({**self.image,field:value},reason))
        wrong=copy.deepcopy(self.image);wrong['Descriptor']['digest']='sha256:'+'f'*64;cases.append((wrong,'selected_image_child'))
        wrong=copy.deepcopy(self.image);wrong['Descriptor']['platform']['architecture']='arm64';cases.append((wrong,'selected_image_platform'))
        wrong=copy.deepcopy(self.image);wrong['Config']['Cmd']=['foreign'];cases.append((wrong,'image_configuration_identity'))
        for image,reason in cases:
            with self.subTest(reason=reason),self.assertRaisesRegex(lifecycle.Refusal,'^'+reason+'$'):self.inspect(image)


if __name__=='__main__':unittest.main()
