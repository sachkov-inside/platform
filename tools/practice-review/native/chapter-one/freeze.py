"""Freeze committed task YAML only; working-copy edits never enter the lab."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import yaml


def freeze(repository, ref):
    def git(*args):
        return subprocess.check_output(["git", "-C", repository, *args])

    commit = git("rev-parse", "--verify", ref + "^{commit}").decode().strip()
    tasks = []
    for code in ("aie-ch1-harness", "aie-ch1-running-skeleton", "aie-ch1-quality-checks"):
        path = f"practice/ai-engineering/{code}.yaml"
        raw = git("show", f"{commit}:{path}")
        task = yaml.safe_load(raw)[code]
        definition = {key: value for key, value in task.items()
                      if key in ("format", "intro", "freedom", "criteria", "reviewGuidance")}
        definition["schemaVersion"] = 2
        tasks.append({"code": code, "title": task["title"], "path": path,
                      "sha256": hashlib.sha256(raw).hexdigest(), "definition": definition})
    return {"repository": "sachkov-inside/engineering-content", "commit": commit,
            "chapter": "project-setup", "tasks": tasks}


if __name__ == "__main__":
    repository, ref, output = sys.argv[1:]
    Path(output).write_text(json.dumps(freeze(repository, ref), ensure_ascii=False, indent=2) + "\n")
