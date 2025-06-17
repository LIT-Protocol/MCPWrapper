#!/bin/bash

./scripts/dockerBuild.sh
./scripts/dockerPush.sh
./scripts/phalaCreateCVM.sh