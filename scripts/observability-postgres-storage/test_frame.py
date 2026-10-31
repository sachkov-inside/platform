"""Fixed source frames, epoch/freshness and encoder controls; no PG/process/network."""
import copy
import json
import unittest
import frame

NOW=1790000000000000

def packet():
    return {'schema':1,'fields':[{'name':name,'oid':oid} for name,oid in frame.FIELDS],
            'rows':[['180004','on','on','on',True,True,True,str(NOW),str(NOW-10_000_000),str(NOW-20_000_000),'3','0','2']]}


class Frames(unittest.TestCase):
    def test_whole_raw_packet_and_null_reset_refuse_before_seven_point_projection(self):
        source=frame.decode((json.dumps(packet())+'\n').encode(),NOW)
        self.assertEqual(source['connected_backends'],3)
        body=frame.payload(source)
        metrics=body['resourceMetrics'][0]['scopeMetrics'][0]['metrics']
        self.assertEqual(len(metrics),7)
        self.assertTrue(all(len(metric['gauge']['dataPoints'])==1 for metric in metrics))
        for column in range(13):
            value=packet();value['rows'][0][column]='controlled-private'
            with self.assertRaisesRegex(ValueError,'^malformed$'):frame.decode((json.dumps(value)+'\n').encode(),NOW)
        value=packet();value['rows'][0][9]=None
        with self.assertRaisesRegex(ValueError,'^identity_unavailable$'):frame.decode((json.dumps(value)+'\n').encode(),NOW)
        for raw in (b'{}\n{}\n',b'\xef\xbb\xbf{}\n',b'{"schema":1,"schema":1}\n',b' '*4097):
            with self.assertRaises(ValueError):frame.decode(raw,NOW)

    def test_epoch_discontinuities_are_not_counted_as_healthy_intervals(self):
        value=frame.decode((json.dumps(packet())+'\n').encode(),NOW);ledger=frame.Ledger()
        self.assertEqual(ledger.accept(value)['continuity'],'initial')
        newer={**value,'sample_us':NOW+1_000_000,'deadlocks':3}
        self.assertTrue(ledger.accept(newer)['count_complete'])
        reset={**newer,'sample_us':NOW+2_000_000,'stats_reset_us':NOW+1_500_000,'deadlocks':0}
        self.assertEqual(ledger.accept(reset)['continuity'],'statistics_reset')
        self.assertFalse(ledger.accept({**reset,'sample_us':NOW+3_000_000})['count_complete'])
        self.assertTrue(ledger.accept({**reset,'sample_us':NOW+4_000_000})['count_complete'])
        self.assertEqual(ledger.report(NOW+4_000_000,window_start_us=NOW)['continuity'],'statistics_reset')
        with self.assertRaises(ValueError):ledger.accept({**reset,'sample_us':NOW+4_000_000})
        self.assertEqual(ledger.report(NOW+15_000_001)['freshness'],'stale')
        restart={**reset,'sample_us':NOW+16_000_000,'postmaster_us':NOW+15_000_000}
        self.assertEqual(ledger.accept(restart)['continuity'],'server_restart')
        self.assertEqual(ledger.report(NOW+16_000_000,owner_current=False)['continuity'],'ownership_changed')
