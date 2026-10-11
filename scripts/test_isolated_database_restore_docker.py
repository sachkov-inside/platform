"""Bounded Docker/process cleanup contracts using synthetic data, never a backup."""
import multiprocessing
import os
import signal
import subprocess
import time
import unittest

import test_isolated_database_restore as unit_contract

restore = unit_contract.restore


def synthetic_restore(image, repository, cipher, outcome, connection):
    signal.signal(signal.SIGTERM, restore.terminate)
    # Exercise the production subprocess adapter with a short, real deadline.
    restore.DOCKER_TIMEOUT_SECONDS = 3

    def execute(*args, input_text=None):
        if args[:2] == ("volume", "create"):
            connection.send(("volume", args[-1]))
        if args[0] == "run":
            name = args[args.index("--name") + 1]
            connection.send(("container", name))
            image_index = args.index(image)
            command = list(args[:image_index + 1])
            command[command.index("--entrypoint") + 1] = "sh"
            if "--detach" in args:
                fixture = "exec sleep 60"
            elif outcome == "failure":
                fixture = "printf synthetic > /var/lib/postgresql/probe; exit 7"
            elif outcome == "success":
                fixture = "printf synthetic > /var/lib/postgresql/probe"
            else:
                fixture = "printf synthetic > /var/lib/postgresql/probe; exec sleep 60"
            return restore.run(*command, "-c", fixture)
        if args[0] == "exec":
            # Synthetic SQL adapter: verify ownership/cleanup, not pgBackRest recovery.
            container = args[args.index("postgres") + 1]
            return restore.run("exec", container, "sh", "-c", "printf f")
        return restore.run(*args, input_text=input_text)

    try:
        restore.restore(image, repository, cipher, "20261011-100000F", execute)
    except (subprocess.SubprocessError, KeyboardInterrupt):
        connection.send(("result", "failed"))
    else:
        connection.send(("result", "passed"))
    finally:
        connection.close()


class RestoreDockerProcessContract(unittest.TestCase):
    # Reuse the protected temporary-directory setup, not the unit-test cases.
    setUp = unit_contract.RestoreSafety.setUp

    def contract(self, outcome):
        image = os.environ.get("RESTORE_TEST_IMAGE", "")
        self.assertRegex(image, r"^sha256:[a-f0-9]{64}$", "select an already pulled image ID")
        restore.run("image", "inspect", image)
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe(duplex=False)
        process = context.Process(target=synthetic_restore,
                                  args=(image, self.repo, self.cipher, outcome, child))
        owned = []
        result = None
        signalled = False
        # Register cleanup before starting the child, including forced process termination.
        try:
            process.start()
            child.close()
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if parent.poll(0.05):
                    try:
                        kind, value = parent.recv()
                    except EOFError:
                        break
                    if kind == "result":
                        result = value
                    else:
                        owned.append((kind, value))
                if outcome == "sigterm" and not signalled:
                    containers = [name for kind, name in owned if kind == "container"]
                    if containers:
                        probe = subprocess.run(
                            ["docker", "exec", containers[-1], "test", "-f",
                             "/var/lib/postgresql/probe"], capture_output=True, timeout=2)
                        if probe.returncode == 0:
                            # The container has written data and is actually running.
                            os.kill(process.pid, signal.SIGTERM)
                            signalled = True
                if not process.is_alive() and not parent.poll():
                    break
            process.join(timeout=1)
            self.assertFalse(process.is_alive(), "restore process exceeded its 15-second budget")
            self.assertEqual(process.exitcode, 0)
            self.assertEqual(result, "passed" if outcome == "success" else "failed")
            if outcome == "sigterm":
                self.assertTrue(signalled, "SIGTERM must arrive after synthetic data is written")
            self.assertTrue(any(kind == "volume" for kind, _ in owned))
            self.assertTrue(any(kind == "container" for kind, _ in owned))
            for kind, name in owned:
                inspected = subprocess.run(["docker", kind, "inspect", name],
                                           capture_output=True, timeout=3)
                self.assertNotEqual(inspected.returncode, 0, f"owned {kind} survived: {name}")
        finally:
            if process.pid is not None and process.is_alive():
                process.terminate()
                process.join(timeout=5)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=5)
            parent.close()
            child.close()
            # A failed assertion still removes only this case's individually recorded resources.
            for kind, name in reversed(owned):
                arguments = ["rm", "--force", name] if kind == "container" else ["volume", "rm", name]
                subprocess.run(["docker", *arguments], capture_output=True, timeout=5)

    def test_real_docker_success_removes_every_owned_resource(self):
        self.contract("success")

    def test_real_docker_failure_removes_every_owned_resource(self):
        self.contract("failure")

    def test_real_subprocess_timeout_removes_every_owned_resource(self):
        self.contract("timeout")

    def test_real_process_sigterm_removes_every_owned_resource(self):
        self.contract("sigterm")


if __name__ == "__main__":
    unittest.main()
