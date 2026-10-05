#!/usr/bin/env bash
# Revisa el frontend desplegado (solo lectura: peticiones GET al sitio público).
# Descarga index.html y todos los .js de /assets (incluye los chunks lazy que
# referencia el bundle) y cuenta en cuántos archivos aparece cada cadena.
# Uso: revisar-bundle.sh <cadena> [<cadena> ...]
#   SITIO=https://otro-dominio revisar-bundle.sh registrar_devolucion
set -euo pipefail
SITIO="${SITIO:-https://sistema.cubopolar.com}"
[ "$#" -ge 1 ] || { echo "uso: $0 <cadena> [<cadena> ...]" >&2; exit 2; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsS "$SITIO/" -o "$TMP/index.html"
grep -o -E 'assets/[A-Za-z0-9_.-]+\.js' "$TMP/index.html" | sort -u > "$TMP/lista.txt"
: > "$TMP/vistos.txt"
while :; do
  comm -23 "$TMP/lista.txt" "$TMP/vistos.txt" > "$TMP/nuevos.txt"
  [ -s "$TMP/nuevos.txt" ] || break
  while read -r a; do
    curl -fsS "$SITIO/$a" -o "$TMP/$(basename "$a")" || echo "no se pudo bajar $a" >&2
  done < "$TMP/nuevos.txt"
  sort -u "$TMP/lista.txt" "$TMP/vistos.txt" -o "$TMP/vistos.txt"
  cat "$TMP"/*.js 2>/dev/null | grep -o -E '[A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.js' | sed 's#^#assets/#' | sort -u > "$TMP/refs.txt" || true
  sort -u "$TMP/lista.txt" "$TMP/refs.txt" -o "$TMP/lista.txt"
done
echo "sitio: $SITIO"
echo "entrada: $(grep -o -E 'assets/index-[A-Za-z0-9_-]+\.js' "$TMP/index.html" | head -1)"
echo "archivos js: $(ls "$TMP"/*.js | wc -l | tr -d ' ')"
for cadena in "$@"; do
  n="$( (grep -l -F -- "$cadena" "$TMP"/*.js 2>/dev/null || true) | wc -l | tr -d ' ')"
  echo "$cadena: $n archivo(s)"
done
