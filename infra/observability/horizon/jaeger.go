package main

import (
	"context"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var tracePath = regexp.MustCompile(`^/select/jaeger/api/traces/[0-9a-fA-F]{32}$`)
var operationPath = regexp.MustCompile(`^/select/jaeger/api/services/[^/]+/operations$`)

func (g *guard) jaeger(ctx context.Context, path string, params url.Values, now time.Time) ([]byte, error) {
	cutoff := now.UnixMicro() - traceHorizon
	switch {
	case path == "/select/jaeger/api/traces":
		if !allowed(params, "service,operation,start,end,limit,minDuration,maxDuration,tags,lookback") {
			return nil, errHorizon
		}
		start, end := cutoff, now.UnixMicro()
		var err error
		if s := params.Get("start"); s != "" {
			start, err = strconv.ParseInt(s, 10, 64)
			if err != nil {
				return nil, errHorizon
			}
		}
		if s := params.Get("end"); s != "" {
			end, err = strconv.ParseInt(s, 10, 64)
			if err != nil {
				return nil, errHorizon
			}
		}
		if start < cutoff {
			start = cutoff
		}
		if end > now.UnixMicro() {
			end = now.UnixMicro()
		}
		if start > end {
			return nil, errHorizon
		}
		params.Set("start", strconv.FormatInt(start, 10))
		params.Set("end", strconv.FormatInt(end, 10))
		params.Del("lookback")
		raw, err := g.fetch(ctx, g.traces, path, params)
		if err != nil {
			return nil, err
		}
		return filterTraces(raw, g.clock().UnixMicro()-traceHorizon)
	case tracePath.MatchString(path):
		if len(params) != 0 {
			return nil, errHorizon
		}
		raw, err := g.fetch(ctx, g.traces, path, params)
		if err != nil {
			return nil, err
		}
		return filterTraces(raw, g.clock().UnixMicro()-traceHorizon)
	case path == "/select/jaeger/api/services" || operationPath.MatchString(path):
		// Pinned0.12 GetServiceNameList/GetSpanNameList use fixed native3d streamFieldsLookbehind.
		// Arbitrary native search options must not replace that query. vmauth still owns tenant/auth.
		if len(params) != 0 {
			return nil, errHorizon
		}
		return g.fetch(ctx, g.traces, path, params)
	case path == "/select/jaeger/api/dependencies":
		if !allowed(params, "endTs,lookback") {
			return nil, errHorizon
		}
		end := now.UnixMilli()
		lookback := time.Hour
		var err error
		if s := params.Get("endTs"); s != "" {
			end, err = strconv.ParseInt(s, 10, 64)
			if err != nil {
				return nil, errHorizon
			}
		}
		if end > now.UnixMilli() {
			end = now.UnixMilli()
		}
		if s := params.Get("lookback"); s != "" {
			if strings.Trim(s, "0123456789") == "" {
				s += "ms"
			}
			lookback, err = time.ParseDuration(s)
			if err != nil || lookback < 0 {
				return nil, errHorizon
			}
		}
		oldest := (cutoff + 999) / 1000
		if end <= oldest {
			return nil, errHorizon
		}
		if lookback.Milliseconds() > end-oldest {
			lookback = time.Duration(end-oldest) * time.Millisecond
		}
		params.Set("endTs", strconv.FormatInt(end, 10))
		params.Set("lookback", strconv.FormatInt(lookback.Milliseconds(), 10))
		raw, err := g.fetch(ctx, g.traces, path, params)
		if err != nil {
			return nil, err
		}
		if end-lookback.Milliseconds() < (g.clock().UnixMicro()-traceHorizon+999)/1000 {
			return nil, errHorizon
		}
		return raw, nil
	default:
		return nil, errHorizon
	}
}
