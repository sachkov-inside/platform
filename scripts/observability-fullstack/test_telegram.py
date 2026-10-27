"""Telegram acceptance requires processed durable rows, not HTTP acknowledgement alone."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import telegram


class Telegram(unittest.TestCase):
    def test_seed_waits_for_each_bounded_delivery_batch_before_admitting_the_next(self):
        events=[]
        def invoke(compose,args,**options):
            events.append(('admit',int(args[-1])))
            return '{"accepted":64}'
        def sql(compose,query,**options):
            events.append(('ledger',None))
            count=256 if '1000256' in query and '>= 1000000' in query else 64
            return json.dumps({'accepted':count,'processed':count,'failed':0,'planned':count,'delivered':count})
        def wait(read,predicate,**options):
            self.assertEqual(options['budget'],30)
            self.assertTrue(predicate(read()))
        telegram.establish([],invoke,wait,sql,256)
        self.assertEqual(events,[item for start in (0,64,128,192) for item in (('admit',start),('ledger',None))]+[('ledger',None)])
        # A partial durable delivery cannot admit another batch.
        events.clear()
        def incomplete(compose,query,**options):
            return json.dumps({'accepted':64,'processed':64,'failed':0,'planned':64,'delivered':63})
        def deadline(read,predicate,**options):
            self.assertFalse(predicate(read()))
            raise TimeoutError('synthetic_delivery_pending')
        with self.assertRaises(TimeoutError):telegram.establish([],invoke,deadline,incomplete,256)
        self.assertEqual(events,[('admit',0)])
        events.clear()
        with patch.object(telegram.time,'monotonic',side_effect=[0,0,0,76]):
            with self.assertRaisesRegex(TimeoutError,'synthetic_telegram_setup_deadline'):
                telegram.establish([],invoke,wait,sql,256)
        self.assertEqual(events,[('admit',0)])
        def partial_total(compose,query,**options):
            row=json.loads(sql(compose,query,**options))
            if row['accepted']==256:row['delivered']=255
            return json.dumps(row)
        with self.assertRaisesRegex(ValueError,'all_telegram_contacts_required'):
            telegram.establish([],invoke,wait,partial_total,256)
        clock=[0]
        def late_total(compose,query,**options):
            value=sql(compose,query,**options)
            if json.loads(value)['accepted']==256:clock[0]=76
            return value
        with patch.object(telegram.time,'monotonic',side_effect=lambda:clock[0]):
            with self.assertRaisesRegex(TimeoutError,'synthetic_telegram_setup_deadline'):
                telegram.establish([],invoke,wait,late_total,256)

    def test_pending_or_failed_native_rows_cannot_pass_processed_workload(self):
        for row in ({'accepted':5,'processed':0,'failed':0,'planned':5,'delivered':0},{'accepted':5,'processed':4,'failed':1,'planned':5,'delivered':4},{'accepted':4,'processed':4,'failed':0,'planned':4,'delivered':4}):
            self.assertIsNone(telegram.processed([],lambda *args,**kw:json.dumps(row),2000000,2001000,5))
        expected={'accepted':5,'processed':5,'failed':0,'planned':5,'delivered':5}
        self.assertEqual(telegram.processed([],lambda *args,**kw:json.dumps(expected),2000000,2001000,5),expected)
        with self.assertRaises(ValueError):telegram.processed([],lambda *args,**kw:'{"accepted":true,"processed":1,"failed":0}',2000000,2001000,1)
        with self.assertRaises(ValueError):telegram.processed([],lambda *args,**kw:'{}','unsafe',2001000,1)

        # Pre-build contracts remain stdlib-only; the dependency-ready Node tooling
        # wrapper separately validates this generated environment with the real parser.
        with tempfile.TemporaryDirectory(prefix='inside-telegram-config-') as temporary:
            output=Path(temporary)
            plan={'services':{'provider':{},'loadgen':{'volumes':[]}}}
            telegram.configure(output,plan,{'telegram':'owned-fixed-image'})
            values=dict(line.split('=',1) for line in (output/'telegram/application.env').read_text().splitlines())
            self.assertEqual(values['TELEGRAM_MEMBERSHIP_MODE'],'disabled')
            self.assertEqual(values['TELEGRAM_DELIVERY_MODE'],'live')
            self.assertEqual(values['WORKERS_ENABLED'],'true')
