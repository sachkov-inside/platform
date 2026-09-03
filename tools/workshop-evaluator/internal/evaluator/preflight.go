package evaluator

import (
	"context"
	"encoding/hex"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

func repositoryRoot(ctx context.Context, options Options) (string, error) {
	output, err := options.commands.Output(
		ctx,
		options.WorkDirectory,
		"git",
		"rev-parse",
		"--show-toplevel",
	)
	if err != nil {
		return "", errors.New("Git repository preflight failed")
	}
	root := strings.TrimSpace(output)
	if root == "" || !filepath.IsAbs(root) {
		return "", errors.New("Git repository root is invalid")
	}
	return root, nil
}

func preflight(
	ctx context.Context,
	options Options,
	repositoryDirectory string,
	manifest contracts.Manifest,
) (string, contracts.Environment, error) {
	remoteOutput, err := options.commands.Output(
		ctx,
		repositoryDirectory,
		"git",
		"remote",
		"get-url",
		"origin",
	)
	if err != nil {
		return "", contracts.Environment{}, errors.New("Git origin preflight failed")
	}
	remoteSlug, err := githubRepositorySlug(strings.TrimSpace(remoteOutput))
	if err != nil || !strings.EqualFold(remoteSlug, manifest.RepositorySlug) {
		return "", contracts.Environment{}, errors.New("Git origin does not match the Assignment")
	}
	localOutput, err := options.commands.Output(
		ctx,
		repositoryDirectory,
		"git",
		"rev-parse",
		"HEAD",
	)
	if err != nil {
		return "", contracts.Environment{}, errors.New("local Git HEAD preflight failed")
	}
	localSHA := strings.TrimSpace(localOutput)
	remoteOutput, err = options.commands.Output(
		ctx,
		repositoryDirectory,
		"git",
		"ls-remote",
		"--exit-code",
		"origin",
		"refs/heads/"+manifest.DefaultBranch,
	)
	if err != nil {
		return "", contracts.Environment{}, errors.New("pushed Git HEAD preflight failed")
	}
	remoteFields := strings.Fields(remoteOutput)
	if len(remoteFields) != 2 || localSHA != remoteFields[0] {
		return "", contracts.Environment{}, errors.New("local HEAD is not the pushed default-branch HEAD")
	}
	if len(localSHA) != 40 {
		return "", contracts.Environment{}, errors.New("Git HEAD is not a full commit SHA")
	}
	if _, err := hex.DecodeString(localSHA); err != nil {
		return "", contracts.Environment{}, errors.New("Git HEAD is not a full commit SHA")
	}

	dockerVersion, err := options.commands.Output(
		ctx,
		repositoryDirectory,
		"docker",
		"version",
		"--format",
		"{{.Server.Version}}",
	)
	if err != nil || strings.TrimSpace(dockerVersion) == "" {
		return "", contracts.Environment{}, errors.New("Docker daemon preflight failed")
	}
	composeVersion, err := options.commands.Output(
		ctx,
		repositoryDirectory,
		"docker",
		"compose",
		"version",
		"--short",
	)
	if err != nil || strings.TrimSpace(composeVersion) == "" {
		return "", contracts.Environment{}, errors.New("Docker Compose preflight failed")
	}
	return localSHA, contracts.Environment{
		OS:             runtime.GOOS,
		Arch:           runtime.GOARCH,
		DockerVersion:  boundedText(dockerVersion, 128),
		ComposeVersion: boundedText(composeVersion, 128),
	}, nil
}

func githubRepositorySlug(remote string) (string, error) {
	if strings.HasPrefix(remote, "git@github.com:") {
		return trimGitSuffix(strings.TrimPrefix(remote, "git@github.com:")), nil
	}
	parsed, err := url.Parse(remote)
	if err != nil || !strings.EqualFold(parsed.Hostname(), "github.com") {
		return "", errors.New("Git origin is not a supported GitHub remote")
	}
	validHTTPS := parsed.Scheme == "https" && parsed.User == nil
	validSSH := parsed.Scheme == "ssh" && parsed.User != nil &&
		parsed.User.Username() == "git"
	if !validHTTPS && !validSSH {
		return "", errors.New("Git origin is not a supported GitHub remote")
	}
	return trimGitSuffix(strings.TrimPrefix(parsed.Path, "/")), nil
}

func trimGitSuffix(value string) string {
	return strings.TrimSuffix(value, ".git")
}

func boundedText(value string, maxBytes int) string {
	value = strings.TrimSpace(value)
	if len(value) <= maxBytes {
		return value
	}
	return value[:maxBytes]
}

func readBoundedFile(filename string, maxBytes int64) ([]byte, error) {
	file, err := os.Open(filename)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	contents, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(contents)) > maxBytes {
		return nil, errors.New("file exceeds limit")
	}
	return contents, nil
}
