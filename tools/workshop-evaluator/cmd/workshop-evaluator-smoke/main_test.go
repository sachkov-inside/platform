package main

import (
	"strings"
	"testing"
)

func TestWindowsRealComposeStreamsSnapshotResultToOutput(t *testing.T) {
	t.Parallel()

	compose := realComposeBundleForOS("windows")
	if strings.Contains(compose, "copy /Y") {
		t.Fatal("Windows Compose command must not preserve snapshot file permissions")
	}
	if !strings.Contains(
		compose,
		`type C:\participant\participant-results.json > C:\inside-output\results.json`,
	) {
		t.Fatal("Windows Compose command must stream the snapshot result into evaluator output")
	}
}

func TestUnixRealComposeStreamsSnapshotResultToOutput(t *testing.T) {
	t.Parallel()

	compose := realComposeBundleForOS("linux")
	if strings.Contains(compose, "cp ") {
		t.Fatal("Unix Compose command must not preserve snapshot file permissions")
	}
	if !strings.Contains(
		compose,
		"cat /participant/participant-results.json > /inside-output/results.json",
	) {
		t.Fatal("Unix Compose command must stream the snapshot result into evaluator output")
	}
}
