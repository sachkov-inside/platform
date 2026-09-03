package evaluator

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

func createRepositorySnapshot(
	ctx context.Context,
	options Options,
	repositoryDirectory string,
	commitSHA string,
) (string, func() error, error) {
	parent, err := os.MkdirTemp("", "inside-workshop-repository-*")
	if err != nil {
		return "", nil, fmt.Errorf("create repository snapshot directory: %w", err)
	}
	hooksDirectory := filepath.Join(parent, "disabled-hooks")
	if err := os.Mkdir(hooksDirectory, 0o700); err != nil {
		_ = os.RemoveAll(parent)
		return "", nil, fmt.Errorf("create disabled Git hooks directory: %w", err)
	}
	snapshotDirectory := filepath.Join(parent, "repository")
	if err := options.commands.Run(
		ctx,
		repositoryDirectory,
		nil,
		io.Discard,
		options.Stderr,
		"git",
		"-c",
		"core.hooksPath="+hooksDirectory,
		"worktree",
		"add",
		"--no-checkout",
		"--detach",
		snapshotDirectory,
		commitSHA,
	); err != nil {
		_ = os.RemoveAll(parent)
		return "", nil, errors.New("create immutable Git snapshot failed")
	}
	if err := materializeRepositoryTree(
		ctx,
		options,
		repositoryDirectory,
		snapshotDirectory,
		commitSHA,
	); err != nil {
		cleanupErr := cleanupSnapshot(
			options,
			repositoryDirectory,
			snapshotDirectory,
			parent,
		)
		return "", nil, errors.Join(err, cleanupErr)
	}
	actualSHA, err := options.commands.Output(
		ctx,
		snapshotDirectory,
		"git",
		"rev-parse",
		"HEAD",
	)
	if err != nil || strings.TrimSpace(actualSHA) != commitSHA {
		cleanupSnapshot(options, repositoryDirectory, snapshotDirectory, parent)
		return "", nil, errors.New("immutable Git snapshot verification failed")
	}
	return snapshotDirectory, func() error {
		return cleanupSnapshot(options, repositoryDirectory, snapshotDirectory, parent)
	}, nil
}

func bindSnapshotManifest(
	snapshotDirectory string,
	workingManifest contracts.Manifest,
) (contracts.Manifest, string, error) {
	contents, err := readBoundedFile(
		filepath.Join(snapshotDirectory, ".inside", "assignment.json"),
		contracts.ByteLimit(contracts.AssignmentManifest, "document"),
	)
	if err != nil {
		return contracts.Manifest{}, "", fmt.Errorf("read committed assignment manifest: %w", err)
	}
	committedManifest, err := contracts.ParseManifest(contents)
	if err != nil {
		return contracts.Manifest{}, "", fmt.Errorf("validate committed assignment manifest: %w", err)
	}
	workingDigest, err := contracts.ManifestSHA256(workingManifest)
	if err != nil {
		return contracts.Manifest{}, "", fmt.Errorf("canonicalize working assignment manifest: %w", err)
	}
	committedDigest, err := contracts.ManifestSHA256(committedManifest)
	if err != nil {
		return contracts.Manifest{}, "", fmt.Errorf("canonicalize committed assignment manifest: %w", err)
	}
	if workingDigest != committedDigest {
		return contracts.Manifest{}, "", errors.New(
			"working assignment manifest does not match the pushed commit",
		)
	}
	return committedManifest, committedDigest, nil
}

func materializeRepositoryTree(
	ctx context.Context,
	options Options,
	repositoryDirectory string,
	snapshotDirectory string,
	commitSHA string,
) error {
	listing, err := options.commands.Output(
		ctx,
		repositoryDirectory,
		"git",
		"ls-tree",
		"-rz",
		"--full-tree",
		commitSHA,
	)
	if err != nil {
		return errors.New("read immutable Git tree failed")
	}
	for _, rawEntry := range strings.Split(listing, "\x00") {
		if rawEntry == "" {
			continue
		}
		mode, objectType, objectID, relativePath, parseErr := parseTreeEntry(rawEntry)
		if parseErr != nil {
			return parseErr
		}
		if objectType != "blob" || (mode != "100644" && mode != "100755") {
			return fmt.Errorf("unsupported Git tree entry %q", relativePath)
		}
		target := filepath.Join(snapshotDirectory, filepath.FromSlash(relativePath))
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return fmt.Errorf("create repository snapshot directory: %w", err)
		}
		file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			return fmt.Errorf("create repository snapshot file: %w", err)
		}
		writeErr := options.commands.Run(
			ctx,
			repositoryDirectory,
			nil,
			file,
			options.Stderr,
			"git",
			"cat-file",
			"blob",
			objectID,
		)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			return fmt.Errorf(
				"materialize repository snapshot file: %w",
				errors.Join(writeErr, closeErr),
			)
		}
		if mode == "100755" {
			if err := os.Chmod(target, 0o700); err != nil {
				return fmt.Errorf("set repository snapshot file mode: %w", err)
			}
		}
	}
	return nil
}

func parseTreeEntry(entry string) (string, string, string, string, error) {
	metadata, relativePath, found := strings.Cut(entry, "\t")
	fields := strings.Fields(metadata)
	if !found || len(fields) != 3 || !validGitObjectID(fields[2]) {
		return "", "", "", "", errors.New("immutable Git tree contains an invalid entry")
	}
	if err := validateRepositoryPath(relativePath); err != nil {
		return "", "", "", "", err
	}
	return fields[0], fields[1], fields[2], relativePath, nil
}

func validGitObjectID(value string) bool {
	if len(value) != 40 {
		return false
	}
	for _, character := range value {
		if !strings.ContainsRune("0123456789abcdef", character) {
			return false
		}
	}
	return true
}

func validateRepositoryPath(value string) error {
	if value == "" || !utf8.ValidString(value) || strings.ContainsAny(value, "\\:") {
		return errors.New("immutable Git tree contains an unsafe path")
	}
	clean := path.Clean(value)
	if clean != value || path.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") {
		return errors.New("immutable Git tree contains an unsafe path")
	}
	for _, component := range strings.Split(clean, "/") {
		if strings.EqualFold(component, ".git") {
			return errors.New("immutable Git tree contains a reserved path")
		}
	}
	return nil
}

func cleanupSnapshot(
	options Options,
	repositoryDirectory string,
	snapshotDirectory string,
	parent string,
) error {
	cleanupContext, cancel := context.WithTimeout(context.Background(), options.CleanupTimeout)
	defer cancel()
	worktreeErr := options.commands.Run(
		cleanupContext,
		repositoryDirectory,
		nil,
		io.Discard,
		options.Stderr,
		"git",
		"-c",
		"core.hooksPath="+filepath.Join(parent, "disabled-hooks"),
		"worktree",
		"remove",
		"--force",
		snapshotDirectory,
	)
	removeErr := os.RemoveAll(parent)
	if worktreeErr != nil || removeErr != nil {
		return fmt.Errorf(
			"cleanup immutable Git snapshot: %w",
			errors.Join(worktreeErr, removeErr),
		)
	}
	return nil
}
