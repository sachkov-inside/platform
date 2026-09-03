package contracts_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

func TestManifestDigestIgnoresFormattingAndLineEndings(t *testing.T) {
	root := contractRoot(t)
	contents, err := os.ReadFile(filepath.Join(
		root,
		"conformance",
		"documents",
		"assignment-manifest.valid.json",
	))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := contracts.ParseManifest(contents)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := contracts.ManifestSHA256(manifest)
	if err != nil {
		t.Fatal(err)
	}
	variants := [][]byte{
		[]byte(strings.ReplaceAll(string(contents), "\n", "\r\n")),
		append([]byte(" \t\r\n"), contents...),
	}
	for _, variant := range variants {
		parsed, parseErr := contracts.ParseManifest(variant)
		if parseErr != nil {
			t.Fatalf("parse formatting variant: %v", parseErr)
		}
		actual, digestErr := contracts.ManifestSHA256(parsed)
		if digestErr != nil {
			t.Fatalf("digest formatting variant: %v", digestErr)
		}
		if actual != expected {
			t.Fatalf("formatting changed manifest digest: %s != %s", actual, expected)
		}
	}
}

func TestManifestDigestChangesWithSemanticContent(t *testing.T) {
	root := contractRoot(t)
	contents, err := os.ReadFile(filepath.Join(
		root,
		"conformance",
		"documents",
		"assignment-manifest.valid.json",
	))
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := contracts.ParseManifest(contents)
	if err != nil {
		t.Fatal(err)
	}
	original, err := contracts.ManifestSHA256(manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifest.AssignmentID = "assignment-fixture-2"
	changed, err := contracts.ManifestSHA256(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if changed == original {
		t.Fatal("semantic Assignment manifest change did not change its digest")
	}
}
