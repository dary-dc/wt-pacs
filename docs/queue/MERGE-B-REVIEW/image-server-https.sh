#!/usr/bin/env bash
# image-server-https.sh: the server target from a copy of deploy/Containerfile whose one apt step fetches over HTTPS
# with the build CA (this host's proxy refuses plain-HTTP apt); review only, the committed file unchanged.
set -uo pipefail
W=/home/user/mb; O=/home/user/rev/out; cd "$W"
sed 's#^RUN apt-get update && apt-get install#RUN --mount=type=secret,id=build_ca,target=/ca.crt sed -i "s#http://#https://#" /etc/apt/sources.list.d/debian.sources \&\& apt-get -o Acquire::https::CAInfo=/ca.crt update \&\& apt-get -o Acquire::https::CAInfo=/ca.crt install#' \
  deploy/Containerfile > /home/user/rev/Containerfile.https
diff deploy/Containerfile /home/user/rev/Containerfile.https > "$O/image-server-https.diff"
t=$SECONDS; DOCKER_BUILDKIT=1 docker build --network host -q -f /home/user/rev/Containerfile.https --target server -t mbr-server \
  --secret id=build_ca,src=/root/.ccr/ca-bundle.crt --build-arg HTTPS_PROXY="$HTTPS_PROXY" --build-arg HTTP_PROXY="${HTTP_PROXY:-$HTTPS_PROXY}" \
  --build-arg https_proxy="$HTTPS_PROXY" --build-arg http_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" . > "$O/image-server-https.log" 2>&1; rc=$?
echo "image-server-https $rc $((SECONDS-t))s $(docker image inspect -f '{{.Size}}' mbr-server 2>/dev/null)" >> "$O/progress"
