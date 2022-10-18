#!/bin/bash
cd "$(dirname "$0")"

host=localhost

for arg in "$@"
do
  case "$arg" in
    --host=*) host="${arg#*=}";;
  esac
done

openssl req -new -nodes -newkey ec:<(openssl ecparam -name prime256v1) -keyout server.key -subj "/CN=$host/" | openssl x509 -req -extfile extensions -days 14 -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt
