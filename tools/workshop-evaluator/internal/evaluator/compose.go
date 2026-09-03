package evaluator

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

const (
	maxResultsBytes           = 192 * 1024
	defaultCleanupTimeout     = 30 * time.Second
	composeStopTimeoutSeconds = "10"
)

type evaluatorOutput struct {
	Scenarios []contracts.ScenarioResult `json:"scenarios"`
}

func executeCompose(
	ctx context.Context,
	options Options,
	bundleDirectory string,
	repositoryDirectory string,
	manifest contracts.Manifest,
) (results []contracts.ScenarioResult, returnedError error) {
	outputDirectory := filepath.Join(bundleDirectory, "output")
	if err := os.Mkdir(outputDirectory, 0o700); err != nil {
		return nil, fmt.Errorf("create evaluator output directory: %w", err)
	}
	if err := prepareComposeDirectories(
		ctx,
		options,
		repositoryDirectory,
		outputDirectory,
	); err != nil {
		return nil, err
	}
	projectName := composeProjectName(manifest.AssignmentID)
	environment := []string{
		"INSIDE_WORKSHOP_OUTPUT_DIR=" + outputDirectory,
		"INSIDE_WORKSHOP_REPOSITORY_DIR=" + repositoryDirectory,
	}

	defer func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), options.CleanupTimeout)
		defer cancel()
		cleanupError := options.commands.Run(
			cleanupContext,
			bundleDirectory,
			environment,
			options.Stdout,
			options.Stderr,
			"docker",
			"compose",
			"--project-name",
			projectName,
			"--file",
			"compose.yaml",
			"down",
			"--volumes",
			"--remove-orphans",
			"--timeout",
			composeStopTimeoutSeconds,
		)
		if cleanupError != nil && returnedError == nil {
			returnedError = errors.New("bounded evaluator cleanup failed")
		}
	}()

	evaluationContext, cancel := context.WithTimeout(
		ctx,
		time.Duration(manifest.EvaluationTimeoutSeconds)*time.Second,
	)
	defer cancel()
	runError := options.commands.Run(
		evaluationContext,
		bundleDirectory,
		environment,
		options.Stdout,
		options.Stderr,
		"docker",
		"compose",
		"--project-name",
		projectName,
		"--file",
		"compose.yaml",
		"up",
		"--abort-on-container-exit",
		"--exit-code-from",
		"evaluator",
	)
	if ctx.Err() != nil {
		return nil, errors.New("evaluation interrupted")
	}
	if errors.Is(evaluationContext.Err(), context.DeadlineExceeded) {
		return failedScenarios(manifest, contracts.DiagnosticCodeEvaluationTimeout), nil
	}
	if runError != nil {
		return failedScenarios(manifest, contracts.DiagnosticCodeComposeFailed), nil
	}

	parsedResults, parseError := readScenarioResults(outputDirectory, manifest)
	if parseError == nil {
		return parsedResults, nil
	}
	return failedScenarios(manifest, contracts.DiagnosticCodeInvalidResult), nil
}

func readScenarioResults(
	outputDirectory string,
	manifest contracts.Manifest,
) ([]contracts.ScenarioResult, error) {
	contents, err := readBoundedFile(filepath.Join(outputDirectory, "results.json"), maxResultsBytes)
	if err != nil {
		return nil, err
	}
	var output evaluatorOutput
	decoder := json.NewDecoder(bytes.NewReader(contents))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&output); err != nil {
		return nil, err
	}
	if err := requireJSONEnd(decoder); err != nil {
		return nil, err
	}
	return normalizedResults(manifest, output.Scenarios)
}

func normalizedResults(
	manifest contracts.Manifest,
	results []contracts.ScenarioResult,
) ([]contracts.ScenarioResult, error) {
	if len(results) == 0 {
		return nil, errors.New("scenario result count is invalid")
	}
	declared := make(map[string]bool, len(manifest.Scenarios))
	for _, scenario := range manifest.Scenarios {
		declared[scenario.ID] = scenario.Required
	}
	seen := make(map[string]struct{}, len(results))
	normalized := make([]contracts.ScenarioResult, 0, len(results))
	for _, result := range results {
		if _, exists := seen[result.ID]; exists {
			return nil, errors.New("duplicate scenario result")
		}
		seen[result.ID] = struct{}{}
		if _, exists := declared[result.ID]; !exists {
			return nil, errors.New("unknown scenario result")
		}
		if result.DurationMilliseconds < 0 ||
			result.DurationMilliseconds > contracts.ReportScenarioDurationMaximumMilliseconds {
			return nil, errors.New("scenario duration is invalid")
		}
		switch result.Status {
		case contracts.ReportScenarioStatusPassed:
			if result.Diagnostic != nil {
				return nil, errors.New("passed scenario has a diagnostic")
			}
		case contracts.ReportScenarioStatusFailed:
			if result.Diagnostic == nil {
				return nil, errors.New("failed scenario has no diagnostic")
			}
			message, exists := contracts.DiagnosticMessage(result.Diagnostic.Code)
			if !exists {
				return nil, errors.New("scenario diagnostic is unknown")
			}
			result.Diagnostic.Message = message
		default:
			return nil, errors.New("scenario status is invalid")
		}
		normalized = append(normalized, result)
	}
	for id, required := range declared {
		if _, exists := seen[id]; required && !exists {
			return nil, errors.New("required scenario result is missing")
		}
	}
	return normalized, nil
}

func failedScenarios(manifest contracts.Manifest, code string) []contracts.ScenarioResult {
	message, exists := contracts.DiagnosticMessage(code)
	if !exists {
		panic("unknown evaluator diagnostic code: " + code)
	}
	results := make([]contracts.ScenarioResult, 0, len(manifest.Scenarios))
	for _, scenario := range manifest.Scenarios {
		results = append(results, contracts.ScenarioResult{
			ID:                   scenario.ID,
			Status:               contracts.ReportScenarioStatusFailed,
			DurationMilliseconds: 0,
			Diagnostic: &contracts.Diagnostic{
				Code:    code,
				Message: message,
			},
		})
	}
	return results
}

func composeProjectName(assignmentID string) string {
	digest := sha256.Sum256([]byte(assignmentID))
	return "inside-workshop-" + hex.EncodeToString(digest[:6])
}

func requiredScenarioFailed(
	manifest contracts.Manifest,
	results []contracts.ScenarioResult,
) bool {
	required := make(map[string]bool, len(manifest.Scenarios))
	for _, scenario := range manifest.Scenarios {
		required[scenario.ID] = scenario.Required
	}
	for _, result := range results {
		if required[result.ID] && result.Status == contracts.ReportScenarioStatusFailed {
			return true
		}
	}
	return false
}
