#include <jni.h>
#include <stdlib.h>
#include <string.h>

#include "hop_sodium.h"

static jbyteArray copyBytes(JNIEnv *env, const uint8_t *data, jint length) {
  jbyteArray out = (*env)->NewByteArray(env, length);
  if (out == NULL) {
    return NULL;
  }
  (*env)->SetByteArrayRegion(env, out, 0, length, (const jbyte *) data);
  return out;
}

static int readBytes(JNIEnv *env, jbyteArray array, uint8_t **out, jsize *outLen, jsize expected) {
  if (array == NULL) {
    return -1;
  }
  jsize length = (*env)->GetArrayLength(env, array);
  if (expected >= 0 && length != expected) {
    return -1;
  }
  uint8_t *buf = (uint8_t *) malloc((size_t) length == 0 ? 1 : (size_t) length);
  if (buf == NULL) {
    return -1;
  }
  if (length > 0) {
    (*env)->GetByteArrayRegion(env, array, 0, length, (jbyte *) buf);
  }
  *out = buf;
  *outLen = length;
  return 0;
}

JNIEXPORT jint JNICALL
Java_app_hop_sodium_HopSodiumNative_init(JNIEnv *env, jclass clazz) {
  (void) env;
  (void) clazz;
  return hop_sodium_init();
}

JNIEXPORT jstring JNICALL
Java_app_hop_sodium_HopSodiumNative_version(JNIEnv *env, jclass clazz) {
  (void) clazz;
  return (*env)->NewStringUTF(env, hop_sodium_version());
}

JNIEXPORT jobjectArray JNICALL
Java_app_hop_sodium_HopSodiumNative_cryptoBoxKeypair(JNIEnv *env, jclass clazz) {
  (void) clazz;
  uint8_t pk[HOP_CRYPTO_BOX_PUBLICKEYBYTES];
  uint8_t sk[HOP_CRYPTO_BOX_SECRETKEYBYTES];
  if (hop_crypto_box_keypair(pk, sk) != 0) {
    return NULL;
  }
  jclass byteArrayClass = (*env)->FindClass(env, "[B");
  jobjectArray pair = (*env)->NewObjectArray(env, 2, byteArrayClass, NULL);
  jbyteArray pkArr = copyBytes(env, pk, HOP_CRYPTO_BOX_PUBLICKEYBYTES);
  jbyteArray skArr = copyBytes(env, sk, HOP_CRYPTO_BOX_SECRETKEYBYTES);
  (*env)->SetObjectArrayElement(env, pair, 0, pkArr);
  (*env)->SetObjectArrayElement(env, pair, 1, skArr);
  return pair;
}

