#!/usr/bin/env python3
"""Отчёт агента: создать папку с фактами, проверить форму, сдать.

    report.py new --task <номер|ссылка|строка> --name <имя> [--worktree <путь>] [--agent <агент>]
    report.py check <папка отчёта>
    report.py finish <папка отчёта>

Стандарт: report.json обязателен, body.html или body.md и assets/ по желанию.
Папка: <основной каталог проекта>/.reports/<задача>/<дата>-<имя>/.
Зависимостей нет: только стандартная библиотека Python 3.9+.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

VERSION = 1
PORT = int(os.environ.get("WORKSPACE_REPORTS_PORT", "7451"))
STATUSES = {"done": "готово", "stopped": "остановлено", "review": "ждёт приёмки"}
AGENTS = {"claude-code", "codex", "other"}
SUMMARY_MAX = 5
LINE_MAX = 300
PROMPT_MAX = 2000
URL = re.compile(r"^https?://\S+$")
SLUG = re.compile(r"[^a-z0-9а-яё]+")

TOP_KEYS = {
    "version": True, "project": True, "task": True, "title": False, "status": True,
    "created_at": True, "finished_at": False, "summary": True, "needs_owner": True,
    "verification": True, "next": True, "actions": True, "session": True,
}
TASK_KEYS = {"id": False, "title": True, "url": False}
CHECK_KEYS = {"text": True, "command": False, "link": False}
NEXT_KEYS = {"text": True, "link": False}
ACTION_KEYS = {"label": True, "prompt": True, "irreversible": True}
SESSION_KEYS = {"agent": True, "id": True, "branch": True, "worktree": True, "pr": False}


# ── Проверка формы ────────────────────────────────────────────────────────


def _keys(value: Any, spec: dict[str, bool], where: str, errors: list[str]) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{where}: нужен объект")
        return False
    for key in value:
        if key not in spec:
            errors.append(f"{where}.{key}: лишнее поле; допустимы {', '.join(spec)}")
    for key, required in spec.items():
        if required and key not in value:
            errors.append(f"{where}.{key}: обязательное поле отсутствует")
    return True


def _text(value: Any, where: str, errors: list[str], limit: int = LINE_MAX) -> None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{where}: нужна непустая строка")
    elif len(value) > limit:
        errors.append(f"{where}: {len(value)} знаков, предел {limit}")


def _url(value: Any, where: str, errors: list[str]) -> None:
    if not isinstance(value, str) or not URL.match(value):
        errors.append(f"{where}: нужна ссылка http(s)://")


def _list(value: Any, where: str, errors: list[str]) -> list[Any]:
    if not isinstance(value, list):
        errors.append(f"{where}: нужен список")
        return []
    return value


def _time(value: Any, where: str, errors: list[str]) -> None:
    try:
        if datetime.fromisoformat(str(value)).tzinfo is None:
            errors.append(f"{where}: нужен часовой пояс, например 2026-10-03T12:00:00+03:00")
    except ValueError:
        errors.append(f"{where}: нужна дата ISO 8601")


def prs(session: Any) -> list[Any]:
    """PR сессии списком. Старая форма: одна ссылка строкой или null."""
    value = session.get("pr") if isinstance(session, dict) else None
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _check_item(item: Any, where: str, errors: list[str], *, evidence: bool) -> None:
    if not _keys(item, CHECK_KEYS, where, errors):
        return
    _text(item.get("text"), f"{where}.text", errors)
    if "command" in item:
        _text(item["command"], f"{where}.command", errors, PROMPT_MAX)
    if "link" in item:
        _url(item["link"], f"{where}.link", errors)
    if evidence and "command" not in item and "link" not in item:
        errors.append(f"{where}: у пункта нужна команда (command) или ссылка (link)")


def validate(data: Any) -> list[str]:
    """Ошибки формы report.json; пустой список значит «форма верна»."""
    errors: list[str] = []
    if not _keys(data, TOP_KEYS, "report", errors):
        return errors
    if data.get("version") != VERSION:
        errors.append(f"report.version: нужно {VERSION}")
    _text(data.get("project"), "report.project", errors)

    task = data.get("task")
    if isinstance(task, str):
        _text(task, "report.task", errors)
    elif isinstance(task, dict):
        _keys(task, TASK_KEYS, "report.task", errors)
        _text(task.get("title"), "report.task.title", errors)
        if "id" in task:
            _text(task["id"], "report.task.id", errors, 80)
        if "url" in task:
            _url(task["url"], "report.task.url", errors)
    elif "task" in data:
        errors.append("report.task: нужна строка или объект {id, title, url}")

    if "title" in data:
        _text(data["title"], "report.title", errors, 160)
    if data.get("status") not in STATUSES:
        errors.append(f"report.status: допустимы {', '.join(STATUSES)} ({', '.join(STATUSES.values())})")
    _time(data.get("created_at"), "report.created_at", errors)
    if "finished_at" in data:
        _time(data["finished_at"], "report.finished_at", errors)

    summary = _list(data.get("summary"), "report.summary", errors)
    if "summary" in data and isinstance(data["summary"], list) and not summary:
        errors.append("report.summary: нужна хотя бы одна строка")
    if len(summary) > SUMMARY_MAX:
        errors.append(f"report.summary: {len(summary)} строк, предел {SUMMARY_MAX}")
    for index, line in enumerate(summary):
        _text(line, f"report.summary[{index}]", errors)

    for index, line in enumerate(_list(data.get("needs_owner"), "report.needs_owner", errors)):
        _text(line, f"report.needs_owner[{index}]", errors)

    verification = data.get("verification")
    if _keys(verification, {"auto": True, "manual": True, "unverified": True}, "report.verification", errors):
        for group in ("auto", "manual", "unverified"):
            items = _list(verification.get(group), f"report.verification.{group}", errors)
            for index, item in enumerate(items):
                _check_item(item, f"report.verification.{group}[{index}]", errors,
                            evidence=group != "unverified")

    for index, item in enumerate(_list(data.get("next"), "report.next", errors)):
        where = f"report.next[{index}]"
        if isinstance(item, str):
            _text(item, where, errors)
        elif _keys(item, NEXT_KEYS, where, errors):
            _text(item.get("text"), f"{where}.text", errors)
            if "link" in item:
                _url(item["link"], f"{where}.link", errors)

    for index, action in enumerate(_list(data.get("actions"), "report.actions", errors)):
        where = f"report.actions[{index}]"
        if _keys(action, ACTION_KEYS, where, errors):
            _text(action.get("label"), f"{where}.label", errors, 120)
            _text(action.get("prompt"), f"{where}.prompt", errors, PROMPT_MAX)
            if not isinstance(action.get("irreversible"), bool):
                errors.append(f"{where}.irreversible: нужно true или false")

    session = data.get("session")
    if _keys(session, SESSION_KEYS, "report.session", errors):
        if session.get("agent") not in AGENTS:
            errors.append(f"report.session.agent: допустимы {', '.join(sorted(AGENTS))}")
        _text(session.get("id"), "report.session.id", errors, 120)
        _text(session.get("branch"), "report.session.branch", errors, 200)
        worktree = session.get("worktree")
        _text(worktree, "report.session.worktree", errors, 500)
        if isinstance(worktree, str) and not worktree.startswith("/"):
            errors.append("report.session.worktree: нужен абсолютный путь")
        pr = session.get("pr")
        if isinstance(pr, list):
            for index, url in enumerate(pr):
                _url(url, f"report.session.pr[{index}]", errors)
        elif isinstance(pr, str):  # старая форма: один PR строкой
            _url(pr, "report.session.pr", errors)
        elif pr is not None:
            errors.append("report.session.pr: нужен список ссылок на PR")
    return errors


def check_folder(folder: Path) -> tuple[dict[str, Any] | None, list[str]]:
    """Форма всей папки отчёта: ядро и необязательное тело."""
    errors: list[str] = []
    core = folder / "report.json"
    if not core.is_file():
        return None, [f"{core}: файл не найден"]
    try:
        data = json.loads(core.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        return None, [f"{core}: не JSON: {error}"]
    errors.extend(validate(data))
    bodies = [name for name in ("body.html", "body.md") if (folder / name).exists()]
    if len(bodies) > 1:
        errors.append("тело: оставь один файл, body.html или body.md")
    for name in bodies:
        if not (folder / name).read_text(encoding="utf-8", errors="replace").strip():
            errors.append(f"{name}: пустой файл; удали его или заполни")
    extra = sorted(
        item.name for item in folder.iterdir()
        if item.name not in {"report.json", "body.html", "body.md", "assets"}
        and not item.name.startswith(".")
    )
    if extra:
        errors.append(f"лишние файлы: {', '.join(extra)}; картинки и видео клади в assets/")
    return data, errors


# ── Факты из git, tracker и Herdr ─────────────────────────────────────────


def _run(args: list[str], cwd: Path | None = None, timeout: float = 10) -> str | None:
    try:
        done = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return done.stdout.strip() if done.returncode == 0 else None


def main_checkout(path: Path) -> Path | None:
    """Основной каталог проекта: из worktree он находится через общий каталог git."""
    common = _run(["git", "-C", str(path), "rev-parse", "--path-format=absolute", "--git-common-dir"])
    if not common:
        return None
    common_path = Path(common).resolve()
    return common_path.parent if common_path.name == ".git" else common_path


def report_id(folder: Path) -> str:
    """Постоянный адрес отчёта на странице: хеш абсолютного пути папки."""
    return hashlib.sha1(str(folder.resolve()).encode("utf-8")).hexdigest()[:12]


def report_url(folder: Path) -> str:
    return f"http://127.0.0.1:{PORT}/r/{report_id(folder)}"


def slug(text: str, limit: int = 48) -> str:
    value = SLUG.sub("-", text.lower()).strip("-")
    return value[:limit].strip("-") or "report"


def herdr_session() -> tuple[str, str] | None:
    pane = os.environ.get("HERDR_PANE_ID")
    if not pane:
        return None
    raw = _run(["herdr", "pane", "get", pane], timeout=5)
    try:
        session = json.loads(raw or "")["result"]["pane"]["agent_session"]
        return session.get("agent") or "", session["value"]
    except (ValueError, KeyError, TypeError):
        return None


def session_facts(agent: str | None) -> tuple[str, str]:
    if os.environ.get("CLAUDE_CODE_SESSION_ID"):
        return agent or "claude-code", os.environ["CLAUDE_CODE_SESSION_ID"]
    if os.environ.get("CODEX_THREAD_ID"):
        return agent or "codex", os.environ["CODEX_THREAD_ID"]
    found = herdr_session()
    if found:
        kind = {"claude": "claude-code", "codex": "codex"}.get(found[0], "other")
        return agent or kind, found[1]
    return agent or "other", "unknown"


def bound_worktree(session_id: str) -> Path | None:
    """Worktree из привязки сессии (hook по фактам git), если она есть."""
    tool = Path.home() / ".local/bin/herdr-agent-context"
    raw = _run([str(tool), "binding", "--session", session_id, "--json"], timeout=5) if tool.exists() else None
    try:
        value = json.loads(raw or "")
        path = value.get("worktree_path") if value.get("state") == "bound" else None
        return Path(path) if path and Path(path).is_dir() else None
    except (ValueError, AttributeError):
        return None


def task_facts(ref: str, cwd: Path) -> tuple[Any, str]:
    """Задача: номер или ссылка tracker даёт объект, иное остаётся строкой."""
    match = re.fullmatch(r"#?(\d+)", ref.strip())
    if match or URL.match(ref.strip()):
        raw = _run(["gh", "issue", "view", ref.strip().lstrip("#"), "--json", "number,title,url"], cwd=cwd)
        try:
            issue = json.loads(raw or "")
            return {"id": f"#{issue['number']}", "title": issue["title"], "url": issue["url"]}, str(issue["number"])
        except (ValueError, KeyError):
            number = match.group(1) if match else slug(ref)
            return {"id": f"#{number}", "title": f"Задача #{number}"}, number
    return ref.strip(), slug(ref, 32)


def new(args: argparse.Namespace) -> int:
    agent, session_id = session_facts(args.agent)
    worktree = Path(args.worktree).expanduser() if args.worktree else bound_worktree(session_id)
    worktree = worktree or Path.cwd()
    top = _run(["git", "-C", str(worktree), "rev-parse", "--show-toplevel"])
    if not top:
        print(f"report: {worktree} не в репозитории git; укажи --worktree", file=sys.stderr)
        return 1
    worktree = Path(top)
    main = main_checkout(worktree)
    branch = _run(["git", "-C", str(worktree), "branch", "--show-current"]) or "detached"
    pr: list[str] = []
    if branch not in {"detached", "main", "master", "dev"}:
        raw = _run(["gh", "pr", "list", "--state", "all", "--head", branch, "--json", "url", "-q", ".[].url"], cwd=worktree)
        pr = (raw or "").split()
    task, task_slug = task_facts(args.task, worktree)
    now = datetime.now().astimezone().replace(microsecond=0)
    base = main / ".reports" / task_slug
    folder = base / f"{now:%Y-%m-%d}-{slug(args.name)}"
    suffix = 2
    while folder.exists():
        folder = base / f"{now:%Y-%m-%d}-{slug(args.name)}-{suffix}"
        suffix += 1
    folder.mkdir(parents=True)
    core = {
        "version": VERSION,
        "project": main.name,
        "task": task,
        "status": "",
        "created_at": now.isoformat(),
        "summary": [],
        "needs_owner": [],
        "verification": {"auto": [], "manual": [], "unverified": []},
        "next": [],
        "actions": [],
        "session": {"agent": agent, "id": session_id, "branch": branch, "worktree": str(worktree), "pr": pr},
    }
    (folder / "report.json").write_text(json.dumps(core, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if _run(["git", "-C", str(main), "check-ignore", "-q", ".reports/x"]) is None:
        print(f"report: внимание, .reports/ не игнорируется git в {main}; добавь строку .reports/ в .gitignore",
              file=sys.stderr)
    print(folder)
    return 0


def check(args: argparse.Namespace) -> int:
    _, errors = check_folder(Path(args.folder))
    for error in errors:
        print(f"ошибка: {error}", file=sys.stderr)
    print("FAIL" if errors else "OK")
    return 1 if errors else 0


def finish(args: argparse.Namespace) -> int:
    folder = Path(args.folder).resolve()
    data, errors = check_folder(folder)
    if errors or data is None:
        for error in errors:
            print(f"ошибка: {error}", file=sys.stderr)
        print("Отчёт не сдан: исправь ошибки и запусти finish снова.", file=sys.stderr)
        return 1
    # Время отчёта — время сдачи. Старая форма PR переходит в список.
    data["finished_at"] = datetime.now().astimezone().replace(microsecond=0).isoformat()
    data["session"]["pr"] = prs(data["session"])
    (folder / "report.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Отчёт: {report_url(folder)}")
    print(f"Папка: {folder}")
    print(f"Итог: {STATUSES[data['status']]}. {data['summary'][0]}")
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = root.add_subparsers(dest="command", required=True)
    new_parser = commands.add_parser("new", help="создать папку отчёта с фактами")
    new_parser.add_argument("--task", required=True, help="номер задачи, ссылка или строка")
    new_parser.add_argument("--name", required=True, help="короткое имя отчёта")
    new_parser.add_argument("--worktree", help="где шла работа; по умолчанию привязка сессии или текущий каталог")
    new_parser.add_argument("--agent", choices=sorted(AGENTS))
    new_parser.set_defaults(handler=new)
    for name, handler in (("check", check), ("finish", finish)):
        sub = commands.add_parser(name)
        sub.add_argument("folder")
        sub.set_defaults(handler=handler)
    return root


def main() -> int:
    args = parser().parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    sys.exit(main())
