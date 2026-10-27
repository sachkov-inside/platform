package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestHTTPMetricsCannotBypassWithBodyDuplicateOrHistoricalTime(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		r.ParseForm()
		if r.Form.Get("nocache") != "1" {
			t.Error("cache not disabled")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"success","data":{"resultType":"vector","result":[]}}`))
	}))
	defer upstream.Close()
	guard := newGuard(upstream.URL, upstream.URL, func() time.Time { return now })
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/metrics/api/v1/query?query=m&time=0", "", 400},
		{"GET", "/metrics/api/v1/query?query=m&query=1", "", 400},
		{"POST", "/metrics/api/v1/query?query=1", "query=m", 400},
		{"POST", "/metrics/api/v1/query", "query=" + url.QueryEscape("m offset 91d"), 400},
		{"GET", "/metrics/api/v1/admin/tsdb/delete_series?match[]=m", "", 403},
		{"GET", "/metrics/api/v1/query?query=" + url.QueryEscape("timestamp_with_name(m)"), "", 200},
		{"POST", "/metrics/api/v1/query", "query=" + url.QueryEscape("WITH(x=m)sum(x)"), 200},
	} {
		request := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		if tc.method == "POST" {
			request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		}
		response := httptest.NewRecorder()
		guard.ServeHTTP(response, request)
		if response.Code != tc.status {
			t.Errorf("%s %s: got%d want%d: %s", tc.method, tc.path, response.Code, tc.status, response.Body.String())
		}
	}
	if calls != 2 {
		t.Fatalf("refused request reached storage: %d", calls)
	}
}
