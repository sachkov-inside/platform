package main

import (
	"context"
	"encoding/json"
	"github.com/VictoriaMetrics/metricsql"
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const seriesLimit = 10000

func labelValuesPath(path string) bool {
	parts := strings.Split(path, "/")
	return len(parts) == 6 && parts[1] == "api" && parts[2] == "v1" && parts[3] == "label" && parts[4] != "" && parts[5] == "values"
}

type vmEnvelope struct {
	Status string          `json:"status"`
	Data   json.RawMessage `json:"data"`
}

func vmData(raw []byte) (json.RawMessage, error) {
	var result vmEnvelope
	if json.Unmarshal(raw, &result) != nil || result.Status != "success" || len(result.Data) == 0 {
		return nil, errHorizon
	}
	return result.Data, nil
}
func vmResponse(data any) ([]byte, error) {
	return json.Marshal(map[string]any{"status": "success", "data": data})
}
func (g *guard) discovery(ctx context.Context, path string, params url.Values, now time.Time, cutoff int64) ([]byte, error) {
	if !allowed(params, "match[],start,end,limit,metric") {
		return nil, errHorizon
	}
	start, err := instant(params.Get("start"), cutoff)
	if err != nil {
		return nil, err
	}
	if start < cutoff {
		start = cutoff
	}
	end, err := instant(params.Get("end"), now.UnixMilli())
	if err != nil || end > now.UnixMilli() || start >= end {
		return nil, errHorizon
	}
	limit := seriesLimit
	if s := params.Get("limit"); s != "" {
		limit, err = strconv.Atoi(s)
		if err != nil || limit < 0 || limit > seriesLimit {
			return nil, errHorizon
		}
		if limit == 0 {
			limit = seriesLimit
		}
	}
	matches := params["match[]"]
	if len(matches) == 0 {
		matches = []string{`{__name__!=""}`}
	}
	if len(matches) > 32 {
		return nil, errHorizon
	}
	found := map[string]map[string]string{}
	stamps := map[string]float64{}
	for _, match := range matches {
		expr, err := metricsql.ParseBounded(match)
		if err != nil {
			return nil, errHorizon
		}
		selector, ok := expr.(*metricsql.MetricExpr)
		if !ok {
			return nil, errHorizon
		}
		// Pinned tlast_over_time uses only samples strictly within (E-window,E], without its fetched
		// predecessor. This owner-generated fixed rollup preserves raw label membership at exact time.
		query := "tlast_over_time(" + string(selector.AppendString(nil)) + "[" + strconv.FormatInt(end-start, 10) + "ms]) keep_metric_names"
		raw, err := g.fetch(ctx, g.metrics, "/api/v1/query", url.Values{"query": {query}, "time": {seconds(end)}, "nocache": {"1"}, "limit": {strconv.Itoa(seriesLimit + 1)}})
		if err != nil {
			return nil, err
		}
		data, err := vmData(raw)
		if err != nil {
			return nil, err
		}
		var vector struct {
			ResultType string `json:"resultType"`
			Result     []struct {
				Metric map[string]string `json:"metric"`
				Value  []json.RawMessage `json:"value"`
			} `json:"result"`
		}
		if json.Unmarshal(data, &vector) != nil || vector.ResultType != "vector" || len(vector.Result) > seriesLimit {
			return nil, errHorizon
		}
		for _, row := range vector.Result {
			if row.Metric["__name__"] == "" {
				return nil, errHorizon
			}
			if len(row.Value) != 2 {
				return nil, errHorizon
			}
			var stampText string
			if json.Unmarshal(row.Value[1], &stampText) != nil {
				return nil, errHorizon
			}
			stamp, err := strconv.ParseFloat(stampText, 64)
			if err != nil || math.IsNaN(stamp) || math.IsInf(stamp, 0) {
				return nil, errHorizon
			}
			key, _ := json.Marshal(row.Metric)
			found[string(key)] = row.Metric
			if stamp > stamps[string(key)] {
				stamps[string(key)] = stamp
			}
			if len(found) > seriesLimit {
				return nil, errHorizon
			}
		}
	}
	var descriptorData json.RawMessage
	if path == "/api/v1/metadata" {
		raw, err := g.fetch(ctx, g.metrics, path, url.Values{"metric": {params.Get("metric")}})
		if err != nil {
			return nil, err
		}
		descriptorData, err = vmData(raw)
		if err != nil {
			return nil, err
		}
	}
	finalCutoff := g.clock().UnixMilli() - metricsHorizon
	keys := make([]string, 0, len(found))
	for k := range found {
		if stamps[k]*1000 >= float64(finalCutoff) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	series := make([]map[string]string, 0, len(keys))
	names := map[string]bool{}
	labels := map[string]bool{}
	values := map[string]bool{}
	wantedLabel := ""
	if labelValuesPath(path) {
		wantedLabel = strings.Split(path, "/")[4]
	}
	for _, key := range keys {
		row := found[key]
		series = append(series, row)
		names[row["__name__"]] = true
		for k, v := range row {
			labels[k] = true
			if k == wantedLabel {
				values[v] = true
			}
		}
	}
	if path == "/api/v1/series" {
		if len(series) > limit {
			series = series[:limit]
		}
		return vmResponse(series)
	}
	if path == "/api/v1/labels" {
		return vmResponse(sortedSet(labels, limit))
	}
	if wantedLabel != "" {
		return vmResponse(sortedSet(values, limit))
	}
	// Metadata is a timeless descriptor, not a sample. Emit it only for families proven present
	// in the raw event-time horizon; do not trust metadata/index name enumeration for membership.
	var metadata map[string]json.RawMessage
	if json.Unmarshal(descriptorData, &metadata) != nil {
		return nil, errHorizon
	}
	selected := map[string]json.RawMessage{}
	for name, descriptor := range metadata {
		if names[name] || names[name+"_bucket"] || names[name+"_sum"] || names[name+"_count"] {
			selected[name] = descriptor
			if len(selected) > seriesLimit {
				return nil, errHorizon
			}
		}
	}
	return vmResponse(selected)
}
func sortedSet(set map[string]bool, limit int) []string {
	out := make([]string, 0, len(set))
	for s := range set {
		out = append(out, s)
	}
	sort.Strings(out)
	if len(out) > limit {
		out = out[:limit]
	}
	return out
}
