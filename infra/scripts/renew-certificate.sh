#!/bin/sh
set -eu

docker compose --env-file .env -f docker-compose.prod.yml run --rm certbot renew
docker compose --env-file .env -f docker-compose.prod.yml exec nginx nginx -s reload
