#! /usr/bin/env bash

set -euo pipefail

echo_cmd_and_run() {
    echo '>' "$@" 1>&2
    "$@"
}

main() {
    local base_dir="$1"
    local tsconfigs_file='./out/tsconfigs.txt'
    mkdir -p out/
    echo_cmd_and_run pnpm install --use-stderr --silent
    echo_cmd_and_run fd tsconfig.json --base-directory "${base_dir}" > "${tsconfigs_file}"
    echo_cmd_and_run ./node_modules/.bin/tsc --sourcemap --outDir out
    echo_cmd_and_run node --enable-source-maps out/index.js --tsconfigs "${tsconfigs_file}" --base-dir "${base_dir}"
}

main "$@"