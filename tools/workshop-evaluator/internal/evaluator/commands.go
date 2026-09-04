package evaluator

import (
	"context"
	"io"
	"os"
	"os/exec"
)

type commands interface {
	Output(ctx context.Context, directory, name string, arguments ...string) (string, error)
	Run(
		ctx context.Context,
		directory string,
		environment []string,
		stdout io.Writer,
		stderr io.Writer,
		name string,
		arguments ...string,
	) error
}

type systemCommands struct{}

func (systemCommands) Output(
	ctx context.Context,
	directory string,
	name string,
	arguments ...string,
) (string, error) {
	command := exec.CommandContext(ctx, name, arguments...)
	command.Dir = directory
	output, err := command.Output()
	return string(output), err
}

func (systemCommands) Run(
	ctx context.Context,
	directory string,
	environment []string,
	stdout io.Writer,
	stderr io.Writer,
	name string,
	arguments ...string,
) error {
	command := exec.CommandContext(ctx, name, arguments...)
	command.Dir = directory
	command.Env = append(os.Environ(), environment...)
	command.Stdout = stdout
	command.Stderr = stderr
	return command.Run()
}
