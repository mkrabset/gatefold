#!/bin/bash

pnpm build
rm -rf ../../github.com/pages/gatefold/assets/*
cp -r apps/gatefold/dist/* ../../github.com/pages/gatefold/
cp docs/USER_GUIDE.html ../../github.com/pages/gatefold/
cp examples/design.gatefold.json ../../github.com/pages/gatefold/design.gatefold.json

