#!/usr/bin/env bash
# images.sh: both deploy targets through mirror.gcr.io at the pinned digests (Docker Hub 429s this host); the server
# target from a copy of deploy/Containerfile whose one apt step fetches over HTTPS with the build CA (the proxy refuses
# plain-HTTP apt). Review only: the committed file is unchanged.
set -uo pipefail
W=/home/user/mb; O=/home/user/rev/out; cd "$W"
sed 's#^RUN apt-get update && apt-get install#RUN --mount=type=secret,id=build_ca,target=/ca.crt sed -i "s|http://|https://|" /etc/apt/sources.list.d/debian.sources \&\& apt-get -o Acquire::https::CAInfo=/ca.crt update \&\& apt-get -o Acquire::https::CAInfo=/ca.crt install#' \
  deploy/Containerfile > /home/user/rev/Containerfile.https
diff deploy/Containerfile /home/user/rev/Containerfile.https > "$O/image-server-https.diff"
for tg in server web; do
  f=deploy/Containerfile; [[ $tg == server ]] && f=/home/user/rev/Containerfile.https
  t=$SECONDS; DOCKER_BUILDKIT=1 docker build --network host -q -f $f --target $tg -t mbr-$tg --build-arg REGISTRY=mirror.gcr.io/library \
    --secret id=build_ca,src=/root/.ccr/ca-bundle.crt --build-arg HTTPS_PROXY="$HTTPS_PROXY" --build-arg HTTP_PROXY="${HTTP_PROXY:-$HTTPS_PROXY}" \
    --build-arg https_proxy="$HTTPS_PROXY" --build-arg http_proxy="${HTTP_PROXY:-$HTTPS_PROXY}" . > "$O/image-$tg-mirror.log" 2>&1; rc=$?
  echo "image-$tg-mirror $rc $((SECONDS-t))s $(docker image inspect -f '{{.Size}}' mbr-$tg 2>/dev/null)" >> "$O/progress"
done
