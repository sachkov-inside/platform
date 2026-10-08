#!/usr/bin/env bash
set -eu
sleep 600 &
load=$!
cleanup() {
  kill "$load" 2>/dev/null || true
  wait "$load" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "$load"
case "$1" in
  success) exit 0 ;;
  failure) exit 23 ;;
  signal) kill -TERM "$$" ;;
esac
