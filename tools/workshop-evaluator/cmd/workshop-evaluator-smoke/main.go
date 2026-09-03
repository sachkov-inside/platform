package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

const (
	reportToken          = "smoke-report-token-secret"
	deviceCode           = "smoke-device-code-secret"
	commitSHA            = "1111111111111111111111111111111111111111"
	nativeSmokeTimeout   = 3 * time.Minute
	deviceCodeTTLSeconds = 10 * 60
	devicePollSeconds    = 1
	participantBlobSHA   = "2222222222222222222222222222222222222222"
	manifestBlobSHA      = "3333333333333333333333333333333333333333"
)

func main() {
	tool := strings.TrimSuffix(filepath.Base(os.Args[0]), filepath.Ext(os.Args[0]))
	if tool == "git" || tool == "docker" {
		os.Exit(runFakeTool(tool, os.Args[1:]))
	}
	os.Exit(runSmoke())
}

func runSmoke() int {
	flags := flag.NewFlagSet("workshop-evaluator-smoke", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	binaryFlag := flags.String("binary", "", "native workshop-evaluator binary")
	version := flags.String("version", "", "expected pinned evaluator version")
	realCompose := flags.Bool("real-compose", false, "run the pinned synthetic bundle in Docker")
	if err := flags.Parse(os.Args[1:]); err != nil || *binaryFlag == "" || *version == "" {
		fmt.Fprintln(os.Stderr, "--binary and --version are required")
		return 2
	}
	binary, err := filepath.Abs(*binaryFlag)
	if err != nil {
		return fail("resolve evaluator binary", err)
	}
	if err := verifyVersion(binary, *version); err != nil {
		return fail("verify evaluator version", err)
	}

	root, err := os.MkdirTemp("", "inside-workshop-native-smoke-*")
	if err != nil {
		return fail("create smoke directory", err)
	}
	defer os.RemoveAll(root)
	toolsDirectory := filepath.Join(root, "bin")
	if err := os.MkdirAll(toolsDirectory, 0o700); err != nil {
		return fail("create fake tools directory", err)
	}
	if err := installFakeTools(toolsDirectory, *realCompose); err != nil {
		return fail("install fake tools", err)
	}
	eventsFilename := filepath.Join(root, "events.txt")
	if err := os.Setenv("INSIDE_WORKSHOP_SMOKE_ROOT", root); err != nil {
		return fail("configure smoke root", err)
	}
	if err := os.Setenv("INSIDE_WORKSHOP_SMOKE_EVENTS", eventsFilename); err != nil {
		return fail("configure smoke events", err)
	}
	if err := os.Setenv("PATH", toolsDirectory+string(os.PathListSeparator)+os.Getenv("PATH")); err != nil {
		return fail("configure smoke PATH", err)
	}

	bundle, err := syntheticBundle(*realCompose)
	if err != nil {
		return fail("build synthetic bundle", err)
	}
	state := &serverState{bundle: bundle}
	server := httptest.NewServer(http.HandlerFunc(state.handle))
	defer server.Close()
	manifest := syntheticManifest(server.URL, *version, bundle)
	state.manifest = manifest
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return fail("encode smoke manifest", err)
	}
	manifestDigest, err := contracts.ManifestSHA256(manifest)
	if err != nil {
		return fail("canonicalize smoke manifest", err)
	}
	state.manifestSHA256 = manifestDigest
	manifestDirectory := filepath.Join(root, ".inside")
	if err := os.MkdirAll(manifestDirectory, 0o700); err != nil {
		return fail("create manifest directory", err)
	}
	if err := os.WriteFile(
		filepath.Join(root, "participant-scenario.txt"),
		[]byte("participant source is mounted\n"),
		0o600,
	); err != nil {
		return fail("write participant source fixture", err)
	}
	if err := os.WriteFile(filepath.Join(manifestDirectory, "assignment.json"), manifestBytes, 0o600); err != nil {
		return fail("write smoke manifest", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), nativeSmokeTimeout)
	defer cancel()
	command := exec.CommandContext(ctx, binary, "--testing-platform-origin", server.URL)
	command.Dir = root
	var output bytes.Buffer
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Run(); err != nil {
		return fail("run native evaluator", fmt.Errorf("%w\n%s", err, output.String()))
	}
	if strings.Contains(output.String(), reportToken) || strings.Contains(output.String(), deviceCode) {
		return fail("inspect evaluator output", errors.New("sensitive protocol value reached output"))
	}
	if state.reportCount() != 1 {
		return fail("inspect ingress", fmt.Errorf("expected one report, got %d", state.reportCount()))
	}
	if *realCompose {
		if err := verifyRealComposeCleanup(root); err != nil {
			return fail("inspect real Compose cleanup", err)
		}
	} else {
		events, err := os.ReadFile(eventsFilename)
		if err != nil {
			return fail("read cleanup evidence", err)
		}
		if string(events) != "down\n" {
			return fail("inspect cleanup evidence", fmt.Errorf("unexpected events %q", events))
		}
	}
	fmt.Printf(
		"Native evaluator smoke passed on %s/%s with one schema-valid report and bounded cleanup.\n",
		runtime.GOOS,
		runtime.GOARCH,
	)
	return 0
}

