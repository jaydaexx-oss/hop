#include <stdio.h>
#include <string.h>

#include "hop_sodium.h"

static int from_hex(uint8_t *out, size_t outlen, const char *hex) {
  size_t hexlen = strlen(hex);
  if (hexlen != outlen * 2) {
    return -1;
  }
  for (size_t i = 0; i < outlen; i++) {
    unsigned int byte = 0;
    if (sscanf(hex + (i * 2), "%2x", &byte) != 1) {
      return -1;
    }
    out[i] = (uint8_t) byte;
  }
  return 0;
}

static int expect_hex(const char *name, const uint8_t *got, size_t len, const char *hex) {
  uint8_t expected[512];
  if (len > sizeof expected || from_hex(expected, len, hex) != 0) {
    fprintf(stderr, "%s: bad expected hex\n", name);
    return -1;
  }
  if (memcmp(got, expected, len) != 0) {
    fprintf(stderr, "%s: mismatch\n", name);
    return -1;
  }
  return 0;
}

int main(void) {
  if (hop_sodium_init() < 0) {
    fprintf(stderr, "sodium_init failed\n");
    return 1;
  }
  if (strcmp(hop_sodium_version(), "1.0.20") != 0) {
    fprintf(stderr, "unexpected version %s\n", hop_sodium_version());
    return 1;
  }

  uint8_t alicesk[32], alicepk[32], bobsk[32], bobpk[32], nonce[24], message[131];
  uint8_t boxed[147], opened[131], empty[16], shared[32], digest[32], mac[32];
  const char *transcript = "transcript";
  const char *context = "hop-ble-hs-v3";

  if (from_hex(alicesk, 32, "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a") != 0 ||
      from_hex(alicepk, 32, "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a") != 0 ||
      from_hex(bobsk, 32, "5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb") != 0 ||
      from_hex(bobpk, 32, "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f") != 0 ||
      from_hex(nonce, 24, "69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37") != 0 ||
      from_hex(message, 131, "be075fc53c81f2d5cf141316ebeb0c7b5228c52a4c62cbd44b66849b64244ffce5ecbaaf33bd751a1ac728d45e6c61296cdc3c01233561f41db66cce314adb310e3be8250c46f06dceea3a7fa1348057e2f6556ad6b1318a024a838f21af1fde048977eb48f59ffd4924ca1c60902e52f0a089bc76897040e082f937763848645e0705") != 0) {
    fprintf(stderr, "vector parse failed\n");
    return 1;
  }

  if (hop_crypto_box_easy(boxed, message, 131, nonce, bobpk, alicesk) != 0) {
    fprintf(stderr, "crypto_box_easy failed\n");
    return 1;
  }
  if (expect_hex("crypto_box_easy", boxed, 147, "f3ffc7703f9400e52a7dfb4b3d3305d98e993b9f48681273c29650ba32fc76ce48332ea7164d96a4476fb8c531a1186ac0dfc17c98dce87b4da7f011ec48c97271d2c20f9b928fe2270d6fb863d51738b48eeee314a7cc8ab932164548e526ae90224368517acfeabd6bb3732bc0e9da99832b61ca01b6de56244a9e88d5f9b37973f622a43d14a6599b1f654cb45a74e355a5") != 0) {
    return 1;
  }
  if (hop_crypto_box_open_easy(opened, boxed, 147, nonce, alicepk, bobsk) != 0 ||
      memcmp(opened, message, 131) != 0) {
    fprintf(stderr, "crypto_box_open_easy failed\n");
    return 1;
  }
  if (hop_crypto_box_easy(empty, NULL, 0, nonce, bobpk, alicesk) != 0 ||
      expect_hex("empty box", empty, 16, "2539121d8e234e652d651fa4c8cff880") != 0) {
    return 1;
  }
  if (hop_crypto_box_beforenm(shared, bobpk, alicesk) != 0 ||
      expect_hex("beforenm", shared, 32, "1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389") != 0) {
    return 1;
  }
  if (hop_crypto_generichash(digest, 32, shared, 32, (const uint8_t *) context, strlen(context)) != 0 ||
      expect_hex("generichash", digest, 32, "0ab2f0615a3e628390fda4e68474901acc8a95f9c4c104c841467938bb512d92") != 0) {
    return 1;
  }
  if (hop_crypto_auth(mac, (const uint8_t *) transcript, strlen(transcript), digest) != 0 ||
      expect_hex("auth", mac, 32, "d3f804a6a48e126029cbd717739f4a4bc99e40fd9dd4388b41ee85ba6e480b17") != 0) {
    return 1;
  }
  if (hop_crypto_auth_verify(mac, (const uint8_t *) transcript, strlen(transcript), digest) != 0) {
    fprintf(stderr, "auth_verify failed\n");
    return 1;
  }
  printf("hop-sodium host vectors ok (libsodium %s)\n", hop_sodium_version());
  return 0;
}
