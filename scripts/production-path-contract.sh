#!/usr/bin/env bash

production_require_canonical_absolute_path() {
  local path="$1"
  local label="$2"
  local component
  local -a components

  if [[ "$path" != /* || "$path" == "/" || "$path" == */ || "$path" == *//* ]]; then
    echo "$label must be a canonical absolute non-root path" >&2
    return 1
  fi
  IFS='/' read -r -a components <<< "${path#/}"
  for component in "${components[@]}"; do
    if [[ -z "$component" || "$component" == "." || "$component" == ".." ]]; then
      echo "$label must be a canonical absolute non-root path" >&2
      return 1
    fi
  done
}

production_require_canonical_directory() {
  local path="$1"
  local label="$2"
  local component
  local current_path=""
  local -a components

  production_require_canonical_absolute_path "$path" "$label" || return 1
  IFS='/' read -r -a components <<< "${path#/}"
  for component in "${components[@]}"; do
    current_path="$current_path/$component"
    if [[ -L "$current_path" ]]; then
      echo "$label must not contain a symbolic link" >&2
      return 1
    fi
  done
  if [[ ! -d "$path" ]]; then
    echo "$label must be a directory" >&2
    return 1
  fi
}