type serverState struct {
	bundle         []byte
	manifest       contracts.Manifest
	manifestSHA256 string
	mutex          sync.Mutex
	reports        int
}

func (state *serverState) handle(response http.ResponseWriter, request *http.Request) {
	switch request.URL.Path {
	case "/evaluator.tar.gz":
		if request.Method != http.MethodGet {
			http.Error(response, "method", http.StatusMethodNotAllowed)
			return
		}
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write(state.bundle)
	case "/api/workshop/evaluator/device-authorizations":
		if request.Method != http.MethodPost || !validDeviceAuthorization(request.Body) {
			http.Error(response, "request", http.StatusBadRequest)
			return
		}
		writeJSON(response, http.StatusCreated, map[string]any{
			"schemaVersion":    contracts.DeviceAuthorizationResponseSchemaVersion,
			"deviceCode":       deviceCode,
			"userCode":         "INSIDE-1",
			"verificationUrl":  requestOrigin(request) + "/workshop/evaluator/authorize",
			"expiresInSeconds": deviceCodeTTLSeconds,
			"intervalSeconds":  devicePollSeconds,
		})
	case "/api/workshop/evaluator/device-authorizations/token":
		if request.Method != http.MethodPost || !validDeviceTokenRequest(request.Body) {
			http.Error(response, "request", http.StatusBadRequest)
			return
		}
		writeJSON(response, http.StatusOK, map[string]any{
			"schemaVersion":            contracts.DeviceTokenResponseSchemaVersion,
			"status":                   contracts.DeviceTokenStatusAuthorized,
			"reportToken":              reportToken,
			"assignmentManifestSha256": state.manifestSHA256,
		})
	case "/api/workshop/evaluator/reports":
		if request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer "+reportToken {
			http.Error(response, "unauthorized", http.StatusUnauthorized)
			return
		}
		maxReportBytes := contracts.ByteLimit(contracts.EvaluationReport, "document")
		report, err := io.ReadAll(io.LimitReader(request.Body, maxReportBytes+1))
		if err != nil || int64(len(report)) > maxReportBytes {
			http.Error(response, "report", http.StatusBadRequest)
			return
		}
		parsed, err := contracts.ParseReportForManifest(report, state.manifest)
		if err != nil || parsed.CommitSHA != commitSHA {
			http.Error(response, "report", http.StatusBadRequest)
			return
		}
		state.mutex.Lock()
		state.reports++
		state.mutex.Unlock()
		writeJSON(response, http.StatusAccepted, map[string]any{
			"schemaVersion": contracts.EvaluatorReportAcceptanceSchemaVersion,
			"accepted":      true,
		})
	default:
		http.NotFound(response, request)
	}
}

func (state *serverState) reportCount() int {
	state.mutex.Lock()
	defer state.mutex.Unlock()
	return state.reports
}

func validDeviceAuthorization(body io.Reader) bool {
	var request contracts.DeviceAuthorizationRequest
	return decodeContract(body, contracts.DeviceAuthorizationRequestContract, &request) &&
		request.AssignmentID == "assignment-native-smoke" &&
		request.CaseVersion == "native-smoke-case-v1" &&
		request.EvaluatorVersion != ""
}

func validDeviceTokenRequest(body io.Reader) bool {
	var request contracts.DeviceTokenRequest
	return decodeContract(body, contracts.DeviceTokenRequestContract, &request) &&
		request.DeviceCode == deviceCode
}

