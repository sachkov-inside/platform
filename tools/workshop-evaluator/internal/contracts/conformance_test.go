package contracts_test

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

type corpusIndex struct {
	Cases []corpusCase `json:"cases"`
}

type corpusCase struct {
	Name               string         `json:"name"`
	Target             contracts.Kind `json:"target"`
	Document           string         `json:"document"`
	CaseSpec           string         `json:"caseSpec"`
	AssignmentManifest string         `json:"assignmentManifest"`
	Valid              bool           `json:"valid"`
	ExpectedCode       string         `json:"expectedCode"`
	TrailingWhitespace int            `json:"trailingWhitespaceBytes"`
}

func TestSharedConformanceCorpus(t *testing.T) {
	t.Parallel()

	root := contractRoot(t)
	var index corpusIndex
	readJSON(t, filepath.Join(root, "conformance", "index.json"), &index)
	if len(index.Cases) == 0 {
		t.Fatal("conformance corpus is empty")
	}

	for _, testCase := range index.Cases {
		t.Run(testCase.Name, func(t *testing.T) {
			t.Parallel()
			err := validateCorpusCase(t, root, testCase)
			if testCase.Valid && err != nil {
				t.Fatalf("expected valid document: %v", err)
			}
			if !testCase.Valid {
				if err == nil {
					t.Fatalf("expected rejection %q", testCase.ExpectedCode)
				}
				if code := contracts.ErrorCode(err); code != testCase.ExpectedCode {
					t.Fatalf("expected rejection %q, got %q: %v", testCase.ExpectedCode, code, err)
				}
			}
		})
	}
}

func validateCorpusCase(t *testing.T, root string, testCase corpusCase) error {
	t.Helper()
	document := readCorpusFile(t, root, testCase.Document)
	if testCase.TrailingWhitespace > 0 {
		document = append(document, bytes.Repeat([]byte(" "), testCase.TrailingWhitespace)...)
	}
	switch testCase.Target {
	case contracts.CaseSpec:
		_, err := contracts.ParseCase(document)
		return err
	case contracts.SourceSnapshot:
		return contracts.Validate(contracts.SourceSnapshot, document)
	case contracts.AssignmentManifest:
		caseSpec := parseCaseContext(t, root, testCase.CaseSpec)
		manifest, err := contracts.ParseManifest(document)
		if err != nil {
			return err
		}
		return contracts.ValidateManifestBindings(caseSpec, manifest)
	case contracts.EvaluationReport:
		caseSpec := parseCaseContext(t, root, testCase.CaseSpec)
		manifest := parseManifestContext(t, root, testCase.AssignmentManifest)
		if err := contracts.ValidateManifestBindings(caseSpec, manifest); err != nil {
			t.Fatalf("invalid manifest context: %v", err)
		}
		_, err := contracts.ParseReport(document, caseSpec, manifest)
		return err
	default:
		t.Fatalf("unknown contract target %q", testCase.Target)
		return nil
	}
}

func parseCaseContext(t *testing.T, root, filename string) contracts.Case {
	t.Helper()
	caseSpec, err := contracts.ParseCase(readCorpusFile(t, root, filename))
	if err != nil {
		t.Fatalf("invalid case context: %v", err)
	}
	return caseSpec
}

func parseManifestContext(t *testing.T, root, filename string) contracts.Manifest {
	t.Helper()
	manifest, err := contracts.ParseManifest(readCorpusFile(t, root, filename))
	if err != nil {
		t.Fatalf("invalid manifest context: %v", err)
	}
	return manifest
}

func readCorpusFile(t *testing.T, root, relativePath string) []byte {
	t.Helper()
	if relativePath == "" {
		t.Fatal("missing conformance context path")
	}
	corpusRoot := filepath.Join(root, "conformance")
	filename := filepath.Clean(filepath.Join(corpusRoot, relativePath))
	relative, err := filepath.Rel(corpusRoot, filename)
	if err != nil || relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) ||
		filepath.IsAbs(relative) {
		t.Fatalf("conformance path escapes corpus: %s", relativePath)
	}
	contents, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("read %s: %v", relativePath, err)
	}
	return contents
}

func readJSON(t *testing.T, filename string, destination any) {
	t.Helper()
	contents, err := os.ReadFile(filename)
	if err != nil {
		t.Fatalf("read %s: %v", filename, err)
	}
	if err := json.Unmarshal(contents, destination); err != nil {
		t.Fatalf("decode %s: %v", filename, err)
	}
}

func contractRoot(t *testing.T) string {
	t.Helper()
	_, sourceFilename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot resolve conformance test source path")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(sourceFilename), "../../../../contracts/workshop"))
}
