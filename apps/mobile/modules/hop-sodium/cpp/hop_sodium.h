#ifndef HOP_SODIUM_H
#define HOP_SODIUM_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define HOP_SODIUM_VERSION "1.0.20"
#define HOP_CRYPTO_BOX_PUBLICKEYBYTES 32
#define HOP_CRYPTO_BOX_SECRETKEYBYTES 32
#define HOP_CRYPTO_BOX_NONCEBYTES 24
#define HOP_CRYPTO_BOX_MACBYTES 16
#define HOP_CRYPTO_BOX_BEFORENMBYTES 32
#define HOP_CRYPTO_AUTH_KEYBYTES 32
#define HOP_CRYPTO_AUTH_BYTES 32

int hop_sodium_init(void);
const char *hop_sodium_version(void);

int hop_crypto_box_keypair(uint8_t *pk, uint8_t *sk);
int hop_crypto_box_easy(
  uint8_t *c,
  const uint8_t *m,
  unsigned long long mlen,
  const uint8_t *n,
  const uint8_t *pk,
  const uint8_t *sk
);
int hop_crypto_box_open_easy(
  uint8_t *m,
  const uint8_t *c,
  unsigned long long clen,
  const uint8_t *n,
  const uint8_t *pk,
  const uint8_t *sk
);
int hop_crypto_box_beforenm(uint8_t *k, const uint8_t *pk, const uint8_t *sk);
int hop_crypto_auth(uint8_t *out, const uint8_t *in, unsigned long long inlen, const uint8_t *k);
int hop_crypto_auth_verify(const uint8_t *h, const uint8_t *in, unsigned long long inlen, const uint8_t *k);
int hop_crypto_generichash(
  uint8_t *out,
  size_t outlen,
  const uint8_t *in,
  unsigned long long inlen,
  const uint8_t *key,
  size_t keylen
);
int hop_randombytes_buf(uint8_t *buf, size_t size);

#ifdef __cplusplus
}
#endif

#endif
