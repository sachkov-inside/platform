package evaluator

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

func TestExecuteComposeAlwaysRunsBoundedCleanup(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		mode         string
		cancelParent bool
		expectedCode string
		expectsError bool
	}{
		{name: "success", mode: "success"},
		{name: "failure", mode: "failure", expectedCode: "compose_failed"},
		{
			name:         "failure with passed output",
			mode:         "failure-with-results",
			expectedCode: "compose_failed",
		},
		{name: "timeout", mode: "wait", expectedCode: "evaluation_timeout"},
		{name: "interrupt", mode: "wait", cancelParent: true, expectsError: true},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			bundleDirectory := t.TempDir()
			commands := &recordingCommands{mode: testCase.mode}
			options := withDefaults(Options{
				Stdout:         io.Discard,
				Stderr:         io.Discard,
				CleanupTimeout: time.Second,
				commands:       commands,
			})
			manifest := testManifest()
			if testCase.mode == "wait" {
				manifest.EvaluationTimeoutSeconds = 1
			}

			ctx, cancel := context.WithCancel(context.Background())
			if testCase.cancelParent {
				cancel()
			} else {
				defer cancel()
			}
			results, err := executeCompose(
				ctx,
				options,
				bundleDirectory,
				"/participant-repository",
				manifest,
			)
			if testCase.expectsError && err == nil {
				t.Fatal("expected interrupted evaluation to fail")
			}
			if !testCase.expectsError && err != nil {
				t.Fatalf("execute Compose: %v", err)
			}
			if testCase.expectedCode != "" {
				if len(results) == 0 || results[0].Diagnostic == nil ||
					results[0].Diagnostic.Code != testCase.expectedCode {
					t.Fatalf("expected diagnostic %q, got %#v", testCase.expectedCode, results)
				}
			}
			if cleanupCalls := commands.cleanupCount(); cleanupCalls != 1 {
				t.Fatalf("expected one cleanup call, got %d", cleanupCalls)
			}
			if commands.cleanupDeadline() <= 0 || commands.cleanupDeadline() > time.Second {
				t.Fatalf("cleanup deadline is not bounded: %s", commands.cleanupDeadline())
			}
		})
	}
}

func TestExecuteComposeReportsCleanupFailure(t *testing.T) {
	t.Parallel()
	bundleDirectory := t.TempDir()
	commands := &recordingCommands{mode: "success", cleanupError: errors.New("still running")}
	options := withDefaults(Options{
		Stdout:         io.Discard,
		Stderr:         io.Discard,
		CleanupTimeout: time.Second,
		commands:       commands,
	})

	_, err := executeCompose(
		context.Background(),
		options,
		bundleDirectory,
		"/participant-repository",
		testManifest(),
	)
	if err == nil || !strings.Contains(err.Error(), "cleanup failed") {
		t.Fatalf("expected cleanup failure, got %v", err)
	}
}

func TestNormalizedResultsReplaceBundleMessages(t *testing.T) {
	t.Parallel()
	manifest := testManifest()
	results, err := normalizedResults(manifest, []contracts.ScenarioResult{
		{
			ID:                   "required-one",
			Status:               "failed",
			DurationMilliseconds: 5,
			Diagnostic: &contracts.Diagnostic{
				Code:    "scenario_failed",
				Message: "token=participant-secret raw compose output",
			},
		},
		{ID: "required-two", Status: "passed", DurationMilliseconds: 4},
	})
	if err != nil {
		t.Fatalf("normalize results: %v", err)
	}
	if strings.Contains(results[0].Diagnostic.Message, "secret") {
		t.Fatal("bundle-controlled diagnostic reached the report")
	}
}

func TestGitHubRepositorySlug(t *testing.T) {
	t.Parallel()
	for _, remote := range []string{
		"git@github.com:sachkov-inside/assignment-1.git",
		"https://github.com/sachkov-inside/assignment-1.git",
		"ssh://git@github.com/sachkov-inside/assignment-1.git",
	} {
		slug, err := githubRepositorySlug(remote)
		if err != nil || slug != "sachkov-inside/assignment-1" {
			t.Fatalf("normalize %q: slug=%q err=%v", remote, slug, err)
		}
	}
}

