package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
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

func TestHTTPBudgetsAndCancellationDoNotForwardCredentialsOrLeaveAnUpstreamRead(t *testing.T) {
	entered := make(chan struct{}, 1)
	cancelled := make(chan struct{}, 1)
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("credential forwarded to uncredentialed storage")
		}
		r.ParseForm() // Native VM consumes the form before waiting for storage.
		entered <- struct{}{}
		<-r.Context().Done()
		cancelled <- struct{}{}
	}))
	defer backend.Close()
	g := newGuard(backend.URL, backend.URL, time.Now)
	oversized := httptest.NewRequest("POST", "/metrics/api/v1/query", strings.NewReader("query="+strings.Repeat("x", requestLimit)))
	oversized.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response := httptest.NewRecorder()
	g.ServeHTTP(response, oversized)
	if response.Code != 400 {
		t.Fatal("oversized form was not refused")
	}
	select {
	case <-entered:
		t.Fatal("oversized form reached upstream")
	default:
	}
	ctx, cancel := context.WithCancel(context.Background())
	request := httptest.NewRequest("GET", "/metrics/api/v1/query?query=1", nil).WithContext(ctx)
	request.Header.Set("Authorization", "Bearer private-sentinel")
	request.Header.Set("Cookie", "private-sentinel")
	done := make(chan int, 1)
	go func() { response := httptest.NewRecorder(); g.ServeHTTP(response, request); done <- response.Code }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("owned upstream was not reached")
	}
	cancel()
	select {
	case status := <-done:
		if status != 503 {
			t.Fatal("cancelled read became successful")
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled guard read did not finish")
	}
	select {
	case <-cancelled:
	case <-time.After(time.Second):
		t.Fatal("upstream request not cancelled")
	}
	if len(g.active) != 0 {
		t.Fatal("inflight slot leaked")
	}
}

func TestJaegerAggregateWindowIsClampedBeforeTheNativeRequest(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	calls := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" {
			t.Error("native Jaeger reads URL parameters")
		}
		if strings.HasSuffix(r.URL.Path, "/dependencies") {
			end, _ := strconv.ParseInt(r.URL.Query().Get("endTs"), 10, 64)
			lookback, _ := strconv.ParseInt(r.URL.Query().Get("lookback"), 10, 64)
			if end-lookback < now.Add(-14*24*time.Hour).UnixMilli() {
				t.Error("expired aggregate reached storage")
			}
			w.Write([]byte(`{"data":[],"errors":null}`))
		} else {
			t.Error("unknown Jaeger route")
		}
	}))
	defer backend.Close()
	g := newGuard(backend.URL, backend.URL, func() time.Time { return now })
	response := httptest.NewRecorder()
	g.ServeHTTP(response, httptest.NewRequest("GET", "/traces/select/jaeger/api/dependencies?lookback=8760h", nil))
	if response.Code != 200 || calls != 1 {
		t.Fatalf("clamped aggregate failed %d %d", response.Code, calls)
	}
	response = httptest.NewRecorder()
	g.ServeHTTP(response, httptest.NewRequest("POST", "/traces/select/jaeger/api/dependencies?endTs=0", strings.NewReader("endTs=1")))
	if calls != 1 {
		t.Fatal("ambiguous or expired aggregate reached upstream")
	}
}

// The real vendor parser used to expand this 272-byte query for longer than the HTTP
// timeout. Both user query and discovery selector admission must stop before expansion.
func TestHTTPMacroExpansionIsBoundedBeforeStorage(t *testing.T) {
	parts := []string{"x0=m"}
	for i := 1; i <= 24; i++ {
		parts = append(parts, fmt.Sprintf("x%d=x%d+x%d", i, i-1, i-1))
	}
	explosion := "WITH(" + strings.Join(parts, ",") + ")x24"
	g := newGuard("http://127.0.0.1:1", "http://127.0.0.1:1", time.Now)
	for _, path := range []string{
		"/metrics/api/v1/query?query=" + url.QueryEscape(explosion),
		"/metrics/api/v1/series?match[]=" + url.QueryEscape(explosion),
	} {
		start := time.Now()
		response := httptest.NewRecorder()
		g.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 400 || time.Since(start) > time.Second {
			t.Fatalf("complexity refusal status=%d elapsed=%v", response.Code, time.Since(start))
		}
	}
}
