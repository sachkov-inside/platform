"""Fixed owning trace feedback, without native storage or cause attribution."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"observability-sdk-storage"))
import oracle as owning_oracle
from test_oracle import trace_fixture
import trace_reason_contract as contract

class OwningTraceReasons(contract.TraceReasons):
    scope='sdk'
    oracle=owning_oracle
    fixture=staticmethod(trace_fixture)
    arguments={'trace_id':'a'*32,'root_id':'b'*16,'release':'c'*40}

class ClosedTraceMetadata(contract.ClosedTraceMetadata):
    pass
