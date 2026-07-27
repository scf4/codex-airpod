#!/bin/zsh
set -euo pipefail

root="${0:A:h}"

is_supported_node() {
  local candidate="$1"
  local major=""

  [[ -x "$candidate" ]] || return 1
  major="$(
    "$candidate" -p 'process.versions.node.split(".")[0]' 2>/dev/null
  )" || return 1
  [[ "$major" == <-> ]] || return 1
  (( major >= 20 ))
}

select_supported_node() {
  local candidate
  for candidate in "$@"; do
    if is_supported_node "$candidate"; then
      print -r -- "$candidate"
      return 0
    fi
  done
  return 1
}

find_supported_node() {
  local path_node=""
  if command -v node >/dev/null 2>&1; then
    path_node="$(command -v node)"
  fi
  select_supported_node \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$path_node"
}

prompt_for_relaunch() {
  local key=""
  print -n -r -- \
    "ChatGPT is already running. Press Return to quit and relaunch it, or any other key to cancel."
  if ! IFS= read -rsk 1 -u 0 key; then
    print
    return 1
  fi
  print
  [[ -z "$key" || "$key" == $'\n' || "$key" == $'\r' ]]
}

run_finder_launcher() {
  local node="$1"
  local project_root="$2"
  local argument=""
  local output=""
  local launch_status=0
  shift 2

  output="$(
    "$node" "$project_root/src/launch.cjs" "$@" 2>&1
  )" || launch_status=$?

  if (( launch_status == 2 )); then
    for argument in "$@"; do
      if [[ "$argument" == "--check" ]]; then
        print -u2 -r -- "$output"
        return "$launch_status"
      fi
    done
    if ! prompt_for_relaunch; then
      return 0
    fi
    exec "$node" \
      "$project_root/src/launch.cjs" \
      --quit-running \
      "$@"
  fi

  if [[ -n "$output" ]]; then
    if (( launch_status == 0 )); then
      print -r -- "$output"
    else
      print -u2 -r -- "$output"
    fi
  fi
  return "$launch_status"
}

main() {
  local node=""
  node="$(find_supported_node)" || {
    print -u2 "Node.js 20 or newer is required."
    return 1
  }
  run_finder_launcher "$node" "$root" "$@"
}

if [[ "$ZSH_EVAL_CONTEXT" == "toplevel" ]]; then
  main "$@"
fi
