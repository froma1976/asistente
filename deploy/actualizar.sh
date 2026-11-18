#!/usr/bin/env bash
set -euo pipefail
cd /opt/clara/releases
exec 9>.lock
flock -n 9 || exit 0
flag=/opt/clara/privado/datos/.deploying
trap 'rm -f "$flag"' EXIT
rm -f "$flag"
if [[ ! -d codigo/.git ]]; then
  git clone --single-branch --branch produccion https://github.com/froma1976/asistente.git codigo
fi
git -C codigo fetch --quiet origin produccion
sha=$(git -C codigo rev-parse FETCH_HEAD)
[[ $(cat aplicada 2>/dev/null || :) != "$sha" ]] || exit 0
[[ $(cat fallida 2>/dev/null || :) != "$sha" ]] || exit 0
git -C codigo checkout -q --detach "$sha"
compose=(docker compose -p clara -f /opt/clara/compose.yaml -f /opt/clara/compose.override.yaml)
id=$("${compose[@]}" ps -q clara)
test -n "$id"
estado() {
  docker exec "$1" node -e '
    fetch("http://127.0.0.1:3030/api/phone",{headers:{Authorization:"Basic "+Buffer.from("clara:"+process.env.CLARA_PASSWORD).toString("base64")},signal:AbortSignal.timeout(4000)})
    .then(async r=>{if(!r.ok)throw Error();const p=await r.json();if(!Array.isArray(p.missing)||p.missing.length)throw Error();console.log(p.busy||p.call?.status==="screening"?"ocupada":"lista")}).catch(()=>process.exit(1))'
}
[[ $(estado "$id") == lista ]] || { echo 'Se aplaza: Clara no está disponible.'; exit 0; }
img="clara-publicada:$sha"
docker image inspect "$img" >/dev/null 2>&1 || docker build -t "$img" codigo
old=$(docker inspect -f '{{.Image}}' "$id")
docker tag "$old" clara-publicada:anterior
usar() {
  printf 'services:\n  clara:\n    image: "%s"\n' "$1" > imagen.yaml
  "${compose[@]}" -f "$PWD/imagen.yaml" up -d --no-build --no-deps clara
}
touch "$flag"
[[ $(estado "$id") == lista ]] || { echo 'Se aplaza por llamada.'; exit 0; }
if usar "$img"; then
  nuevo=$("${compose[@]}" ps -q clara)
  for i in {1..20}; do
    if estado "$nuevo" >/dev/null 2>&1; then
      echo "$sha" > aplicada
      echo "Publicada $sha"
      exit 0
    fi
    sleep 1
  done
fi
usar clara-publicada:anterior
echo "$sha" > fallida
echo 'No pasó la comprobación. Recuperada la imagen anterior.' >&2
exit 1
