#!/bin/sh
# Resolve from the installed script rather than the user's project directory.
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
exec node "$script_dir/prompt-routing.mjs"
