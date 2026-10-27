package main

import (
	"encoding/json"
	"fmt"
	"github.com/VictoriaMetrics/metricsql"
	"os"
	"strings"
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

func TestBoundedVendorParserPreservesOrdinaryMacrosAndRefusesExpansionWork(t *testing.T) {
	for _, query := range []string{
		`WITH (f(x)=x+x, y=m) f(f(y))`,
		`WITH (f(labels)=sum by(labels)(m), filters={job="platform"}) f(job)+m{filters}`,
		`WITH (name="plat"+"form") m{job=name}`,
		`ru(m,100)`, `ttf(m)`, `range_median(m)`, `alias(m,"named")`,
		`increase_pure(inside_web_http_requests_total[5m])`,
	} {
		if _, err := metricsql.ParseBounded(query); err != nil {
			t.Errorf("ordinary vendor macro refused %q: %v", query, err)
		}
	}
	stringParts := []string{`s0="` + strings.Repeat("x", 4096) + `"`}
	expressionParts := []string{"f0(x)=x"}
	labelParts := []string{`l0={a="x"}`}
	for i := 1; i <= 24; i++ {
		stringParts = append(stringParts, fmt.Sprintf("s%d=s%d+s%d", i, i-1, i-1))
		expressionParts = append(expressionParts, fmt.Sprintf("f%d(x)=f%d(x)+f%d(x)", i, i-1, i-1))
		labelParts = append(labelParts, fmt.Sprintf("l%d={l%d,l%d}", i, i-1, i-1))
	}
	for _, query := range []string{
		"WITH(" + strings.Join(stringParts, ",") + ")m{job=s24}",
		"WITH(" + strings.Join(expressionParts, ",") + ")f24(m)",
		"WITH(" + strings.Join(labelParts, ",") + ")m{l24}",
		strings.Repeat("(", 65) + "m" + strings.Repeat(")", 65),
		strings.Repeat("m+", 2100) + "m",
	} {
		start := time.Now()
		_, err := metricsql.ParseBounded(query)
		if err == nil || !strings.Contains(err.Error(), "complexity budget") || time.Since(start) > time.Second {
			t.Fatalf("unbounded expansion: error=%v elapsed=%v", err, time.Since(start))
		}
	}
}

func TestAcceptedRepositoryQueryCatalogueRemainsProvable(t *testing.T) {
	raw, err := os.ReadFile("../production/overview.json")
	if err != nil {
		t.Fatal(err)
	}
	var overview struct {
		Panels []struct{ Title, Query string }
	}
	if err = json.Unmarshal(raw, &overview); err != nil {
		t.Fatal(err)
	}
	queries := []string{}
	for _, panel := range overview.Panels {
		if panel.Query != "" {
			queries = append(queries, panel.Query)
		}
	}
	if path := os.Getenv("INSIDE_HORIZON_QUERY_CATALOGUE"); path != "" {
		raw, err = os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var ownerQueries []string
		if err = json.Unmarshal(raw, &ownerQueries); err != nil {
			t.Fatal(err)
		}
		queries = append(queries, ownerQueries...)
	}
	now := time.Now().UnixMilli()
	for i, query := range queries {
		if err := proveMetrics(query, now-3600000, now-3600000, 300000, now-90*24*3600*1000); err != nil {
			t.Errorf("accepted current catalogue query %d refused: %v", i, err)
		}
	}
	if len(queries) < 20 {
		t.Fatalf("production catalogue unexpectedly incomplete: %d", len(queries))
	}
}
