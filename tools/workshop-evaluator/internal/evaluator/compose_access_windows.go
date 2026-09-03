package evaluator

import (
	"context"
	"fmt"
	"io"
)

const authenticatedUsersSID = "*S-1-5-11"

func prepareComposeDirectories(
	ctx context.Context,
	options Options,
	repositoryDirectory string,
	outputDirectory string,
) error {
	grants := []struct {
		directory  string
		permission string
	}{
		{directory: repositoryDirectory, permission: "(OI)(CI)RX"},
		{directory: outputDirectory, permission: "(OI)(CI)M"},
	}
	for _, grant := range grants {
		if err := options.commands.Run(
			ctx,
			"",
			nil,
			io.Discard,
			options.Stderr,
			"icacls.exe",
			grant.directory,
			"/grant:r",
			authenticatedUsersSID+":"+grant.permission,
			"/T",
			"/Q",
		); err != nil {
			return fmt.Errorf("grant Windows container access to evaluator directory: %w", err)
		}
	}
	return nil
}
