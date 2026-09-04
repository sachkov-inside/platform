package contracts

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

type Kind string

const (
	CaseSpec                            Kind = "case-spec"
	AssignmentManifest                  Kind = "assignment-manifest"
	EvaluationReport                    Kind = "evaluation-report"
	SourceSnapshot                      Kind = "source-snapshot"
	DeviceAuthorizationRequestContract  Kind = "device-authorization-request"
	DeviceAuthorizationResponseContract Kind = "device-authorization-response"
	DeviceTokenRequestContract          Kind = "device-token-request"
	DeviceTokenResponseContract         Kind = "device-token-response"
	EvaluatorReportAcceptanceContract   Kind = "evaluator-report-acceptance"
)

type ValidationError struct {
	Code  string
	Cause error
}

func (e *ValidationError) Error() string {
	if e.Cause == nil {
		return e.Code
	}
	return fmt.Sprintf("%s: %v", e.Code, e.Cause)
}

func (e *ValidationError) Unwrap() error {
	return e.Cause
}

func ErrorCode(err error) string {
	var validationError *ValidationError
	if errors.As(err, &validationError) {
		return validationError.Code
	}
	return "internal_error"
}

type CaseVariant = CaseVariantsItem
type ScenarioDefinition = ManifestScenariosItem
type EvaluatorBundle = ManifestEvaluatorBundle
type Environment = ReportEnvironment
type ScenarioResult = ReportScenariosItem
type Diagnostic = ReportScenariosItemDiagnostic

var (
	compiledSchemas    map[Kind]*jsonschema.Schema
	compiledSchemasErr error
	compileSchemasOnce sync.Once
)

func ParseCase(data []byte) (Case, error) {
	if int64(len(data)) > ByteLimit(CaseSpec, "document") {
		return Case{}, reject("case_spec_oversize", nil)
	}
	var result Case
	if err := validateAndDecode(CaseSpec, data, &result); err != nil {
		return Case{}, err
	}
	if duplicateCaseScenario(result.Scenarios) || duplicateVariant(result.Variants) {
		return Case{}, reject("schema_invalid", errors.New("duplicate case identifier"))
	}
	return result, nil
}

func ParseManifest(data []byte) (Manifest, error) {
	var result Manifest
	if err := validateAndDecode(AssignmentManifest, data, &result); err != nil {
		return Manifest{}, err
	}
	if duplicateScenario(result.Scenarios) {
		return Manifest{}, reject("schema_invalid", errors.New("duplicate manifest scenario"))
	}
	return result, nil
}

func ValidateManifestBindings(caseSpec Case, manifest Manifest) error {
	if manifest.CaseID != caseSpec.CaseID ||
		manifest.CaseVersion != caseSpec.CaseVersion ||
		manifest.EvaluatorVersion != caseSpec.EvaluatorVersion {
		return reject("incompatible_version", nil)
	}

	var selected *CaseVariant
	for i := range caseSpec.Variants {
		if caseSpec.Variants[i].ID == manifest.VariantID {
			selected = &caseSpec.Variants[i]
			break
		}
	}
	if selected == nil ||
		selected.StarterArtifactSHA256 != manifest.StarterArtifactSHA256 ||
		selected.EvaluatorBundleSHA256 != manifest.EvaluatorBundle.SHA256 {
		return reject("binding_mismatch", nil)
	}
	if !sameScenarioRequirements(caseSpec.Scenarios, manifest.Scenarios) {
		return reject("binding_mismatch", nil)
	}
	if !sameHosts(
		caseSpec.SupportedHosts,
		manifest.SupportedHosts,
		func(host CaseSupportedHostsItem) string { return host.OS + "/" + host.Arch },
		func(host ManifestSupportedHostsItem) string { return host.OS + "/" + host.Arch },
	) {
		return reject("binding_mismatch", nil)
	}
	return nil
}

func ParseReport(data []byte, caseSpec Case, manifest Manifest) (Report, error) {
	if err := ValidateManifestBindings(caseSpec, manifest); err != nil {
		return Report{}, err
	}
	result, err := ParseReportForManifest(data, manifest)
	if err != nil {
		return Report{}, err
	}
	if result.CaseVersion != caseSpec.CaseVersion ||
		result.EvaluatorVersion != caseSpec.EvaluatorVersion {
		return Report{}, reject("incompatible_version", nil)
	}
	if !caseSupportsHost(caseSpec, result.Environment.OS, result.Environment.Arch) {
		return Report{}, reject("schema_invalid", errors.New("report host is not supported by case"))
	}
	return result, nil
}

