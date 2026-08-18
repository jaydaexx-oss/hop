package app.hop.sodium

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HopSodiumException(message: String) : CodedException(message)

class HopSodiumModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HopSodium")

    OnCreate {
      if (HopSodiumNative.init() < 0) {
        throw HopSodiumException("sodium_init failed")
      }
    }

    Constant("crypto_box_NONCEBYTES") { 24 }
    Constant("crypto_box_PUBLICKEYBYTES") { 32 }
    Constant("crypto_box_SECRETKEYBYTES") { 32 }
    Constant("crypto_box_MACBYTES") { 16 }
    Constant("crypto_box_BEFORENMBYTES") { 32 }
    Constant("crypto_auth_KEYBYTES") { 32 }
    Constant("crypto_auth_BYTES") { 32 }
    Constant("version") { HopSodiumNative.version() }

    Function("init") {
      HopSodiumNative.init()
    }

    Function("cryptoBoxKeypair") {
      val pair = HopSodiumNative.cryptoBoxKeypair()
        ?: throw HopSodiumException("crypto_box_keypair failed")
      mapOf("publicKey" to pair[0], "privateKey" to pair[1])
    }

    Function("cryptoBoxEasy") { message: ByteArray, nonce: ByteArray, pk: ByteArray, sk: ByteArray ->
      HopSodiumNative.cryptoBoxEasy(message, nonce, pk, sk)
        ?: throw HopSodiumException("crypto_box_easy failed")
    }

    Function("cryptoBoxOpenEasy") { ciphertext: ByteArray, nonce: ByteArray, pk: ByteArray, sk: ByteArray ->
      HopSodiumNative.cryptoBoxOpenEasy(ciphertext, nonce, pk, sk)
        ?: throw HopSodiumException("crypto_box_open_easy failed")
    }

    Function("cryptoBoxBeforenm") { pk: ByteArray, sk: ByteArray ->
      HopSodiumNative.cryptoBoxBeforenm(pk, sk)
        ?: throw HopSodiumException("crypto_box_beforenm failed")
    }

    Function("cryptoAuth") { message: ByteArray, key: ByteArray ->
      HopSodiumNative.cryptoAuth(message, key)
        ?: throw HopSodiumException("crypto_auth failed")
    }

    Function("cryptoAuthVerify") { mac: ByteArray, message: ByteArray, key: ByteArray ->
      HopSodiumNative.cryptoAuthVerify(mac, message, key)
    }

    Function("cryptoGenerichash") { outlen: Int, message: ByteArray, key: ByteArray? ->
      HopSodiumNative.cryptoGenerichash(outlen, message, key)
        ?: throw HopSodiumException("crypto_generichash failed")
    }

    Function("randomBytesBuf") { size: Int ->
      HopSodiumNative.randomBytesBuf(size)
        ?: throw HopSodiumException("randombytes_buf failed")
    }
  }
}
