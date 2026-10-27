package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Explicit opt-in only. The harness admits two exact official Darwin-arm64 executables already
// acquired and archive-verified by the coordinator; it never discovers a server or touches Docker.
func TestNativeMixedBlockAndTraceEventHorizon(t *testing.T) {
	dir := os.Getenv("INSIDE_HORIZON_NATIVE_BINARIES")
	if dir == "" {
		t.Skip("requires explicit owned digest-verified native vendor executables")
	}
	binaries := map[string]string{"victoria-metrics-prod": "38fb8a5c0e68d845ab2f935d0001389c5540d5b77dc070b731b1179d356173ad", "victoria-traces-prod": "8d31c5589a210111c1707905449fd69969e4b9f74712c4430b10b3e6be47a7e5"}
	for name, digest := range binaries {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256(raw)
		if hex.EncodeToString(sum[:]) != digest {
			t.Fatal("native vendor executable digest mismatch")
		}
	}
	vm := vendor(t, filepath.Join(dir, "victoria-metrics-prod"), "90d")
	vt := vendor(t, filepath.Join(dir, "victoria-traces-prod"), "14d")
	now := time.Now()
	expires := now.Add(40 * time.Second)
	oldMetric := expires.Add(-90 * 24 * time.Hour)
	oldSpan := expires.Add(-14 * 24 * time.Hour)
	keptMetric := oldMetric.Add(25 * time.Second)
	keptSpan := oldSpan.Add(25 * time.Second)
	for _, point := range []struct {
		name   string
		values []int
		stamps []int64
	}{
		{"boundary_mixed", []int{1, 2}, []int64{oldMetric.UnixMilli(), keptMetric.UnixMilli()}},
		{"boundary_expired", []int{1}, []int64{oldMetric.UnixMilli()}},
		{"boundary_current", []int{3}, []int64{now.UnixMilli()}},
	} {
		body, _ := json.Marshal(map[string]any{"metric": map[string]string{"__name__": point.name}, "values": point.values, "timestamps": point.stamps})
		nativeRequest(t, vm+"/api/v1/import", body)
	}
	tid := "15661566156615661566156615661566"
	spans := []any{}
	for i, at := range []time.Time{oldSpan, keptSpan} {
		spans = append(spans, map[string]any{"traceId": tid, "spanId": strings.Repeat(strconv.Itoa(i+1), 16), "name": "postgresql query", "kind": 3, "startTimeUnixNano": strconv.FormatInt(at.UnixNano(), 10), "endTimeUnixNano": strconv.FormatInt(at.Add(time.Millisecond).UnixNano(), 10), "attributes": []any{}, "status": map[string]int{"code": 2}})
	}
	otlp, _ := json.Marshal(map[string]any{"resourceSpans": []any{map[string]any{"resource": map[string]any{"attributes": []any{map[string]any{"key": "service.name", "value": map[string]string{"stringValue": "platform-api"}}}}, "scopeSpans": []any{map[string]any{"spans": spans}}}}})
	nativeRequest(t, vt+"/insert/opentelemetry/v1/traces", otlp)
	vmPath := "/api/v1/query?" + url.Values{"query": {"boundary_mixed[30s]"}, "time": {seconds(keptMetric.Add(time.Second).UnixMilli())}, "nocache": {"1"}}.Encode()
	vtPath := "/select/jaeger/api/traces/" + tid
	// Require both original stored cohorts before expiration; HTTP ACK alone is not a barrier.
	for {
		m := nativeRequest(t, vm+vmPath, nil)
		v := nativeRequest(t, vt+vtPath, nil)
		if strings.Contains(string(m), `"1"`) && strings.Contains(string(m), `"2"`) && strings.Contains(string(v), `1111111111111111`) && strings.Contains(string(v), `2222222222222222`) {
			break
		}
		if time.Until(expires) < time.Second {
			t.Fatal("two native cohorts were not visible before expiry")
		}
		time.Sleep(100 * time.Millisecond)
	}
	// Deliberate clock crossing proves absence; it is not a readiness sleep.
	if wait := time.Until(expires.Add(200 * time.Millisecond)); wait > 0 {
		time.Sleep(wait)
	}
	rawVM := nativeRequest(t, vm+vmPath, nil)
	rawVT := nativeRequest(t, vt+vtPath, nil)
	if !strings.Contains(string(rawVM), `"1"`) || !strings.Contains(string(rawVT), `1111111111111111`) {
		t.Fatal("native RED counterexample no longer reproduces; inspect pinned vendor semantics")
	}
	g := newGuard(vm, vt, time.Now)
	for _, path := range []string{
		"/metrics" + vmPath,
		"/metrics/api/v1/query?" + url.Values{"query": {"boundary_mixed offset 90d"}}.Encode(),
		"/metrics/api/v1/query?" + url.Values{"query": {"WITH(x=boundary_mixed offset 90d)sum(x)"}}.Encode(),
	} {
		response := httptest.NewRecorder()
		g.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 400 {
			t.Fatalf("unsafe VM query not refused: %d %s", response.Code, response.Body.String())
		}
	}
	for _, path := range []string{
		"/traces" + vtPath,
		"/traces/select/jaeger/api/traces?" + url.Values{"service": {"platform-api"}, "start": {strconv.FormatInt(oldSpan.Add(-time.Second).UnixMicro(), 10)}, "end": {strconv.FormatInt(keptSpan.Add(time.Second).UnixMicro(), 10)}, "limit": {"10"}}.Encode(),
	} {
		response := httptest.NewRecorder()
		g.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		body := response.Body.String()
		if response.Code != 200 || strings.Contains(body, `1111111111111111`) || !strings.Contains(body, `2222222222222222`) {
			t.Fatalf("Jaeger mixedtrace horizon failed: %d %s", response.Code, body)
		}
	}
	for _, path := range []string{"/metrics/api/v1/series?match[]=" + url.QueryEscape(`{__name__=~"boundary_.*"}`), "/metrics/api/v1/label/__name__/values"} {
		response := httptest.NewRecorder()
		g.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		body := response.Body.String()
		if response.Code != 200 || strings.Contains(body, "boundary_expired") || !strings.Contains(body, "boundary_mixed") || !strings.Contains(body, "boundary_current") {
			t.Fatalf("raw-sample metadata horizon failed: %d %s", response.Code, body)
		}
	}
	t.Log("native VM1.154/VT0.12 mixedblock RED and guard GREEN; own temporary vendor processes only, not production/capacity/full-stack acceptance")
}
func vendor(t *testing.T, binary, retention string) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	cmd := exec.Command(binary, "-httpListenAddr="+address, "-storageDataPath="+t.TempDir(), "-retentionPeriod="+retention, "-memory.allowedBytes=32MiB", "-loggerLevel=ERROR", "-search.latencyOffset=1ms")
	// VT has no metrics-only latency flag.
	if retention == "14d" {
		cmd.Args = cmd.Args[:len(cmd.Args)-1]
	}
	cmd.Env = append(os.Environ(), "GOMAXPROCS=1", "GOMEMLIMIT=128MiB")
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cmd.Process.Signal(os.Interrupt)
		done := make(chan error, 1)
		go func() { done <- cmd.Wait() }()
		select {
		case <-done:
		case <-time.After(4 * time.Second):
			cmd.Process.Kill()
			select {
			case <-done:
			case <-time.After(2 * time.Second):
				t.Error("owned vendor reap unproved")
			}
		}
	})
	deadline := time.Now().Add(5 * time.Second)
	client := &http.Client{Timeout: time.Second}
	for {
		response, err := client.Get("http://" + address + "/health")
		if err == nil {
			response.Body.Close()
			if response.StatusCode == 200 {
				break
			}
		}
		if time.Now().After(deadline) {
			t.Fatal("owned native startup deadline")
		}
		time.Sleep(25 * time.Millisecond)
	}
	return "http://" + address
}
func nativeRequest(t *testing.T, target string, body []byte) []byte {
	t.Helper()
	method := "GET"
	if body != nil {
		method = "POST"
	}
	request, err := http.NewRequest(method, target, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
	if err != nil || len(raw) > responseLimit || response.StatusCode < 200 || response.StatusCode > 299 && !(response.StatusCode == 404 && strings.Contains(target, "/select/jaeger/api/traces/")) {
		t.Fatal(fmt.Sprintf("native boundary failed status%d", response.StatusCode))
	}
	return raw
}
