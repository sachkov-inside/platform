package main

import (
	"context"
	"encoding/json"
	"github.com/VictoriaMetrics/metricsql"
	"io"
	"math"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const responseLimit = 8 * 1024 * 1024
const requestLimit = 64 * 1024
const traceHorizon = int64(14 * 24 * time.Hour / time.Microsecond)
const deadline = 8 * time.Second

type guard struct {
	metrics, traces string
	clock           func() time.Time
	client          *http.Client
	active          chan struct{}
}

func newGuard(metrics, traces string, clock func() time.Time) *guard {
	transport := &http.Transport{Proxy: nil, MaxConnsPerHost: 2, MaxIdleConns: 2, ResponseHeaderTimeout: deadline, DisableCompression: true}
	return &guard{metrics: metrics, traces: traces, clock: clock, active: make(chan struct{}, 2), client: &http.Client{Transport: transport, Timeout: deadline, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}
func (g *guard) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	refuse := func(status int) {
		w.WriteHeader(status)
		io.WriteString(w, `{"error":"query horizon unavailable or refused"}`)
	}
	if r.Method != "GET" && r.Method != "POST" {
		refuse(403)
		return
	}
	select {
	case g.active <- struct{}{}:
		defer func() { <-g.active }()
	default:
		refuse(503)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, requestLimit)
	if r.Method == "POST" && r.ContentLength != 0 {
		media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil || media != "application/x-www-form-urlencoded" {
			refuse(415)
			return
		}
	}
	if err := r.ParseForm(); err != nil {
		refuse(400)
		return
	}
	for key, values := range r.Form {
		if len(values) != 1 && key != "match[]" {
			refuse(400)
			return
		}
	}
	ctx, cancel := context.WithTimeout(r.Context(), deadline)
	defer cancel()
	// Freeze query evaluation separately from the final response horizon. Expiry in flight
	// is rechecked below, never hidden by narrowing a successful aggregate.
	now := g.clock()
	cutoff := now.UnixMilli() - metricsHorizon
	params := r.Form
	var result []byte
	var err error
	switch {
	case strings.HasPrefix(r.URL.Path, "/metrics/"):
		path := strings.TrimPrefix(r.URL.Path, "/metrics")
		switch {
		case path == "/api/v1/query" || path == "/api/v1/query_range":
			if !allowed(params, "query,time,start,end,step,timeout,nocache,round_digits,limit,max_lookback,max_staleness_interval,latency_offset,extra_label,extra_filters,extra_filters[]") {
				refuse(400)
				return
			}
			start, end := now.UnixMilli(), now.UnixMilli()
			step := silence
			if path == "/api/v1/query" {
				start, err = instant(params.Get("time"), start)
				end = start
			} else {
				start, err = instant(params.Get("start"), start-silence)
				if err == nil {
					end, err = instant(params.Get("end"), end)
				}
			}
			if err == nil && params.Get("step") != "" {
				step, err = metricsql.DurationValue(params.Get("step"), 0)
			}
			if err != nil || start < cutoff || end > now.UnixMilli() || proveMetrics(params.Get("query"), start, end, step, cutoff) != nil {
				refuse(400)
				return
			}
			params.Set("nocache", "1")
			params.Set("max_lookback", "300s")
			params.Set("max_staleness_interval", "300s")
			params.Set("latency_offset", "1ms")
			// Freeze the actual evaluation instant, including ordinary requests without time.
			if path == "/api/v1/query" {
				params.Set("time", seconds(start))
			} else {
				params.Set("start", seconds(start))
				params.Set("end", seconds(end))
			}
			result, err = g.fetch(ctx, g.metrics, path, params)
			if err == nil && proveMetrics(params.Get("query"), start, end, step, g.clock().UnixMilli()-metricsHorizon) != nil {
				err = errHorizon
			}
		case path == "/api/v1/status/buildinfo":
			result, err = g.fetch(ctx, g.metrics, path, url.Values{})
		case path == "/api/v1/labels" || path == "/api/v1/series" || path == "/api/v1/metadata" || labelValuesPath(path):
			result, err = g.discovery(ctx, path, params, now, cutoff)
		default:
			refuse(403)
			return
		}
	case strings.HasPrefix(r.URL.Path, "/traces/select/jaeger/api/"):
		path := strings.TrimPrefix(r.URL.Path, "/traces")
		result, err = g.jaeger(ctx, path, params, now)
	default:
		refuse(403)
		return
	}
	if err != nil {
		refuse(503)
		return
	}
	w.WriteHeader(200)
	w.Write(result)
}
func allowed(params url.Values, keys string) bool {
	set := map[string]bool{}
	for _, k := range strings.Split(keys, ",") {
		set[k] = true
	}
	for k := range params {
		if !set[k] {
			return false
		}
	}
	return true
}
func seconds(ms int64) string { return strconv.FormatFloat(float64(ms)/1000, 'f', 3, 64) }
func instant(raw string, fallback int64) (int64, error) {
	if raw == "" {
		return fallback, nil
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t.UnixMilli(), nil
	}
	f, err := strconv.ParseFloat(raw, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 0 || f > 1e12 {
		return 0, errHorizon
	}
	return int64(f * 1000), nil
}
func (g *guard) fetch(ctx context.Context, origin, path string, params url.Values) ([]byte, error) {
	method := http.MethodPost
	target := origin + path
	var body io.Reader = strings.NewReader(params.Encode())
	if strings.HasPrefix(path, "/select/jaeger/") {
		method = http.MethodGet
		target += "?" + params.Encode()
		body = nil
	}
	request, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, errHorizon
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := g.client.Do(request)
	if err != nil {
		return nil, errHorizon
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, errHorizon
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
	if err != nil || len(raw) > responseLimit || !json.Valid(raw) {
		return nil, errHorizon
	}
	return raw, nil
}
