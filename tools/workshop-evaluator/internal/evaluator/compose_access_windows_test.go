package evaluator

import (
	"context"
	"io"
	"reflect"
	"testing"
)

func TestPrepareComposeDirectoriesGrantsOnlyRequiredWindowsAccess(t *testing.T) {
	t.Parallel()

	commands := &accessRecordingCommands{}
	options := Options{commands: commands, Stderr: io.Discard}
	if err := prepareComposeDirectories(
		context.Background(),
		options,
		`C:\snapshot`,
		`C:\output`,
	); err != nil {
		t.Fatalf("prepare Compose directories: %v", err)
	}

	expected := [][]string{
		{"icacls.exe", `C:\snapshot`, "/grant:r", "*S-1-5-11:(OI)(CI)RX", "/T", "/Q"},
		{"icacls.exe", `C:\output`, "/grant:r", "*S-1-5-11:(OI)(CI)M", "/T", "/Q"},
	}
	if !reflect.DeepEqual(commands.calls, expected) {
		t.Fatalf("unexpected access commands: %#v", commands.calls)
	}
}

type accessRecordingCommands struct {
	calls [][]string
}

func (*accessRecordingCommands) Output(
	context.Context,
	string,
	string,
	...string,
) (string, error) {
	return "", nil
}

func (commands *accessRecordingCommands) Run(
	_ context.Context,
	_ string,
	_ []string,
	_ io.Writer,
	_ io.Writer,
	name string,
	arguments ...string,
) error {
	call := append([]string{name}, arguments...)
	commands.calls = append(commands.calls, call)
	return nil
}
