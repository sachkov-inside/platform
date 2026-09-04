package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/sachkov-inside/platform/tools/workshop-evaluator/internal/evaluator"
)

var version = evaluator.Version

func main() {
	os.Exit(run())
}

func run() int {
	flags := flag.NewFlagSet("workshop-evaluator", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	manifest := flags.String("manifest", "", "path to .inside/assignment.json")
	testingOrigin := flags.String(
		"testing-platform-origin",
		"",
		"direct loopback HTTP origin used only by the conformance smoke",
	)
	showVersion := flags.Bool("version", false, "print the pinned evaluator version")
	if err := flags.Parse(os.Args[1:]); err != nil {
		return 2
	}
	if flags.NArg() != 0 {
		fmt.Fprintln(os.Stderr, "workshop-evaluator does not accept positional arguments")
		return 2
	}
	if *showVersion {
		fmt.Fprintln(os.Stdout, version)
		return 0
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	err := evaluator.Run(ctx, evaluator.Options{
		ManifestPath:          *manifest,
		TestingPlatformOrigin: *testingOrigin,
		Version:               version,
		Stdout:                os.Stdout,
		Stderr:                os.Stderr,
	})
	if err == nil {
		return 0
	}
	fmt.Fprintf(os.Stderr, "workshop-evaluator: %v\n", err)
	if errors.Is(err, context.Canceled) || ctx.Err() != nil {
		return 130
	}
	return 1
}