func decodeContract(body io.Reader, kind contracts.Kind, destination any) bool {
	limit := contracts.ByteLimit(kind, "document")
	contents, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil || int64(len(contents)) > limit || contracts.Validate(kind, contents) != nil {
		return false
	}
	return json.Unmarshal(contents, destination) == nil
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json")
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func requestOrigin(request *http.Request) string {
	return "http://" + request.Host
}

func syntheticManifest(origin, version string, bundle []byte) contracts.Manifest {
	digest := sha256.Sum256(bundle)
	return contracts.Manifest{
		SchemaVersion:         "inside.workshop.assignment-manifest.v1",
		PlatformOrigin:        origin,
		AssignmentID:          "assignment-native-smoke",
		CaseID:                "native-smoke-case",
		CaseVersion:           "native-smoke-case-v1",
		VariantID:             "synthetic",
		EvaluatorVersion:      version,
		RepositorySlug:        "sachkov-inside/assignment-native-smoke",
		DefaultBranch:         "main",
		StarterArtifactSHA256: strings.Repeat("a", 64),
		EvaluatorBundle: contracts.EvaluatorBundle{
			URL:      origin + "/evaluator.tar.gz",
			SHA256:   hex.EncodeToString(digest[:]),
			MaxBytes: int64(len(bundle)),
		},
		Scenarios: []contracts.ScenarioDefinition{
			{ID: "native-process", Required: true},
			{ID: "bound-report", Required: true},
		},
		SupportedHosts: []contracts.ManifestSupportedHostsItem{
			{OS: runtime.GOOS, Arch: runtime.GOARCH},
		},
		EvaluationTimeoutSeconds: 120,
	}
}

func syntheticBundle(realCompose bool) ([]byte, error) {
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	archive := tar.NewWriter(gzipWriter)
	contents := []byte("services:\n  evaluator:\n    image: synthetic-native-smoke\n")
	if realCompose {
		contents = []byte(realComposeBundle())
	}
	if err := archive.WriteHeader(&tar.Header{
		Name:     "compose.yaml",
		Mode:     0o600,
		Size:     int64(len(contents)),
		Typeflag: tar.TypeReg,
	}); err != nil {
		return nil, err
	}
	if _, err := archive.Write(contents); err != nil {
		return nil, err
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	if err := gzipWriter.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func realComposeBundle() string {
	if runtime.GOOS == "windows" {
		return `services:
  evaluator:
    image: mcr.microsoft.com/windows/nanoserver:ltsc2025@sha256:4249ba8974b8996812967d35c46c4e66afd771f929f96917ef6f7592a55edb12
    command:
      - cmd
      - /S
      - /C
      - >-
        findstr /x /c:"participant source is mounted" C:\participant\participant-scenario.txt >NUL &&
        (echo {"scenarios":[{"id":"native-process","status":"passed","durationMilliseconds":1},{"id":"bound-report","status":"passed","durationMilliseconds":1}]}) > C:\inside-output\results.json
    volumes:
      - type: bind
        source: ${INSIDE_WORKSHOP_REPOSITORY_DIR}
        target: C:\participant
        read_only: true
      - type: bind
        source: ${INSIDE_WORKSHOP_OUTPUT_DIR}
        target: C:\inside-output
`
	}
	return `services:
  evaluator:
    image: busybox:1.37.0@sha256:9db7b59979c38555a39def84a31fb98b5296952f9e3afd4f6f11f05b07adfab0
    command:
      - sh
      - -ec
      - >-
        grep -qx 'participant source is mounted' /participant/participant-scenario.txt &&
        printf '%s' '{"scenarios":[{"id":"native-process","status":"passed","durationMilliseconds":1},{"id":"bound-report","status":"passed","durationMilliseconds":1}]}' > /inside-output/results.json
    volumes:
      - type: bind
        source: ${INSIDE_WORKSHOP_REPOSITORY_DIR}
        target: /participant
        read_only: true
      - type: bind
        source: ${INSIDE_WORKSHOP_OUTPUT_DIR}
        target: /inside-output
`
}

func installFakeTools(directory string, realCompose bool) error {
	currentExecutable, err := os.Executable()
	if err != nil {
		return err
	}
	contents, err := os.ReadFile(currentExecutable)
	if err != nil {
		return err
	}
	extension := ""
	if runtime.GOOS == "windows" {
		extension = ".exe"
	}
	names := []string{"git", "docker"}
	if realCompose {
		names = []string{"git"}
	}
	for _, name := range names {
		filename := filepath.Join(directory, name+extension)
		if err := os.WriteFile(filename, contents, 0o700); err != nil {
			return err
		}
		if err := os.Chmod(filename, 0o700); err != nil {
			return err
		}
	}
	return nil
}

func verifyRealComposeCleanup(root string) error {
	digest := sha256.Sum256([]byte("assignment-native-smoke"))
	projectName := "inside-workshop-" + hex.EncodeToString(digest[:6])
	command := exec.Command(
		"docker",
		"ps",
		"--all",
		"--quiet",
		"--filter",
		"label=com.docker.compose.project="+projectName,
	)
	command.Dir = root
	output, err := command.Output()
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(output)) != "" {
		return errors.New("evaluator Compose containers remain after cleanup")
	}
	return nil
}

func runFakeTool(tool string, arguments []string) int {
	switch tool {
	case "git":
		return runFakeGit(arguments)
	case "docker":
		return runFakeDocker(arguments)
	default:
		return 2
	}
}

func runFakeGit(arguments []string) int {
	if len(arguments) > 0 && arguments[0] == "--no-replace-objects" {
		arguments = arguments[1:]
	}
	if len(arguments) >= 2 && arguments[0] == "-c" &&
		strings.HasPrefix(arguments[1], "core.hooksPath=") {
		arguments = arguments[2:]
	}
	joined := strings.Join(arguments, " ")
	switch {
	case len(arguments) == 6 &&
		arguments[0] == "worktree" &&
		arguments[1] == "add" &&
		arguments[2] == "--no-checkout" &&
		arguments[3] == "--detach" &&
		arguments[5] == commitSHA:
		snapshotDirectory := arguments[4]
		if err := os.MkdirAll(snapshotDirectory, 0o700); err != nil {
			return 1
		}
	case len(arguments) == 4 &&
		arguments[0] == "worktree" &&
		arguments[1] == "remove" &&
		arguments[2] == "--force":
		if err := os.RemoveAll(arguments[3]); err != nil {
			return 1
		}
	case joined == "rev-parse --show-toplevel":
		fmt.Fprintln(os.Stdout, os.Getenv("INSIDE_WORKSHOP_SMOKE_ROOT"))
	case joined == "remote get-url origin":
		fmt.Fprintln(os.Stdout, "git@github.com:sachkov-inside/assignment-native-smoke.git")
	case joined == "rev-parse HEAD":
		fmt.Fprintln(os.Stdout, commitSHA)
	case joined == "ls-tree -r -z --full-tree "+commitSHA:
		fmt.Fprintf(
			os.Stdout,
			"100644 blob %s\t.inside/assignment.json%c"+
				"100644 blob %s\tparticipant-scenario.txt%c",
			manifestBlobSHA,
			0,
			participantBlobSHA,
			0,
		)
	case joined == "cat-file blob "+manifestBlobSHA:
		contents, err := os.ReadFile(filepath.Join(
			os.Getenv("INSIDE_WORKSHOP_SMOKE_ROOT"),
			".inside",
			"assignment.json",
		))
		if err != nil {
			return 1
		}
		if _, err := os.Stdout.Write(contents); err != nil {
			return 1
		}
	case joined == "cat-file blob "+participantBlobSHA:
		fmt.Fprint(os.Stdout, "participant source is mounted\n")
	case joined == "ls-remote --exit-code origin refs/heads/main":
		fmt.Fprintf(os.Stdout, "%s\trefs/heads/main\n", commitSHA)
	default:
		return 2
	}
	return 0
}

func runFakeDocker(arguments []string) int {
	joined := strings.Join(arguments, " ")
	if joined == "version --format {{.Server.Version}}" {
		fmt.Fprintln(os.Stdout, "29.0.0-smoke")
		return 0
	}
	if joined == "compose version --short" {
		fmt.Fprintln(os.Stdout, "2.40.0-smoke")
		return 0
	}
	if containsArgument(arguments, "up") {
		outputDirectory := os.Getenv("INSIDE_WORKSHOP_OUTPUT_DIR")
		repositoryDirectory := os.Getenv("INSIDE_WORKSHOP_REPOSITORY_DIR")
		participantSource, err := os.ReadFile(filepath.Join(repositoryDirectory, "participant-scenario.txt"))
		if err != nil || string(participantSource) != "participant source is mounted\n" {
			fmt.Fprintln(os.Stderr, "participant repository is not available to evaluator Compose")
			return 1
		}
		result := []byte(`{"scenarios":[{"id":"native-process","status":"passed","durationMilliseconds":1},{"id":"bound-report","status":"passed","durationMilliseconds":1}]}`)
		if err := os.WriteFile(filepath.Join(outputDirectory, "results.json"), result, 0o600); err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		return 0
	}
	if containsArgument(arguments, "down") {
		file, err := os.OpenFile(
			os.Getenv("INSIDE_WORKSHOP_SMOKE_EVENTS"),
			os.O_CREATE|os.O_APPEND|os.O_WRONLY,
			0o600,
		)
		if err != nil {
			return 1
		}
		defer file.Close()
		if _, err := file.WriteString("down\n"); err != nil {
			return 1
		}
		return 0
	}
	return 2
}

func containsArgument(arguments []string, expected string) bool {
	for _, argument := range arguments {
		if argument == expected {
			return true
		}
	}
	return false
}

func verifyVersion(binary, expected string) error {
	command := exec.Command(binary, "--version")
	output, err := command.Output()
	if err != nil {
		return err
	}
	if strings.TrimSpace(string(output)) != expected {
		return fmt.Errorf("expected %q, got %q", expected, strings.TrimSpace(string(output)))
	}
	return nil
}

func fail(action string, err error) int {
	fmt.Fprintf(os.Stderr, "%s: %v\n", action, err)
	return 1
}
