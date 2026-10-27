package main

import (
	"encoding/json"
	"strconv"
)

// Jaeger GetTrace and GetTraceList can return mixed-age spans; time parameters alone are insufficient.
// Build a result from retained spans and only their referenced process metadata. Do not pass upstream
// totals/warnings/errors describing rows no longer present in the bounded response.
func filterTraces(raw []byte, cutoffMicro int64) ([]byte, error) {
	var root map[string]json.RawMessage
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, errHorizon
	}
	var traces []map[string]json.RawMessage
	if err := json.Unmarshal(root["data"], &traces); err != nil {
		return nil, errHorizon
	}
	kept := make([]map[string]json.RawMessage, 0, len(traces))
	for _, trace := range traces {
		var spans []map[string]json.RawMessage
		var processes map[string]json.RawMessage
		var traceID string
		if json.Unmarshal(trace["traceID"], &traceID) != nil || len(traceID) != 32 || json.Unmarshal(trace["spans"], &spans) != nil || json.Unmarshal(trace["processes"], &processes) != nil {
			return nil, errHorizon
		}
		selected := make([]map[string]json.RawMessage, 0, len(spans))
		used := map[string]json.RawMessage{}
		for _, span := range spans {
			start, err := strconv.ParseInt(string(span["startTime"]), 10, 64)
			if err != nil || start < 0 {
				return nil, errHorizon
			}
			if start < cutoffMicro {
				continue
			}
			var processID string
			if json.Unmarshal(span["processID"], &processID) != nil {
				return nil, errHorizon
			}
			process, ok := processes[processID]
			if !ok {
				return nil, errHorizon
			}
			selected = append(selected, span)
			used[processID] = process
		}
		if len(selected) == 0 {
			continue
		}
		trace["spans"], _ = json.Marshal(selected)
		trace["processes"], _ = json.Marshal(used)
		trace["warnings"] = json.RawMessage("null")
		if len(selected) < len(spans) {
			trace["warnings"], _ = json.Marshal([]string{"Spans outside the retained 14-day history were omitted."})
		}
		// Pinned Jaeger trace has only traceID/spans/processes/warnings; project those owned fields.
		kept = append(kept, map[string]json.RawMessage{"traceID": trace["traceID"], "spans": trace["spans"], "processes": trace["processes"], "warnings": trace["warnings"]})
	}
	return json.Marshal(map[string]any{"data": kept, "total": len(kept), "limit": 0, "offset": 0, "errors": nil})
}
