//go:build !windows

package evaluator

import "context"

func prepareComposeDirectories(
	context.Context,
	Options,
	string,
	string,
) error {
	return nil
}