func ParseReportForManifest(data []byte, manifest Manifest) (Report, error) {
	if int64(len(data)) > ByteLimit(EvaluationReport, "document") {
		return Report{}, reject("report_oversize", nil)
	}
	var result Report
	if err := validateAndDecode(EvaluationReport, data, &result); err != nil {
		return Report{}, err
	}
	if result.CaseVersion != manifest.CaseVersion ||
		result.EvaluatorVersion != manifest.EvaluatorVersion {
		return Report{}, reject("incompatible_version", nil)
	}
	if result.AssignmentID != manifest.AssignmentID ||
		result.CaseID != manifest.CaseID ||
		result.VariantID != manifest.VariantID {
		return Report{}, reject("binding_mismatch", nil)
	}
	if !ManifestSupportsHost(manifest, result.Environment.OS, result.Environment.Arch) {
		return Report{}, reject("schema_invalid", errors.New("report host is unsupported by manifest"))
	}

	declared := make(map[string]bool, len(manifest.Scenarios))
	for _, scenario := range manifest.Scenarios {
		declared[scenario.ID] = scenario.Required
	}
	seen := make(map[string]struct{}, len(result.Scenarios))
	diagnosticBytes := 0
	for _, scenario := range result.Scenarios {
		if _, exists := seen[scenario.ID]; exists {
			return Report{}, reject("duplicate_scenario", nil)
		}
		seen[scenario.ID] = struct{}{}
		if _, exists := declared[scenario.ID]; !exists {
			return Report{}, reject("unknown_scenario", nil)
		}
		if scenario.Diagnostic != nil {
			messageBytes := len([]byte(scenario.Diagnostic.Message))
			if int64(messageBytes) > ByteLimit(EvaluationReport, "diagnosticMessage") {
				return Report{}, reject("diagnostics_oversize", nil)
			}
			diagnosticBytes += messageBytes
			canonicalMessage, exists := DiagnosticMessage(scenario.Diagnostic.Code)
			if !exists || scenario.Diagnostic.Message != canonicalMessage {
				return Report{}, reject(
					"schema_invalid",
					errors.New("diagnostic message does not match its declared code"),
				)
			}
		}
	}
	if int64(diagnosticBytes) > ByteLimit(EvaluationReport, "diagnosticsTotal") {
		return Report{}, reject("diagnostics_oversize", nil)
	}
	for id, required := range declared {
		if _, exists := seen[id]; required && !exists {
			return Report{}, reject("missing_required_scenario", nil)
		}
	}

	startedAt, startErr := time.Parse(time.RFC3339Nano, result.StartedAt)
	finishedAt, finishErr := time.Parse(time.RFC3339Nano, result.FinishedAt)
	if startErr != nil || finishErr != nil || startedAt.After(finishedAt) {
		return Report{}, reject("invalid_time_range", nil)
	}
	return result, nil
}

func Validate(kind Kind, data []byte) error {
	var document any
	if err := json.Unmarshal(data, &document); err != nil {
		return reject("schema_invalid", err)
	}
	schemas, err := schemas()
	if err != nil {
		return reject("schema_invalid", err)
	}
	schema, exists := schemas[kind]
	if !exists {
		return reject("schema_invalid", fmt.Errorf("unknown contract kind %q", kind))
	}
	if err := schema.Validate(document); err != nil {
		return reject("schema_invalid", err)
	}
	return nil
}

func ByteLimit(kind Kind, name string) int64 {
	limit := contractByteLimits[kind][name]
	if limit <= 0 {
		panic(fmt.Sprintf("missing positive byte limit %s.%s", kind, name))
	}
	return limit
}

func ManifestSupportsHost(manifest Manifest, osName, architecture string) bool {
	for _, host := range manifest.SupportedHosts {
		if host.OS == osName && host.Arch == architecture {
			return true
		}
	}
	return false
}

func DiagnosticMessage(code string) (string, bool) {
	message, exists := contractDiagnosticMessages[code]
	return message, exists
}

// ManifestSHA256 returns the digest used to bind device authorization to an
// Assignment manifest. It hashes the parsed manifest's canonical JSON rather
// than checkout bytes, so whitespace and line-ending conversion cannot change
// the binding.
func ManifestSHA256(manifest Manifest) (string, error) {
	encoded, err := json.Marshal(manifest)
	if err != nil {
		return "", fmt.Errorf("encode manifest for canonicalization: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return "", fmt.Errorf("decode manifest for canonicalization: %w", err)
	}
	var canonical bytes.Buffer
	if err := writeCanonicalJSON(&canonical, value); err != nil {
		return "", err
	}
	digest := sha256.Sum256(canonical.Bytes())
	return fmt.Sprintf("%x", digest), nil
}

func writeCanonicalJSON(destination *bytes.Buffer, value any) error {
	switch typed := value.(type) {
	case nil:
		destination.WriteString("null")
	case bool:
		destination.WriteString(strconv.FormatBool(typed))
	case string:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return fmt.Errorf("encode canonical JSON string: %w", err)
		}
		destination.Write(encoded)
	case json.Number:
		integer, err := strconv.ParseInt(string(typed), 10, 64)
		if err != nil {
			return fmt.Errorf("canonical manifest contains a non-integer number: %w", err)
		}
		destination.WriteString(strconv.FormatInt(integer, 10))
	case []any:
		destination.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				destination.WriteByte(',')
			}
			if err := writeCanonicalJSON(destination, item); err != nil {
				return err
			}
		}
		destination.WriteByte(']')
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		destination.WriteByte('{')
		for index, key := range keys {
			if index > 0 {
				destination.WriteByte(',')
			}
			encodedKey, err := json.Marshal(key)
			if err != nil {
				return fmt.Errorf("encode canonical JSON property: %w", err)
			}
			destination.Write(encodedKey)
			destination.WriteByte(':')
			if err := writeCanonicalJSON(destination, typed[key]); err != nil {
				return err
			}
		}
		destination.WriteByte('}')
	default:
		return fmt.Errorf("unsupported canonical JSON value %T", value)
	}
	return nil
}