func TestDeviceAuthorizationRejectsEditedManifest(t *testing.T) {
	t.Parallel()
	firstTokenRequest := make(chan time.Time, 1)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/api/workshop/evaluator/device-authorizations":
			response.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(response).Encode(map[string]any{
				"schemaVersion":    contracts.DeviceAuthorizationResponseSchemaVersion,
				"deviceCode":       "device-secret",
				"userCode":         "INSIDE-1",
				"verificationUrl":  server.URL + "/verify",
				"expiresInSeconds": 600,
				"intervalSeconds":  1,
			})
		case "/api/workshop/evaluator/device-authorizations/token":
			select {
			case firstTokenRequest <- time.Now():
			default:
			}
			_ = json.NewEncoder(response).Encode(map[string]any{
				"schemaVersion":            contracts.DeviceTokenResponseSchemaVersion,
				"status":                   contracts.DeviceTokenStatusAuthorized,
				"reportToken":              "report-secret",
				"assignmentManifestSha256": strings.Repeat("f", 64),
			})
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	options := withDefaults(Options{HTTPClient: server.Client(), Stdout: io.Discard})

	started := time.Now()
	_, err := authorizeDevice(
		context.Background(),
		options,
		server.URL,
		testManifest(),
		strings.Repeat("a", 64),
	)
	if err == nil || !strings.Contains(err.Error(), "does not match") {
		t.Fatalf("expected manifest binding rejection, got %v", err)
	}
	if elapsed := (<-firstTokenRequest).Sub(started); elapsed < 900*time.Millisecond {
		t.Fatalf("first token poll ignored server interval: %s", elapsed)
	}
}

func TestDeviceAuthorizationRejectsUnknownResponseFields(t *testing.T) {
	t.Parallel()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(response).Encode(map[string]any{
			"schemaVersion":    contracts.DeviceAuthorizationResponseSchemaVersion,
			"deviceCode":       "device-secret",
			"userCode":         "INSIDE-1",
			"verificationUrl":  "https://inside.sachkov.dev/verify",
			"expiresInSeconds": 600,
			"intervalSeconds":  1,
			"unexpected":       true,
		})
	}))
	defer server.Close()
	options := withDefaults(Options{HTTPClient: server.Client(), Stdout: io.Discard})

	_, err := authorizeDevice(
		context.Background(),
		options,
		server.URL,
		testManifest(),
		strings.Repeat("a", 64),
	)
	if err == nil || !strings.Contains(err.Error(), "validate response") {
		t.Fatalf("expected schema rejection before response decode, got %v", err)
	}
}

type recordingCommands struct {
	mode          string
	cleanupError  error
	mutex         sync.Mutex
	cleanupCalls  int
	cleanupBudget time.Duration
}

func (*recordingCommands) Output(
	context.Context,
	string,
	string,
	...string,
) (string, error) {
	return "", errors.New("unexpected Output call")
}

func (command *recordingCommands) Run(
	ctx context.Context,
	_ string,
	environment []string,
	_ io.Writer,
	_ io.Writer,
	name string,
	arguments ...string,
) error {
	if name == "icacls.exe" {
		return nil
	}
	if containsArgument(arguments, "down") {
		command.mutex.Lock()
		command.cleanupCalls++
		deadline, exists := ctx.Deadline()
		if exists {
			command.cleanupBudget = time.Until(deadline)
		}
		command.mutex.Unlock()
		return command.cleanupError
	}
	switch command.mode {
	case "success", "failure-with-results":
		outputDirectory := environmentValue(environment, "INSIDE_WORKSHOP_OUTPUT_DIR")
		if environmentValue(environment, "INSIDE_WORKSHOP_REPOSITORY_DIR") != "/participant-repository" {
			return errors.New("participant repository was not passed to Compose")
		}
		if err := os.WriteFile(
			filepath.Join(outputDirectory, "results.json"),
			[]byte(`{"scenarios":[{"id":"required-one","status":"passed","durationMilliseconds":5},{"id":"required-two","status":"passed","durationMilliseconds":4}]}`),
			0o600,
		); err != nil {
			return err
		}
		if command.mode == "failure-with-results" {
			return errors.New("compose exited non-zero after writing results")
		}
		return nil
	case "failure":
		return errors.New("compose failed")
	case "wait":
		<-ctx.Done()
		return ctx.Err()
	default:
		return errors.New("unknown recording command mode")
	}
}

func (command *recordingCommands) cleanupCount() int {
	command.mutex.Lock()
	defer command.mutex.Unlock()
	return command.cleanupCalls
}

func (command *recordingCommands) cleanupDeadline() time.Duration {
	command.mutex.Lock()
	defer command.mutex.Unlock()
	return command.cleanupBudget
}

func containsArgument(arguments []string, expected string) bool {
	for _, argument := range arguments {
		if argument == expected {
			return true
		}
	}
	return false
}

func environmentValue(environment []string, name string) string {
	prefix := name + "="
	for _, value := range environment {
		if strings.HasPrefix(value, prefix) {
			return strings.TrimPrefix(value, prefix)
		}
	}
	return ""
}

func testManifest() contracts.Manifest {
	return contracts.Manifest{
		AssignmentID:             "assignment-test",
		CaseVersion:              "case-test-v1",
		EvaluatorVersion:         "0.1.0-test",
		EvaluationTimeoutSeconds: 30,
		Scenarios: []contracts.ScenarioDefinition{
			{ID: "required-one", Required: true},
			{ID: "required-two", Required: true},
			{ID: "optional-one", Required: false},
		},
		SupportedHosts: []contracts.ManifestSupportedHostsItem{
			{OS: runtime.GOOS, Arch: runtime.GOARCH},
		},
	}
}
