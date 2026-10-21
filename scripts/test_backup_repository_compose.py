"""Resolve the real Compose template against synthetic secrets, only on a hosted CI runner."""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "foundation_proof", pathlib.Path(__file__).with_name("foundation-recovery-proof.py"))
base = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(base)


class TransitionCompose(unittest.TestCase):
    def test_staged_initializer_is_separate_from_active_archiving_configuration(self):
        base.hosted_runner()
        docker = ["docker", "--host", base.local_endpoint()]
        with tempfile.TemporaryDirectory(dir=os.environ["RUNNER_TEMP"]) as name:
            directory = pathlib.Path(name)
            for file in ("database.env", "postgres.env", "logto-database.env", "pgbackrest.env"):
                (directory / file).write_text((base.ROOT / "config/production/foundation" / (file + ".example")).read_text())
            staged = directory / "pgbackrest-repo2.env.staged"
            staged.write_text((base.ROOT / "config/production/foundation/pgbackrest-repo2.env.staged.example").read_text())
            compose_env = directory / "compose.env"
            compose_env.write_text("FOUNDATION_CONFIG_DIR=" + name + "\n"
                                   "FOUNDATION_DATABASE_PROJECT=inside-transition-config-proof\n"
                                   "FOUNDATION_DATABASE_NETWORK=inside-transition-config-proof-db\n"
                                   "FOUNDATION_POSTGRES_VOLUME=inside-transition-config-proof-data\n")
            def resolve():
                return json.loads(base.invoke([
                    *docker, "compose", "--env-file", str(compose_env), "--file",
                    str(base.ROOT / "infra/production/database/compose.yaml"),
                    "--profile", "repository-transition", "config", "--format=json"]).stdout)
            config = resolve()
            initializer = config["services"]["initialize-repo2"]
            keys = set(initializer["environment"])
            self.assertTrue(keys)
            self.assertTrue(all(key.startswith("PGBACKREST_REPO2_") for key in keys))
            data = next(item for item in initializer["volumes"] if item["target"] == "/var/lib/postgresql")
            self.assertTrue(data["read_only"])
            self.assertFalse(any(key.startswith("PGBACKREST_REPO2_")
                                 for key in config["services"]["postgres"]["environment"]))
            (directory / "pgbackrest-repo2.env").write_text(staged.read_text())
            active = resolve()
            for service in ("postgres", "pgbackrest"):
                self.assertTrue(keys.issubset(active["services"][service]["environment"]))


if __name__ == "__main__":
    unittest.main()
