package evaluator

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

const (
	ProductionPlatformOrigin = "https://inside.sachkov.dev"
	defaultHTTPClientTimeout = 30 * time.Second
)

func authorizeDevice(
	ctx context.Context,
	options Options,
	platformOrigin string,
	manifest contracts.Manifest,
	manifestSHA256 string,
) (string, error) {
	request := contracts.DeviceAuthorizationRequest{
		SchemaVersion:    contracts.DeviceAuthorizationRequestSchemaVersion,
		AssignmentID:     manifest.AssignmentID,
		CaseVersion:      manifest.CaseVersion,
		EvaluatorVersion: manifest.EvaluatorVersion,
	}
	var authorization contracts.DeviceAuthorizationResponse
	if err := postJSON(
		ctx,
		options.HTTPClient,
		platformOrigin+"/api/workshop/evaluator/device-authorizations",
		"",
		request,
		contracts.DeviceAuthorizationRequestContract,
		&authorization,
		contracts.DeviceAuthorizationResponseContract,
		http.StatusCreated,
	); err != nil {
		return "", fmt.Errorf("request device authorization: %w", err)
	}
	authorizationTTL := time.Duration(authorization.ExpiresInSeconds) * time.Second
	pollInterval := time.Duration(authorization.IntervalSeconds) * time.Second
	if !sameOriginURL(authorization.VerificationURL, platformOrigin) {
		return "", errors.New("device authorization verification URL has an unexpected origin")
	}
	fmt.Fprintf(
		options.Stdout,
		"Open %s and enter code %s.\n",
		authorization.VerificationURL,
		authorization.UserCode,
	)

	deadline := time.Now().Add(authorizationTTL)
	interval := pollInterval
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			return "", errors.New("device authorization expired")
		}
		wait := interval
		if wait > remaining {
			wait = remaining
		}
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			return "", ctx.Err()
		case <-timer.C:
		}
		if time.Now().Compare(deadline) >= 0 {
			return "", errors.New("device authorization expired")
		}

		var tokenResponse contracts.DeviceTokenResponse
		err := postJSON(
			ctx,
			options.HTTPClient,
			platformOrigin+"/api/workshop/evaluator/device-authorizations/token",
			"",
			contracts.DeviceTokenRequest{
				SchemaVersion: contracts.DeviceTokenRequestSchemaVersion,
				DeviceCode:    authorization.DeviceCode,
			},
			contracts.DeviceTokenRequestContract,
			&tokenResponse,
			contracts.DeviceTokenResponseContract,
			http.StatusOK,
		)
		if err != nil {
			return "", fmt.Errorf("poll device authorization: %w", err)
		}
		switch tokenResponse.Status {
		case contracts.DeviceTokenStatusAuthorized:
			if tokenResponse.ReportToken == nil ||
				tokenResponse.AssignmentManifestSHA256 == nil ||
				*tokenResponse.AssignmentManifestSHA256 != manifestSHA256 {
				return "", errors.New("authorized device response does not match the Assignment manifest")
			}
			return *tokenResponse.ReportToken, nil
		case contracts.DeviceTokenStatusDenied:
			return "", errors.New("device authorization was denied")
		case contracts.DeviceTokenStatusExpired:
			return "", errors.New("device authorization expired")
		case contracts.DeviceTokenStatusSlowDown:
			if tokenResponse.IntervalSeconds != nil {
				interval = time.Duration(*tokenResponse.IntervalSeconds) * time.Second
			} else {
				interval += time.Duration(contracts.DeviceTokenSlowDownStepSeconds) * time.Second
			}
		case contracts.DeviceTokenStatusPending:
		default:
			return "", errors.New("device token response status is invalid")
		}
	}
}

func submitReport(
	ctx context.Context,
	options Options,
	platformOrigin string,
	reportToken string,
	report []byte,
) error {
	var response contracts.EvaluatorReportAcceptance
	if err := postJSON(
		ctx,
		options.HTTPClient,
		platformOrigin+"/api/workshop/evaluator/reports",
		reportToken,
		json.RawMessage(report),
		contracts.EvaluationReport,
		&response,
		contracts.EvaluatorReportAcceptanceContract,
		http.StatusAccepted,
	); err != nil {
		return fmt.Errorf("submit evaluation report: %w", err)
	}
	if !response.Accepted {
		return errors.New("evaluation report was not accepted")
	}
	return nil
}

func postJSON(
	ctx context.Context,
	client *http.Client,
	endpoint string,
	bearerToken string,
	payload any,
	requestContract contracts.Kind,
	destination any,
	responseContract contracts.Kind,
	expectedStatus int,
) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode request: %w", err)
	}
	if int64(len(body)) > contracts.ByteLimit(requestContract, "document") {
		return errors.New("protocol request exceeds limit")
	}
	if err := contracts.Validate(requestContract, body); err != nil {
		return fmt.Errorf("validate request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	if bearerToken != "" {
		request.Header.Set("Authorization", "Bearer "+bearerToken)
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != expectedStatus {
		return fmt.Errorf("unexpected HTTP status %d", response.StatusCode)
	}
	responseLimit := contracts.ByteLimit(responseContract, "document")
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if int64(len(responseBody)) > responseLimit {
		return errors.New("protocol response exceeds limit")
	}
	if err := contracts.Validate(responseContract, responseBody); err != nil {
		return fmt.Errorf("validate response: %w", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(responseBody))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	if err := requireJSONEnd(decoder); err != nil {
		return err
	}
	return nil
}

func sameOriginURL(rawURL, expectedOrigin string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.User != nil {
		return false
	}
	expected, err := url.Parse(expectedOrigin)
	if err != nil {
		return false
	}
	return strings.EqualFold(parsed.Scheme, expected.Scheme) &&
		strings.EqualFold(parsed.Host, expected.Host)
}

func requireJSONEnd(decoder *json.Decoder) error {
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("JSON contains trailing values")
		}
		return err
	}
	return nil
}

func expectedPlatformOrigin(testingOrigin string) (string, error) {
	if testingOrigin == "" {
		return ProductionPlatformOrigin, nil
	}
	parsed, err := url.Parse(testingOrigin)
	if err != nil || parsed.Scheme != "http" ||
		(parsed.Hostname() != "127.0.0.1" && parsed.Hostname() != "localhost") ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") {
		return "", errors.New("testing Platform origin must be direct loopback HTTP")
	}
	return strings.TrimRight(testingOrigin, "/"), nil
}

func validateBundleURL(rawURL string, testing bool) error {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.User != nil || parsed.Fragment != "" {
		return errors.New("evaluator bundle URL is invalid")
	}
	if parsed.Scheme == "https" && parsed.Hostname() != "" {
		return nil
	}
	if testing && parsed.Scheme == "http" &&
		(parsed.Hostname() == "127.0.0.1" || parsed.Hostname() == "localhost") {
		return nil
	}
	return errors.New("evaluator bundle URL must use HTTPS")
}
