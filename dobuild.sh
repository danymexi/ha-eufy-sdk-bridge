#!/bin/sh
set -e
cd /opt/eufy-bridge/build-combo
echo SDK-tarball-contents:
tar tzf eufy-sdk-local.tgz | head -3
echo building...
docker build -f Dockerfile.local -t ha-eufy-sdk-bridge:combo . 2>&1 | tail -18