JNIEXPORT jbyteArray JNICALL
Java_app_hop_sodium_HopSodiumNative_cryptoBoxEasy(
  JNIEnv *env,
  jclass clazz,
  jbyteArray message,
  jbyteArray nonce,
  jbyteArray pk,
  jbyteArray sk
) {
  (void) clazz;
  uint8_t *m = NULL;
  uint8_t *n = NULL;
  uint8_t *pub = NULL;
  uint8_t *sec = NULL;
  jsize mlen = 0;
  jsize nlen = 0;
  jsize pklen = 0;
  jsize sklen = 0;
  jbyteArray result = NULL;
  if (readBytes(env, message, &m, &mlen, -1) != 0 ||
      readBytes(env, nonce, &n, &nlen, HOP_CRYPTO_BOX_NONCEBYTES) != 0 ||
      readBytes(env, pk, &pub, &pklen, HOP_CRYPTO_BOX_PUBLICKEYBYTES) != 0 ||
      readBytes(env, sk, &sec, &sklen, HOP_CRYPTO_BOX_SECRETKEYBYTES) != 0) {
    goto done;
  }
  jsize clen = mlen + HOP_CRYPTO_BOX_MACBYTES;
  uint8_t *c = (uint8_t *) malloc((size_t) clen);
  if (c == NULL) {
    goto done;
  }
  if (hop_crypto_box_easy(c, m, (unsigned long long) mlen, n, pub, sec) == 0) {
    result = copyBytes(env, c, clen);
  }
  free(c);
done:
  free(m);
  free(n);
  free(pub);
  free(sec);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_app_hop_sodium_HopSodiumNative_cryptoBoxOpenEasy(
  JNIEnv *env,
  jclass clazz,
  jbyteArray ciphertext,
  jbyteArray nonce,
  jbyteArray pk,
  jbyteArray sk
) {
  (void) clazz;
  uint8_t *c = NULL;
  uint8_t *n = NULL;
  uint8_t *pub = NULL;
  uint8_t *sec = NULL;
  jsize clen = 0;
  jsize nlen = 0;
  jsize pklen = 0;
  jsize sklen = 0;
  jbyteArray result = NULL;
  if (readBytes(env, ciphertext, &c, &clen, -1) != 0 ||
      clen < HOP_CRYPTO_BOX_MACBYTES ||
      readBytes(env, nonce, &n, &nlen, HOP_CRYPTO_BOX_NONCEBYTES) != 0 ||
      readBytes(env, pk, &pub, &pklen, HOP_CRYPTO_BOX_PUBLICKEYBYTES) != 0 ||
      readBytes(env, sk, &sec, &sklen, HOP_CRYPTO_BOX_SECRETKEYBYTES) != 0) {
    goto done;
  }
  jsize mlen = clen - HOP_CRYPTO_BOX_MACBYTES;
  uint8_t *m = (uint8_t *) malloc(mlen == 0 ? 1 : (size_t) mlen);
  if (m == NULL) {
    goto done;
  }
  if (hop_crypto_box_open_easy(m, c, (unsigned long long) clen, n, pub, sec) == 0) {
    result = copyBytes(env, m, mlen);
  }
  free(m);
done:
  free(c);
  free(n);
  free(pub);
  free(sec);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_app_hop_sodium_HopSodiumNative_cryptoBoxBeforenm(
  JNIEnv *env,
  jclass clazz,
  jbyteArray pk,
  jbyteArray sk
) {
  (void) clazz;
  uint8_t *pub = NULL;
  uint8_t *sec = NULL;
  jsize pklen = 0;
  jsize sklen = 0;
  jbyteArray result = NULL;
  if (readBytes(env, pk, &pub, &pklen, HOP_CRYPTO_BOX_PUBLICKEYBYTES) != 0 ||
      readBytes(env, sk, &sec, &sklen, HOP_CRYPTO_BOX_SECRETKEYBYTES) != 0) {
    goto done;
  }
  uint8_t k[HOP_CRYPTO_BOX_BEFORENMBYTES];
  if (hop_crypto_box_beforenm(k, pub, sec) == 0) {
    result = copyBytes(env, k, HOP_CRYPTO_BOX_BEFORENMBYTES);
  }
done:
  free(pub);
  free(sec);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_app_hop_sodium_HopSodiumNative_cryptoAuth(
  JNIEnv *env,
  jclass clazz,
  jbyteArray message,
  jbyteArray key
) {
  (void) clazz;
  uint8_t *m = NULL;
  uint8_t *k = NULL;
  jsize mlen = 0;
  jsize klen = 0;
  jbyteArray result = NULL;
  if (readBytes(env, message, &m, &mlen, -1) != 0 ||
      readBytes(env, key, &k, &klen, HOP_CRYPTO_AUTH_KEYBYTES) != 0) {
    goto done;
  }
  uint8_t mac[HOP_CRYPTO_AUTH_BYTES];
  if (hop_crypto_auth(mac, m, (unsigned long long) mlen, k) == 0) {
    result = copyBytes(env, mac, HOP_CRYPTO_AUTH_BYTES);
  }
done:
  free(m);
  free(k);
  return result;
}

JNIEXPORT jboolean JNICALL
Java_app_hop_sodium_HopSodiumNative_cryptoAuthVerify(
  JNIEnv *env,
  jclass clazz,
  jbyteArray mac,
  jbyteArray message,
  jbyteArray key
) {
  (void) clazz;
  uint8_t *h = NULL;
  uint8_t *m = NULL;
  uint8_t *k = NULL;
  jsize hlen = 0;
  jsize mlen = 0;
  jsize klen = 0;
  jboolean ok = JNI_FALSE;
  if (readBytes(env, mac, &h, &hlen, HOP_CRYPTO_AUTH_BYTES) != 0 ||
      readBytes(env, message, &m, &mlen, -1) != 0 ||
      readBytes(env, key, &k, &klen, HOP_CRYPTO_AUTH_KEYBYTES) != 0) {
    goto done;
  }
  if (hop_crypto_auth_verify(h, m, (unsigned long long) mlen, k) == 0) {
    ok = JNI_TRUE;
  }
done:
  free(h);
  free(m);
  free(k);
  return ok;
}

JNIEXPORT jbyteArray JNICALL
Java_app_hop_sodium_HopSodiumNative_cryptoGenerichash(
  JNIEnv *env,
  jclass clazz,
  jint outlen,
  jbyteArray message,
  jbyteArray key
) {
  (void) clazz;
  uint8_t *m = NULL;
  uint8_t *k = NULL;
  jsize mlen = 0;
  jsize klen = 0;
  jbyteArray result = NULL;
  if (outlen <= 0 ||
      readBytes(env, message, &m, &mlen, -1) != 0) {
    return NULL;
  }
  if (key != NULL && readBytes(env, key, &k, &klen, -1) != 0) {
    free(m);
    return NULL;
  }
  uint8_t *out = (uint8_t *) malloc((size_t) outlen);
  if (out != NULL &&
      hop_crypto_generichash(out, (size_t) outlen, m, (unsigned long long) mlen, k, (size_t) klen) == 0) {
    result = copyBytes(env, out, outlen);
  }
  free(out);
  free(m);
  free(k);
  return result;
}

JNIEXPORT jbyteArray JNICALL
Java_app_hop_sodium_HopSodiumNative_randomBytesBuf(JNIEnv *env, jclass clazz, jint size) {
  (void) clazz;
  if (size < 0) {
    return NULL;
  }
  uint8_t *buf = (uint8_t *) malloc(size == 0 ? 1 : (size_t) size);
  if (buf == NULL) {
    return NULL;
  }
  if (hop_randombytes_buf(buf, (size_t) size) != 0) {
    free(buf);
    return NULL;
  }
  jbyteArray result = copyBytes(env, buf, size);
  free(buf);
  return result;
}
