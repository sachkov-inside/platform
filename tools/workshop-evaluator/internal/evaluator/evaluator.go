package evaluator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

var ErrScenariosFailed = errors.New("one or more required scenarios failed")

type Options struct {
	WorkDirectory         string
	ManifestPath          string
	TestingPlatformOrigin string
	Version               string
	HTTPClient            *http.Client
	Stdout                io.Writer
	Stderr                io.Writer
	CleanupTimeout        time.Duration
	commands              commands
}

func Run(ctx context.Context, options Options) (runErr error) {
	options = withDefaults(options)
	root, err := repositoryRoot(ctx, options)
	if err != nil {
		return err
	}
	manifestPath := options.ManifestPath
	if manifestPath == "" {
		manifestPath = filepath.Join(root, ".inside", "assignment.json")
	} else if !filepath.IsAbs(manifestPath) {
		manifestPath = filepath.Join(options.WorkDirectory, manifestPath)
	}
	manifestBytes, err := readBoundedFile(
		manifestPath,
		contracts.ByteLimit(contracts.AssignmentManifest, "document"),
	)
	if err != nil {
		return fmt.Errorf("read assignment manifest: %w", err)
	}
	manifest, err := contracts.ParseManifest(manifestBytes)
	if err != nil {
		return fmt.Errorf("validate assignment manifest: %w", err)
	}

	platformOrigin, err := expectedPlatformOrigin(options.TestingPlatformOrigin)
	if err != nil {
		return err
	}
	if manifest.PlatformOrigin != platformOrigin {
		return errors.New("assignment manifest Platform origin does not match this evaluator")
	}
	if manifest.EvaluatorVersion != options.Version {
		return fmt.Errorf(
			"assignment requires evaluator %q, current evaluator is %q",
			manifest.EvaluatorVersion,
			options.Version,
		)
	}
	if err := validateBundleURL(manifest.EvaluatorBundle.URL, options.TestingPlatformOrigin != ""); err != nil {
		return err
	}

	commitSHA, environment, err := preflight(ctx, options, root, manifest)
	if err != nil {
		return err
	}
	snapshotDirectory, removeSnapshot, err := createRepositorySnapshot(
		ctx,
		options,
		root,
		commitSHA,
	)
	if err != nil {
		return err
	}
	defer func() {
		if cleanupErr := removeSnapshot(); cleanupErr != nil {
			runErr = errors.Join(runErr, cleanupErr)
		}
	}()
	manifest, manifestDigest, err := bindSnapshotManifest(snapshotDirectory, manifest)
	if err != nil {
		return err
	}
	if !contracts.ManifestSupportsHost(manifest, runtime.GOOS, runtime.GOARCH) {
		return fmt.Errorf("unsupported host %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	reportToken, err := authorizeDevice(
		ctx,
		options,
		platformOrigin,
		manifest,
		manifestDigest,
	)
	if err != nil {
		return err
	}
	defer func() { reportToken = "" }()

	bundleDirectory, removeBundle, err := downloadBundle(
		ctx,
		options.HTTPClient,
		manifest.EvaluatorBundle.URL,
		manifest.EvaluatorBundle.SHA256,
		manifest.EvaluatorBundle.MaxBytes,
	)
	if err != nil {
		return err
	}
	defer removeBundle()

	startedAt := time.Now().UTC()
	scenarios, err := executeCompose(ctx, options, bundleDirectory, snapshotDirectory, manifest)
	finishedAt := time.Now().UTC()
	if err != nil {
		return err
	}
	report := contracts.Report{
		SchemaVersion:    contracts.ReportSchemaVersion,
		ReportVersion:    contracts.ReportVersion,
		AssignmentID:     manifest.AssignmentID,
		CaseID:           manifest.CaseID,
		CaseVersion:      manifest.CaseVersion,
		VariantID:        manifest.VariantID,
		EvaluatorVersion: manifest.EvaluatorVersion,
		CommitSHA:        commitSHA,
		Environment:      environment,
		StartedAt:        startedAt.Format(time.RFC3339Nano),
		FinishedAt:       finishedAt.Format(time.RFC3339Nano),
		Scenarios:        scenarios,
	}
	reportBytes, err := json.Marshal(report)
	if err != nil {
		return fmt.Errorf("encode evaluation report: %w", err)
	}
	if _, err := contracts.ParseReportForManifest(reportBytes, manifest); err != nil {
		return fmt.Errorf("validate evaluation report: %w", err)
	}
	if err := submitReport(ctx, options, platformOrigin, reportToken, reportBytes); err != nil {
		return err
	}
	reportToken = ""
	if requiredScenarioFailed(manifest, scenarios) {
		return ErrScenariosFailed
	}
	fmt.Fprintln(options.Stdout, "Evaluation report accepted.")
	return nil
}

func withDefaults(options Options) Options {
	if options.WorkDirectory == "" {
		options.WorkDirectory = "."
	}
	if options.Version == "" {
		options.Version = "dev"
	}
	if options.HTTPClient == nil {
		options.HTTPClient = &http.Client{Timeout: defaultHTTPClientTimeout}
	}
	if options.Stdout == nil {
		options.Stdout = os.Stdout
	}
	if options.Stderr == nil {
		options.Stderr = os.Stderr
	}
	if options.CleanupTimeout <= 0 {
		options.CleanupTimeout = defaultCleanupTimeout
	}
	if options.commands == nil {
		options.commands = systemCommands{}
	}
	return options
}
