package main

import (
	"strings"
	"testing"
)

func TestWindowsRealComposeCopiesSnapshotResultToOutput(t *testing.T) {
	t.Parallel()

	compose := realComposeBundleForOS("windows")
	if strings.Contains(compose, "echo {") {
		t.Fatal("Windows Compose command must not generate JSON through cmd")
	}
	if !strings.Contains(
		compose,
		`copy /Y C:\participant\participant-results.json C:\inside-output\results.json >NUL`,
	) {
		t.Fatal("Windows Compose command must copy the snapshot result into evaluator output")
	}
}

func TestUnixRealComposeCopiesSnapshotResultToOutput(t *testing.T) {
	t.Parallel()

	compose := realComposeBundleForOS("linux")
	if strings.Contains(compose, "printf") {
		t.Fatal("Unix Compose command must not generate JSON through the shell")
	}
	if !strings.Contains(
		compose,
		"cp /participant/participant-results.json /inside-output/results.json",
	) {
		t.Fatal("Unix Compose command must copy the snapshot result into evaluator output")
	}
}
