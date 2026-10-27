package main

import (
	"testing"
	"time"
)

func TestMetricsHistoryCannotCrossCutoffThroughExpressions(t *testing.T) {
	now := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC).UnixMilli()
	cutoff := now - 90*24*60*60*1000
	for _, query := range []string{
		`boundary_sample[91d]`, `sum(boundary_sample offset 91d)`,
		`WITH (x=boundary_sample offset 91d) sum(x)`,
		`max_over_time((sum(boundary_sample))[89d:1d])`,
		`boundary_sample @ 0`, `boundary_sample @ (time()-91*86400)`,
	} {
		if proveMetrics(query, now, now, 300000, cutoff) == nil {
			t.Errorf("unsafe query admitted: %s", query)
		}
	}
	for _, query := range []string{
		`timestamp_with_name(boundary_sample) and on(job,instance) boundary_sample keep_metric_names`,
		`WITH (x=boundary_sample) sum(rate(x[5m]))`,
		`max_over_time((sum(boundary_sample))[1h:1m])`,
		`boundary_sample @ end()`, `label_replace(boundary_sample,"source_metric","$1","__name__","(.+)")`,
	} {
		if err := proveMetrics(query, now, now, 300000, cutoff); err != nil {
			t.Errorf("ordinary query refused: %s: %v", query, err)
		}
	}
	// Historical E remains supported, but a raw lookbehind at its left boundary is not safe.
	if err := proveMetrics(`boundary_sample`, now-60000, now-60000, 300000, cutoff); err != nil {
		t.Fatal(err)
	}
	if proveMetrics(`boundary_sample`, cutoff+1000, cutoff+1000, 300000, cutoff) == nil {
		t.Fatal("historical instant can read expired predecessor")
	}
}
