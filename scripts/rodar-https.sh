#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

CERT_DIR=".local-https"
PORT="${PORT:-8443}"

if [ ! -f "$CERT_DIR/cert.pem" ] || [ ! -f "$CERT_DIR/key.pem" ]; then
  echo "gerando certificado self-signed em $CERT_DIR/..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" \
    -days 365 -nodes -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1"
fi

echo "servindo https://127.0.0.1:$PORT/ - cadastre essa URL exata como Redirect URI no app do Spotify"
npx --yes http-server -S -C "$CERT_DIR/cert.pem" -K "$CERT_DIR/key.pem" -p "$PORT" -a 127.0.0.1