func validateAndDecode(kind Kind, data []byte, destination any) error {
	if err := Validate(kind, data); err != nil {
		return err
	}
	if err := json.Unmarshal(data, destination); err != nil {
		return reject("schema_invalid", err)
	}
	return nil
}

func schemas() (map[Kind]*jsonschema.Schema, error) {
	compileSchemasOnce.Do(func() {
		compiler := jsonschema.NewCompiler()
		compiler.DefaultDraft(jsonschema.Draft2020)
		compiler.AssertFormat()
		for location, document := range supportingSchemaDocuments {
			var schemaValue any
			if err := json.Unmarshal(document, &schemaValue); err != nil {
				compiledSchemasErr = fmt.Errorf("decode supporting schema %s: %w", location, err)
				return
			}
			if err := compiler.AddResource(location, schemaValue); err != nil {
				compiledSchemasErr = fmt.Errorf("add supporting schema %s: %w", location, err)
				return
			}
		}
		for kind, document := range schemaDocuments {
			var schemaValue any
			if err := json.Unmarshal(document, &schemaValue); err != nil {
				compiledSchemasErr = fmt.Errorf("decode embedded %s schema: %w", kind, err)
				return
			}
			location := schemaLocations[kind]
			if location == "" {
				compiledSchemasErr = fmt.Errorf("missing embedded %s schema location", kind)
				return
			}
			if err := compiler.AddResource(location, schemaValue); err != nil {
				compiledSchemasErr = fmt.Errorf("add embedded %s schema: %w", kind, err)
				return
			}
		}
		compiledSchemas = make(map[Kind]*jsonschema.Schema, len(schemaDocuments))
		for kind := range schemaDocuments {
			compiled, err := compiler.Compile(schemaLocations[kind])
			if err != nil {
				compiledSchemasErr = fmt.Errorf("compile embedded %s schema: %w", kind, err)
				return
			}
			compiledSchemas[kind] = compiled
		}
	})
	return compiledSchemas, compiledSchemasErr
}

func duplicateScenario(scenarios []ManifestScenariosItem) bool {
	return duplicateID(scenarios, func(scenario ManifestScenariosItem) string {
		return scenario.ID
	})
}

func duplicateCaseScenario(scenarios []CaseScenariosItem) bool {
	return duplicateID(scenarios, func(scenario CaseScenariosItem) string {
		return scenario.ID
	})
}

func duplicateVariant(variants []CaseVariant) bool {
	return duplicateID(variants, func(variant CaseVariant) string { return variant.ID })
}

func duplicateID[T any](values []T, id func(T) string) bool {
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		identifier := id(value)
		if _, exists := seen[identifier]; exists {
			return true
		}
		seen[identifier] = struct{}{}
	}
	return false
}

func sameScenarioRequirements(left []CaseScenariosItem, right []ManifestScenariosItem) bool {
	if len(left) != len(right) {
		return false
	}
	rightByID := make(map[string]bool, len(right))
	for _, scenario := range right {
		rightByID[scenario.ID] = scenario.Required
	}
	for _, scenario := range left {
		if required, exists := rightByID[scenario.ID]; !exists || required != scenario.Required {
			return false
		}
	}
	return true
}

func caseSupportsHost(caseSpec Case, osName, architecture string) bool {
	for _, host := range caseSpec.SupportedHosts {
		if host.OS == osName && host.Arch == architecture {
			return true
		}
	}
	return false
}

func sameHosts[Left any, Right any](
	left []Left,
	right []Right,
	leftKey func(Left) string,
	rightKey func(Right) string,
) bool {
	if len(left) != len(right) {
		return false
	}
	leftHosts := make(map[string]struct{}, len(left))
	for _, host := range left {
		leftHosts[leftKey(host)] = struct{}{}
	}
	for _, host := range right {
		if _, exists := leftHosts[rightKey(host)]; !exists {
			return false
		}
	}
	return true
}

func reject(code string, cause error) error {
	return &ValidationError{Code: strings.TrimSpace(code), Cause: cause}
}
