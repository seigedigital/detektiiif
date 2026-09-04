#!/bin/bash

if [[ -z $1 ]]; then
  echo "Usage: ./settheme.sh <path/to/theme/folder>"
  exit 1
fi

if [[ -n $2 ]]; then
  echo "Manifest version selection is no longer needed; Chrome and Firefox are built as MV3 targets."
fi

if [[ ! -d $1 ]]; then
  echo "$1 is not a directory"
  exit 1
fi

if [[ ! -f "$1/manifest.common.json" ]]; then
  echo "$1 does not contain manifest.common.json"
  exit 1
fi

rm -f active
rm -f manifest.json
ln -s "$1" active
ln -s "$1/manifest.common.json" manifest.json

echo "Active theme: $1"
