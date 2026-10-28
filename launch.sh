#!/bin/bash
cd /home/ali/inkwell
unset ELECTRON_RUN_AS_NODE
exec node_modules/electron/dist/electron --no-sandbox . "$@"
