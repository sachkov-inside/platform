package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestMixedJaegerTraceDoesNotReturnExpiredSpanOrItsProcess(t *testing.T) {
	raw := []byte(`{"data":[{"traceID":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","spans":[{"spanID":"1111111111111111","startTime":999999,"processID":"old"},{"spanID":"2222222222222222","startTime":1000000,"processID":"new"}],"processes":{"old":{"serviceName":"expired"},"new":{"serviceName":"retained"}},"warnings":null}],"total":1,"limit":0,"offset":0,"errors":null}`)
	result, err := filterTraces(raw, 1000000)
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(result, &got); err != nil {
		t.Fatal(err)
	}
	if string(got["data"]) == "[]" || contains(result, "expired") || contains(result, "1111111111111111") {
		t.Fatalf("mixed trace leaked or discarded retained span: %s", result)
	}
	if !contains(result, "2222222222222222") {
		t.Fatal("retained span missing")
	}
	for _, invalid := range []string{`{"data":[{"spans":[{"startTime":"1000000"}],"processes":{}}]}`, `{"data":[{"spans":[{"startTime":null}],"processes":{}}]}`} {
		if _, err := filterTraces([]byte(invalid), 1000000); err == nil {
			t.Fatal("malformed native span passed")
		}
	}
}
func contains(raw []byte, s string) bool { return strings.Contains(string(raw), s) }
