#include "hop_sodium.h"

#include <sodium.h>
#include <string.h>

int hop_sodium_init(void) {
  return sodium_init();
}

const char *hop_sodium_version(void) {
  return sodium_version_string();
}

int hop_crypto_box_keypair(uint8_t *pk, uint8_t *sk) {
  if (pk == NULL || sk == NULL) {
    return -1;
  }
  return crypto_box_keypair(pk, sk);
}

int hop_crypto_box_easy(
  uint8_t *c,
  const uint8_t *m,
  unsigned long long mlen,
  const uint8_t *n,
  const uint8_t *pk,
  const uint8_t *sk
) {
  if (c == NULL || n == NULL || pk == NULL || sk == NULL || (mlen > 0 && m == NULL)) {
    return -1;
  }
  return crypto_box_easy(c, m, mlen, n, pk, sk);
}

int hop_crypto_box_open_easy(
  uint8_t *m,
  const uint8_t *c,
  unsigned long long clen,
  const uint8_t *n,
  const uint8_t *pk,
  const uint8_t *sk
) {
  if (c == NULL || n == NULL || pk == NULL || sk == NULL || (clen > crypto_box_MACBYTES && m == NULL)) {
    return -1;
  }
  return crypto_box_open_easy(m, c, clen, n, pk, sk);
}

int hop_crypto_box_beforenm(uint8_t *k, const uint8_t *pk, const uint8_t *sk) {
  if (k == NULL || pk == NULL || sk == NULL) {
    return -1;
  }
  return crypto_box_beforenm(k, pk, sk);
}

int hop_crypto_auth(uint8_t *out, const uint8_t *in, unsigned long long inlen, const uint8_t *k) {
  if (out == NULL || k == NULL || (inlen > 0 && in == NULL)) {
    return -1;
  }
  return crypto_auth(out, in, inlen, k);
}

int hop_crypto_auth_verify(const uint8_t *h, const uint8_t *in, unsigned long long inlen, const uint8_t *k) {
  if (h == NULL || k == NULL || (inlen > 0 && in == NULL)) {
    return -1;
  }
  return crypto_auth_verify(h, in, inlen, k);
}

int hop_crypto_generichash(
  uint8_t *out,
  size_t outlen,
  const uint8_t *in,
  unsigned long long inlen,
  const uint8_t *key,
  size_t keylen
) {
  if (out == NULL || (inlen > 0 && in == NULL) || (keylen > 0 && key == NULL)) {
    return -1;
  }
  return crypto_generichash(out, outlen, in, inlen, key, keylen);
}

int hop_randombytes_buf(uint8_t *buf, size_t size) {
  if (buf == NULL && size > 0) {
    return -1;
  }
  randombytes_buf(buf, size);
  return 0;
}
