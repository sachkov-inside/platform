package evaluator

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/contracts"
)

func TestRepositorySnapshotUsesExactCommitAndExcludesWorkingTreeChanges(t *testing.T) {
	repositoryDirectory := t.TempDir()
	runGit(t, repositoryDirectory, "init", "--initial-branch=main")
	runGit(t, repositoryDirectory, "config", "user.name", "Workshop Test")
	runGit(t, repositoryDirectory, "config", "user.email", "workshop@example.invalid")
	tracked := filepath.Join(repositoryDirectory, "tracked.txt")
	if err := os.WriteFile(tracked, []byte("committed\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(repositoryDirectory, ".gitattributes"),
		[]byte("tracked.txt filter=participant-filter\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	runGit(t, repositoryDirectory, "add", "tracked.txt", ".gitattributes")
	runGit(t, repositoryDirectory, "commit", "-m", "fixture")
	commitSHA := strings.TrimSpace(runGit(t, repositoryDirectory, "rev-parse", "HEAD"))
	hookMarker := filepath.Join(repositoryDirectory, "post-checkout-hook-ran")
	filterMarker := filepath.Join(repositoryDirectory, "smudge-filter-ran")
	if runtime.GOOS != "windows" {
		hook := filepath.Join(repositoryDirectory, ".git", "hooks", "post-checkout")
		if err := os.WriteFile(
			hook,
			[]byte(fmt.Sprintf("#!/bin/sh\nprintf hook > %q\n", hookMarker)),
			0o700,
		); err != nil {
			t.Fatal(err)
		}
		filter := filepath.Join(repositoryDirectory, ".git", "participant-filter")
		if err := os.WriteFile(
			filter,
			[]byte(fmt.Sprintf("#!/bin/sh\nprintf filter > %q\ncat\n", filterMarker)),
			0o700,
		); err != nil {
			t.Fatal(err)
		}
		runGit(t, repositoryDirectory, "config", "filter.participant-filter.smudge", filter)
		runGit(t, repositoryDirectory, "config", "filter.participant-filter.required", "true")
	}

	if err := os.WriteFile(tracked, []byte("dirty\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(repositoryDirectory, "untracked-secret.txt"),
		[]byte("secret\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	options := withDefaults(Options{
		Stdout:         io.Discard,
		Stderr:         io.Discard,
		CleanupTimeout: time.Second,
	})
	snapshotDirectory, cleanup, err := createRepositorySnapshot(
		context.Background(),
		options,
		repositoryDirectory,
		commitSHA,
	)
	if err != nil {
		t.Fatalf("create repository snapshot: %v", err)
	}
	snapshotContents, err := os.ReadFile(filepath.Join(snapshotDirectory, "tracked.txt"))
	if err != nil || string(snapshotContents) != "committed\n" {
		t.Fatalf("snapshot did not preserve committed contents: %q, %v", snapshotContents, err)
	}
	if _, err := os.Stat(filepath.Join(snapshotDirectory, "untracked-secret.txt")); !os.IsNotExist(err) {
		t.Fatalf("snapshot included untracked file: %v", err)
	}
	if _, err := os.Stat(hookMarker); !os.IsNotExist(err) {
		t.Fatalf("snapshot creation executed a participant Git hook: %v", err)
	}
	if _, err := os.Stat(filterMarker); !os.IsNotExist(err) {
		t.Fatalf("snapshot creation executed a participant Git filter: %v", err)
	}
	if err := cleanup(); err != nil {
		t.Fatalf("cleanup repository snapshot: %v", err)
	}
	if _, err := os.Stat(snapshotDirectory); !os.IsNotExist(err) {
		t.Fatalf("snapshot directory remains after cleanup: %v", err)
	}
}

func TestBindSnapshotManifestRejectsSemanticWorkingCopyChange(t *testing.T) {
	fixture := filepath.Join(
		"..",
		"..",
		"..",
		"..",
		"contracts",
		"workshop",
		"conformance",
		"documents",
		"assignment-manifest.valid.json",
	)
	contents, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	committedManifest, err := contracts.ParseManifest(contents)
	if err != nil {
		t.Fatal(err)
	}
	snapshotDirectory := t.TempDir()
	manifestDirectory := filepath.Join(snapshotDirectory, ".inside")
	if err := os.Mkdir(manifestDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(manifestDirectory, "assignment.json"),
		contents,
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	workingManifest := committedManifest
	workingManifest.AssignmentID = "assignment-fixture-2"
	_, _, err = bindSnapshotManifest(snapshotDirectory, workingManifest)
	if err == nil || !strings.Contains(err.Error(), "does not match the pushed commit") {
		t.Fatalf("expected committed manifest binding rejection, got %v", err)
	}
}

func runGit(t *testing.T, directory string, arguments ...string) string {
	t.Helper()
	command := exec.Command("git", arguments...)
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s: %v: %s", strings.Join(arguments, " "), err, output)
	}
	return string(output)
}
