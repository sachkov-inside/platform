package evaluator

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

const maxExpandedBundleBytes = 128 * 1024 * 1024

func downloadBundle(
	ctx context.Context,
	client *http.Client,
	url string,
	expectedSHA256 string,
	maxBytes int64,
) (string, func(), error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", nil, fmt.Errorf("create evaluator bundle request: %w", err)
	}
	response, err := client.Do(request)
	if err != nil {
		return "", nil, fmt.Errorf("download evaluator bundle: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", nil, fmt.Errorf("download evaluator bundle: unexpected HTTP status %d", response.StatusCode)
	}
	if response.ContentLength > maxBytes {
		return "", nil, errors.New("evaluator bundle exceeds manifest limit")
	}

	contents, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return "", nil, fmt.Errorf("read evaluator bundle: %w", err)
	}
	if int64(len(contents)) > maxBytes {
		return "", nil, errors.New("evaluator bundle exceeds manifest limit")
	}
	digest := sha256.Sum256(contents)
	if hex.EncodeToString(digest[:]) != expectedSHA256 {
		return "", nil, errors.New("evaluator bundle checksum mismatch")
	}

	directory, err := os.MkdirTemp("", "inside-workshop-evaluator-*")
	if err != nil {
		return "", nil, fmt.Errorf("create evaluator directory: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(directory) }
	if err := extractBundle(contents, directory); err != nil {
		cleanup()
		return "", nil, err
	}
	if info, err := os.Stat(filepath.Join(directory, "compose.yaml")); err != nil || !info.Mode().IsRegular() {
		cleanup()
		return "", nil, errors.New("evaluator bundle must contain compose.yaml")
	}
	return directory, cleanup, nil
}

func extractBundle(contents []byte, destination string) error {
	gzipReader, err := gzip.NewReader(bytes.NewReader(contents))
	if err != nil {
		return fmt.Errorf("open evaluator bundle: %w", err)
	}
	defer gzipReader.Close()

	archive := tar.NewReader(gzipReader)
	var expandedBytes int64
	for {
		header, err := archive.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read evaluator bundle: %w", err)
		}
		cleanName, err := safeArchivePath(header.Name)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, filepath.FromSlash(cleanName))
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return fmt.Errorf("create evaluator directory: %w", err)
			}
		case tar.TypeReg, tar.TypeRegA:
			if header.Size < 0 || header.Size > maxExpandedBundleBytes-expandedBytes {
				return errors.New("expanded evaluator bundle exceeds limit")
			}
			expandedBytes += header.Size
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return fmt.Errorf("create evaluator parent directory: %w", err)
			}
			file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
			if err != nil {
				return fmt.Errorf("create evaluator file: %w", err)
			}
			_, copyErr := io.CopyN(file, archive, header.Size)
			closeErr := file.Close()
			if copyErr != nil {
				return fmt.Errorf("extract evaluator file: %w", copyErr)
			}
			if closeErr != nil {
				return fmt.Errorf("close evaluator file: %w", closeErr)
			}
		default:
			return fmt.Errorf("unsupported evaluator bundle entry type for %q", header.Name)
		}
	}
	return nil
}

func safeArchivePath(name string) (string, error) {
	if name == "" || strings.ContainsAny(name, "\\:") {
		return "", errors.New("evaluator bundle contains an unsafe path")
	}
	clean := path.Clean(name)
	if clean == "." || path.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") {
		return "", errors.New("evaluator bundle contains an unsafe path")
	}
	return clean, nil
}
