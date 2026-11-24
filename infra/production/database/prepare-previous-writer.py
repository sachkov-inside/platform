"""Refresh the five retired APK pins in the CI checkout of the frozen 18.4 writer."""
import pathlib
import sys


def prepare(source):
    replacements = {
        "openssl-dev=3.5.9-r0": "openssl-dev=3.5.9-r1 libcrypto3=3.5.9-r1 libssl3=3.5.9-r1",
        "libcrypto3=3.5.9-r0": "libcrypto3=3.5.9-r1",
        "libssl3=3.5.9-r0": "libssl3=3.5.9-r1",
        "zstd-dev=1.5.7-r2": "zstd=1.6.0-r0 zstd-libs=1.6.0-r0 zstd-dev=1.6.0-r0",
        "zstd-libs=1.5.7-r2": "zstd-libs=1.6.0-r0",
    }
    for old, new in replacements.items():
        # Match the entire package token on its own RUN continuation line.
        suffix = "\n" if old.startswith("zstd-dev=") else " " + '\\' + "\n"
        line = "    " + old + suffix
        if source.count(line) != 1:
            raise ValueError("Expected exactly one frozen package pin: " + old)
        source = source.replace(line, "    " + new + suffix)
    return source


if __name__ == "__main__":
    dockerfile = pathlib.Path(sys.argv[1])
    dockerfile.write_text(prepare(dockerfile.read_text()))
