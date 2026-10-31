"""Finite Docker CLI double for the real contact child adapter contract. No daemon calls."""
import json
import os
from pathlib import Path
import sys

output=Path(os.environ['CONTACT_TEST_OUTPUT']);args=sys.argv[1:]
identity=json.loads((output/'owner.json').read_text())['daemon']
if args[:2]==['context','show']:print(identity['context'])
elif args[:2]==['context','inspect']:print(identity['endpoint'])
elif 'info' in args:print(json.dumps({'ID':identity['daemon_id'],'DockerRootDir':identity['storage']}))
elif 'telegram-establish' in args:
    with (output/'protocol').open('a') as stream:stream.write('admit '+args[-1]+'\n')
    print('{"accepted":64}')
elif 'psql' in args:
    query=sys.stdin.read()
    if 'bot_contacts' in query:
        with (output/'protocol').open('a') as stream:stream.write('cardinality\n')
        print(os.environ.get('CONTACT_TEST_COUNT','256'))
    else:
        count=256 if '>= 1000000' in query and '< 1000256' in query else 64
        with (output/'protocol').open('a') as stream:stream.write('durable '+str(count)+'\n')
        print(json.dumps({'accepted':count,'processed':count,'failed':0,'planned':count,'delivered':count}))
else:raise SystemExit(31)
