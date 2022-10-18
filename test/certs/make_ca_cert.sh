#!/bin/bash
cd "$(dirname "$0")"

cn="bpmux test CA"

for arg in "$@"
do
  case "$arg" in
    --cn=*) cn="${arg#*=}";;
  esac
done

openssl req -new -x509 -nodes -newkey ec:<(openssl ecparam -name prime256v1) -keyout ca.key -out ca.crt -days 3650 -subj "/CN=$cn/"

