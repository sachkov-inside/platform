package main

import (
	"strings"
	"testing"
)

func TestWindowsRealComposeCopiesSnapshotProbeToOutput(t *testing.T) {
	t.Parallel()

	compose := realComposeBundleForOS("windows")
	if strings.Contains(compose, "findstr") {
		t.Fatal("Windows Compose command must not parse snapshot contents through cmd")
	}
	if !strings.Contains(
		compose,
		`copy /Y C:\participant\participant-scenario.txt C:\inside-output\participant-scenario.txt >NUL`,
	) {
		t.Fatal("Windows Compose command must copy the snapshot probe into evaluator output")
	}
}
