package main

import (
	"strings"
	"testing"
)

func TestWindowsRealComposeAvoidsQuotedFindstrPhrase(t *testing.T) {
	t.Parallel()

	compose := realComposeBundleForOS("windows")
	if strings.Contains(compose, `/c:"`) {
		t.Fatal("Windows Compose command must not pass a quoted phrase through cmd /C")
	}
	if !strings.Contains(compose, `/c:participant-source-is-mounted`) {
		t.Fatal("Windows Compose command must check the unquoted mount sentinel")
	}
}
