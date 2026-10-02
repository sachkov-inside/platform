#!/usr/bin/env bash
# Copies the developer process of Inside from this repository into another one, or checks that an
# existing copy is byte-for-byte equal (#848). The process is WORKFLOW.md, the skills without the
# frontend set, the triage labels document and the GitHub labels.
#
#   bash scripts/copy-process.sh <target-repository>
#   bash scripts/copy-process.sh --check <target-repository>
#
# --skip-labels leaves the GitHub labels of the target alone.
set -euo pipefail

usage() {
  echo "Usage: bash scripts/copy-process.sh [--check] [--skip-labels] <target-repository>" >&2
  exit 2
}

mode="copy"
labels="yes"
target=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) mode="check" ;;
    --skip-labels) labels="no" ;;
    -*) usage ;;
    *)
      if [ -n "$target" ]; then usage; fi
      target="$1"
      ;;
  esac
  shift
done
if [ -z "$target" ] || [ ! -e "$target/.git" ]; then usage; fi

source_root="$(cd "$(dirname "$0")/.." && pwd)"
target="$(cd "$target" && pwd)"
if [ "$source_root" = "$target" ]; then
  echo "The target is the source repository." >&2
  exit 2
fi

frontend_skills="impeccable vercel-react-best-practices modern-web-guidance playwright-cli"
process_files="WORKFLOW.md docs/agents/triage-labels.md .agents/skills/UPSTREAM.md"
# name|color|description
process_labels="needs-triage|c5def5|Maintainer evaluation is required
needs-info|fbca04|Reporter information is required
ready-for-agent|0e8a16|Fully specified for autonomous agent implementation
ready-for-human|d4c5f9|Human implementation or judgment is required
wontfix|ffffff|This work will not be actioned
wayfinder:map|5319e7|Canonical Wayfinder map
wayfinder:research|0e8a16|Wayfinder research ticket
wayfinder:prototype|fbca04|Wayfinder prototype ticket
wayfinder:grilling|d93f0b|Wayfinder grilling ticket
wayfinder:task|1d76db|Wayfinder execution ticket"

process_skills=""
for directory in "$source_root"/.agents/skills/*/; do
  name="$(basename "$directory")"
  case " $frontend_skills " in
    *" $name "*) ;;
    *) process_skills="$process_skills $name" ;;
  esac
done

failures=0
fail() {
  echo "$1" >&2
  failures=$((failures + 1))
}

if [ "$mode" = "copy" ]; then
  if [ -L "$target/.agents/skills" ]; then
    echo "$target/.agents/skills is a symlink; remove it before copying." >&2
    exit 1
  fi
  for file in $process_files; do
    mkdir -p "$(dirname "$target/$file")"
    cp "$source_root/$file" "$target/$file"
  done
  for name in $process_skills; do
    rm -rf "$target/.agents/skills/$name"
    cp -R "$source_root/.agents/skills/$name" "$target/.agents/skills/$name"
  done
  mkdir -p "$target/.claude"
  rm -f "$target/.claude/skills"
  ln -s ../.agents/skills "$target/.claude/skills"
  if [ "$labels" = "yes" ]; then
    echo "$process_labels" | while IFS='|' read -r name color description; do
      (cd "$target" && gh label create "$name" --color "$color" --description "$description" --force)
    done
  fi
fi

for file in $process_files; do
  cmp -s "$source_root/$file" "$target/$file" || fail "Differs: $file"
done
for name in $process_skills; do
  diff -rq "$source_root/.agents/skills/$name" "$target/.agents/skills/$name" >&2 ||
    fail "Differs: .agents/skills/$name"
done
for name in $frontend_skills; do
  if [ -e "$target/.agents/skills/$name" ]; then
    fail "Frontend skill is present in the target: $name"
  fi
done
if [ "$(readlink "$target/.claude/skills" 2>/dev/null || true)" != "../.agents/skills" ]; then
  fail ".claude/skills is not a symlink to ../.agents/skills"
fi
if [ "$labels" = "yes" ]; then
  existing="$(cd "$target" && gh label list --limit 200 --json name --jq '.[].name')"
  missing="$(echo "$process_labels" | cut -d'|' -f1 | while read -r name; do
    echo "$existing" | grep -qxF "$name" || echo "$name"
  done)"
  if [ -n "$missing" ]; then
    fail "Missing labels: $(echo "$missing" | tr '\n' ' ')"
  fi
fi

if [ "$failures" -gt 0 ]; then
  echo "Process copy check failed ($failures)." >&2
  exit 1
fi
echo "Process copy in $target equals $source_root."
