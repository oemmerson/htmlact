#!/bin/sh
# Build the driver `htmlact-page.js` next to this script. Needs `brr` and
# `js_of_ocaml` (e.g. from the htmlact switch) on PATH. Bypasses b0 so the
# tests do not depend on the build tool's version.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(dirname -- "$here")
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT INT TERM
cp "$root/src/page/htmlact_page.ml" "$root/src/page/htmlact_page.mli" "$tmp/"
cp "$root/src/standalone/htmlact_page_init.ml" "$tmp/"
cd "$tmp"
ocamlfind ocamlc -package brr -c htmlact_page.mli
ocamlfind ocamlc -package brr -I . -c htmlact_page.ml
ocamlfind ocamlc -package brr -I . -c htmlact_page_init.ml
ocamlfind ocamlc -package brr -linkpkg -I . htmlact_page.cmo htmlact_page_init.cmo \
  -o htmlact_page_init.byte
js_of_ocaml htmlact_page_init.byte -o "$here/htmlact-page.js"
echo "built $here/htmlact-page.js"
