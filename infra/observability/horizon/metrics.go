package main

// SEC-1566-2: proof is tied to pinned VM1.154.0 eval.go, not only to MetricsQL syntax.
// Unknown/dynamic time expressions fail closed. No query rewriting or sampled rollup approximation.
import (
	"errors"
	"github.com/VictoriaMetrics/metricsql"
	"math"
	"strings"
)

var errHorizon = errors.New("query event-time horizon is not proven")

const silence int64 = 5 * 60 * 1000
const metricsHorizon int64 = 90 * 24 * 60 * 60 * 1000
const maxNodes = 4096

type proof struct {
	cutoff int64
	nodes  int
}

func proveMetrics(query string, start, end, step, cutoff int64) error {
	if len(query) > 65536 || step <= 0 || step > metricsHorizon || start > end {
		return errHorizon
	}
	expr, err := metricsql.Parse(query)
	if err != nil {
		return errHorizon
	}
	p := proof{cutoff: cutoff}
	return p.walk(expr, start, end, step)
}
func (p *proof) walk(expr metricsql.Expr, start, end, step int64) error {
	p.nodes++
	if p.nodes > maxNodes || start < p.cutoff || end < start {
		return errHorizon
	}
	switch e := expr.(type) {
	case *metricsql.NumberExpr, *metricsql.StringExpr:
		return nil
	case *metricsql.MetricExpr:
		// The no-explicit-window rollup reads max(step,window) plus the pinned5m silence interval.
		if start-step-silence < p.cutoff {
			return errHorizon
		}
		return nil
	case *metricsql.BinaryOpExpr:
		if err := p.walk(e.Left, start, end, step); err != nil {
			return err
		}
		return p.walk(e.Right, start, end, step)
	case *metricsql.FuncExpr:
		// Conservatively cover implicit subquery conversion and its alignment for arbitrary functions.
		for _, arg := range e.Args {
			if err := p.walk(arg, start-2*step-silence, end, step); err != nil {
				return err
			}
		}
		return nil
	case *metricsql.AggrFuncExpr:
		for _, arg := range e.Args {
			if err := p.walk(arg, start, end, step); err != nil {
				return err
			}
		}
		return nil
	case *metricsql.RollupExpr:
		if e.At != nil {
			at, err := atTime(e.At, start, end)
			if err != nil {
				return err
			}
			start = at
			end = at
		}
		offset := e.Offset.Duration(step)
		window := e.Window.Duration(step)
		if offset > metricsHorizon || offset < -metricsHorizon || window < 0 || window > metricsHorizon {
			return errHorizon
		}
		start -= offset
		end -= offset
		substep := e.Step.Duration(step)
		if substep < 0 || substep > metricsHorizon {
			return errHorizon
		}
		if substep == 0 {
			substep = step
		}
		// Raw rollup and subquery extensions are deliberately both covered. Extra margin can refuse
		// a boundary query; it cannot synthesize a partial aggregate or expose an expired predecessor.
		return p.walk(e.Expr, start-window-2*substep-silence, end, substep)
	default:
		return errHorizon
	}
}
func atTime(expr metricsql.Expr, start, end int64) (int64, error) {
	switch e := expr.(type) {
	case *metricsql.NumberExpr:
		if math.IsNaN(e.N) || math.IsInf(e.N, 0) || e.N < 0 || e.N > 1e12 {
			return 0, errHorizon
		}
		return int64(e.N * 1000), nil
	case *metricsql.FuncExpr:
		if len(e.Args) == 0 {
			switch strings.ToLower(e.Name) {
			case "start":
				return start, nil
			case "end":
				return end, nil
			}
		}
	}
	return 0, errHorizon
}
