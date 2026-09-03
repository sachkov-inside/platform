package main

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func main() {
	file := flag.String("file", "", "artifact file")
	output := flag.String("output", "", "checksum output file")
	verify := flag.String("verify", "", "checksum file to verify")
	flag.Parse()
	if *file == "" || ((*output == "") == (*verify == "")) {
		fmt.Fprintln(os.Stderr, "--file and exactly one of --output or --verify are required")
		os.Exit(2)
	}
	digest, err := fileSHA256(*file)
	if err != nil {
		fatal(err)
	}
	line := fmt.Sprintf("%s  %s\n", digest, filepath.Base(*file))
	if *output != "" {
		if err := os.WriteFile(*output, []byte(line), 0o644); err != nil {
			fatal(err)
		}
		return
	}
	expected, err := os.ReadFile(*verify)
	if err != nil {
		fatal(err)
	}
	if string(expected) != line {
		fatal(errors.New("artifact checksum does not match"))
	}
	fmt.Fprintf(os.Stdout, "%s: OK\n", strings.TrimSpace(filepath.Base(*file)))
}

func fileSHA256(filename string) (string, error) {
	file, err := os.Open(filename)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
