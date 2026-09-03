package evaluator

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestDownloadBundleVerifiesChecksumAndExtractsCompose(t *testing.T) {
	t.Parallel()
	bundle := testBundle(t, map[string]string{
		"compose.yaml": "services:\n  evaluator:\n    image: scratch\n",
	})
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusOK)
		_, _ = response.Write(bundle)
	}))
	defer server.Close()

	if _, _, err := downloadBundle(
		context.Background(),
		server.Client(),
		server.URL,
		strings.Repeat("0", 64),
		int64(len(bundle)),
	); err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("expected checksum rejection, got %v", err)
	}

	digest := sha256.Sum256(bundle)
	directory, cleanup, err := downloadBundle(
		context.Background(),
		server.Client(),
		server.URL,
		hex.EncodeToString(digest[:]),
		int64(len(bundle)),
	)
	if err != nil {
		t.Fatalf("download bundle: %v", err)
	}
	if _, err := os.Stat(filepath.Join(directory, "compose.yaml")); err != nil {
		t.Fatalf("stat compose.yaml: %v", err)
	}
	cleanup()
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatalf("temporary bundle was not removed: %v", err)
	}
}

func TestExtractBundleRejectsTraversalAndLinks(t *testing.T) {
	t.Parallel()
	for _, entry := range []tar.Header{
		{Name: "../outside", Mode: 0o600, Size: 1, Typeflag: tar.TypeReg},
		{Name: "compose.yaml", Linkname: "../outside", Typeflag: tar.TypeSymlink},
	} {
		entry := entry
		t.Run(entry.Name, func(t *testing.T) {
			t.Parallel()
			bundle := testTar(t, entry, []byte("x"))
			if err := extractBundle(bundle, t.TempDir()); err == nil {
				t.Fatal("expected unsafe archive entry to be rejected")
			}
		})
	}
}

func TestExtractBundleRejectsOverflowingExpandedSize(t *testing.T) {
	t.Parallel()
	bundle := testTarHeader(t, tar.Header{
		Name:     "compose.yaml",
		Mode:     0o600,
		Size:     math.MaxInt64,
		Typeflag: tar.TypeReg,
	})
	if err := extractBundle(bundle, t.TempDir()); err == nil ||
		!strings.Contains(err.Error(), "expanded evaluator bundle exceeds limit") {
		t.Fatalf("expected oversized tar header rejection, got %v", err)
	}
}

func testBundle(t *testing.T, files map[string]string) []byte {
	t.Helper()
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	entries := make([]testTarEntry, 0, len(names))
	for _, name := range names {
		contents := files[name]
		entries = append(entries, testTarEntry{
			header: tar.Header{
				Name:     name,
				Mode:     0o600,
				Size:     int64(len(contents)),
				Typeflag: tar.TypeReg,
			},
			contents: []byte(contents),
		})
	}
	return testTarEntries(t, entries)
}

func testTar(t *testing.T, header tar.Header, contents []byte) []byte {
	t.Helper()
	return testTarEntries(t, []testTarEntry{{header: header, contents: contents}})
}

func testTarHeader(t *testing.T, header tar.Header) []byte {
	t.Helper()
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	archive := tar.NewWriter(gzipWriter)
	if err := archive.WriteHeader(&header); err != nil {
		t.Fatalf("write tar header: %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	return buffer.Bytes()
}

type testTarEntry struct {
	header   tar.Header
	contents []byte
}

func testTarEntries(t *testing.T, entries []testTarEntry) []byte {
	t.Helper()
	var buffer bytes.Buffer
	gzipWriter := gzip.NewWriter(&buffer)
	archive := tar.NewWriter(gzipWriter)
	for _, entry := range entries {
		if err := archive.WriteHeader(&entry.header); err != nil {
			t.Fatalf("write tar header: %v", err)
		}
		if entry.header.Typeflag == tar.TypeReg {
			if _, err := archive.Write(entry.contents); err != nil {
				t.Fatalf("write tar contents: %v", err)
			}
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatalf("close tar: %v", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("close gzip: %v", err)
	}
	return buffer.Bytes()
}
