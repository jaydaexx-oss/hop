#!/bin/sh
set -eu

# Run from infra/ with infra/.env loaded.
# Example:
#   docker compose --env-file .env -f docker-compose.prod.yml run --rm certbot \
#     certonly --webroot -w /var/www/certbot \
#     -d "${API_DOMAIN}" --email "${LETSENCRYPT_EMAIL}" --agree-tos --no-eff-email

if [ -z "${API_DOMAIN:-}" ] || [ -z "${LETSENCRYPT_EMAIL:-}" ]; then
  echo "Set API_DOMAIN and LETSENCRYPT_EMAIL in infra/.env" >&2
  exit 1
fi

docker compose --env-file .env -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot -w /var/www/certbot \
  -d "${API_DOMAIN}" \
  --email "${LETSENCRYPT_EMAIL}" \
  --agree-tos --no-eff-email

echo "Certificate obtained. Render nginx SSL config and reload nginx:"
echo "  sed \"s/YOUR_API_DOMAIN/${API_DOMAIN}/g\" nginx/conf.d/hop-api.ssl.conf > nginx/conf.d/hop-api.conf"
echo "  docker compose --env-file .env -f docker-compose.prod.yml exec nginx nginx -s reload"
