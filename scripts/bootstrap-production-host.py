#!/usr/bin/env python3

import os
import stat
import sys


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def path_components(path: str) -> list[str]:
    if not path.startswith("/"):
        fail("PLATFORM_INSTALL_ROOT must be an absolute path")

    components = path.split("/")[1:]
    if path == "/" or any(component in {"", ".", ".."} for component in components):
        fail("PLATFORM_INSTALL_ROOT must be a canonical non-root path")

    return components


def open_directory(parent_fd: int, name: str, create_mode: int) -> int:
    try:
        entry = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    except FileNotFoundError:
        try:
            os.mkdir(name, create_mode, dir_fd=parent_fd)
        except FileExistsError:
            pass
        entry = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)

    if stat.S_ISLNK(entry.st_mode):
        fail("Production host path must not contain a symbolic link")
    if not stat.S_ISDIR(entry.st_mode):
        fail("Production host path components must be directories")

    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    try:
        return os.open(name, flags, dir_fd=parent_fd)
    except OSError:
        fail("Production host path changed during bootstrap")


def open_install_root(path: str) -> int:
    current_fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in path_components(path):
            next_fd = open_directory(current_fd, component, 0o750)
            os.close(current_fd)
            current_fd = next_fd
        os.fchmod(current_fd, 0o750)
        return current_fd
    except BaseException:
        os.close(current_fd)
        raise


def ensure_runtime_environment(shared_fd: int, template_path: str) -> None:
    try:
        entry = os.stat("runtime.env", dir_fd=shared_fd, follow_symlinks=False)
    except FileNotFoundError:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        with open(template_path, "rb") as template:
            try:
                runtime_fd = os.open("runtime.env", flags, 0o600, dir_fd=shared_fd)
            except FileExistsError:
                fail("Runtime environment path changed during bootstrap")

            failed = True
            try:
                while chunk := template.read(64 * 1024):
                    written = 0
                    while written < len(chunk):
                        written += os.write(runtime_fd, chunk[written:])
                os.fchmod(runtime_fd, 0o600)
                os.fsync(runtime_fd)
                failed = False
            finally:
                os.close(runtime_fd)
                if failed:
                    os.unlink("runtime.env", dir_fd=shared_fd)
        return

    if stat.S_ISLNK(entry.st_mode):
        fail("Runtime environment must not be a symbolic link")
    if not stat.S_ISREG(entry.st_mode):
        fail("Runtime environment path must be a regular file")

    flags = os.O_RDONLY | os.O_NOFOLLOW
    try:
        runtime_fd = os.open("runtime.env", flags, dir_fd=shared_fd)
    except OSError:
        fail("Runtime environment path changed during bootstrap")
    try:
        os.fchmod(runtime_fd, 0o600)
    finally:
        os.close(runtime_fd)


def main() -> None:
    if len(sys.argv) != 3:
        fail("Usage: bootstrap-production-host.py <install-root> <runtime-template>")

    install_root, template_path = sys.argv[1:]
    root_fd = open_install_root(install_root)
    try:
        releases_fd = open_directory(root_fd, "releases", 0o750)
        try:
            os.fchmod(releases_fd, 0o750)
        finally:
            os.close(releases_fd)

        shared_fd = open_directory(root_fd, "shared", 0o700)
        try:
            os.fchmod(shared_fd, 0o700)
            ensure_runtime_environment(shared_fd, template_path)
        finally:
            os.close(shared_fd)
    finally:
        os.close(root_fd)

    print(f"Production host layout is ready at {install_root}")
    print(f"Edit the server-only runtime environment at {install_root}/shared/runtime.env")


if __name__ == "__main__":
    main()
