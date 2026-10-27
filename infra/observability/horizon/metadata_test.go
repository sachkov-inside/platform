package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestMetadataDiscoveryComesFromBoundedRawSamplesNotCoarseStorageIndex(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.URL.Path == "/api/v1/query" {
			if !strings.HasPrefix(r.Form.Get("query"), "tlast_over_time(") || r.Form.Get("nocache") != "1" {
				t.Error("discovery did not use bounded raw lookup")
			}
			w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[{"metric":{"__name__":"retained","job":"alive"},"value":[1,"1793092800"]}]}}`))
		} else if r.URL.Path == "/api/v1/metadata" {
			w.Write([]byte(`{"status":"success","data":{"expired":[{"type":"gauge"}],"retained":[{"type":"gauge"}]}}`))
		} else {
			t.Error("coarse index discovery used")
			http.Error(w, "unexpected", 500)
		}
	}))
	defer backend.Close()
	g := newGuard(backend.URL, backend.URL, func() time.Time { return now })
	for _, path := range []string{"/metrics/api/v1/labels", "/metrics/api/v1/label/job/values", "/metrics/api/v1/series?match[]=retained", "/metrics/api/v1/metadata"} {
		w := httptest.NewRecorder()
		g.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || strings.Contains(w.Body.String(), "expired") {
			t.Fatalf("discovery unsafe/refused %s: %d %s", path, w.Code, w.Body.String())
		}
	}
}
