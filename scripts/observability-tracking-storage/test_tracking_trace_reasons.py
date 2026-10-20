"""Fixed owning trace feedback, without native storage or cause attribution."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"observability-sdk-storage"))
import tracking_oracle as owning_oracle
from test_tracking_oracle import trace_rows as trace_fixture, TRACE, ROOT
import trace_reason_contract as contract

class OwningTraceReasons(contract.TraceReasons):
    scope='tracking'
    oracle=owning_oracle
    fixture=staticmethod(trace_fixture)
    arguments={'trace_id':TRACE,'root_id':ROOT}
