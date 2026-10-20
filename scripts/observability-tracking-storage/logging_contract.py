"""Actual freshly compiled production HTTP completion/logging -> strict Python IPC."""
import unittest
import producer_protocol


class ProductionLoggingIpc(unittest.TestCase):
    def test_real_http_completion_log_does_not_enter_the_single_json_witness(self):
        result=producer_protocol.capture(argv=['node',str(producer_protocol.HERE/'logging-fixture.mjs')],budget=5)
        self.assertEqual(result,{'schema':1,'http':'passed','private_log_count':1})

    def test_real_logging_and_rejected_work_restore_console_without_raw_failure_output(self):
        result=producer_protocol.capture(argv=['node',str(producer_protocol.HERE/'logging-fixture.mjs'),'reject-work'],budget=5)
        self.assertEqual(result,{'schema':1,'rejected_work':'passed','console_restored':'passed','private_log_count':1})


if __name__=='__main__': unittest.main()
