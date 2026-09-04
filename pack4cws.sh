#!/bin/bash

outdir="${1:-dist}"
npm run package:chrome -- "$outdir"
