"""Curate resource evidence without exposing private Compose/env/token/raw Engine inputs."""
import argparse
from pathlib import Path
import sys
import tempfile
import binding
import runtime


def collect(output, destination):
    # The shared collector checks regular files, symlinks, byte limits and JSON before copying.
    with tempfile.TemporaryDirectory(prefix='inside-resource-metadata-') as directory:
        runtime.ci.collect(output, Path(directory), destination, artifacts=binding.ARTIFACTS)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--public',type=Path,required=True)
    args=parser.parse_args()
    collect(args.output.resolve(),args.public.resolve())


if __name__=='__main__':
    try:
        main()
    except (OSError,ValueError,RuntimeError):
        print('resource-artifacts: failed',file=sys.stderr)
        sys.exit(1)
