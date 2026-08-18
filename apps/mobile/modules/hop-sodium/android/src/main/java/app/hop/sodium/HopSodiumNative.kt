package app.hop.sodium

internal object HopSodiumNative {
  init {
    System.loadLibrary("hop-sodium")
  }

  @JvmStatic external fun init(): Int
  @JvmStatic external fun version(): String
  @JvmStatic external fun cryptoBoxKeypair(): Array<ByteArray>?
  @JvmStatic external fun cryptoBoxEasy(message: ByteArray, nonce: ByteArray, pk: ByteArray, sk: ByteArray): ByteArray?
  @JvmStatic external fun cryptoBoxOpenEasy(ciphertext: ByteArray, nonce: ByteArray, pk: ByteArray, sk: ByteArray): ByteArray?
  @JvmStatic external fun cryptoBoxBeforenm(pk: ByteArray, sk: ByteArray): ByteArray?
  @JvmStatic external fun cryptoAuth(message: ByteArray, key: ByteArray): ByteArray?
  @JvmStatic external fun cryptoAuthVerify(mac: ByteArray, message: ByteArray, key: ByteArray): Boolean
  @JvmStatic external fun cryptoGenerichash(outlen: Int, message: ByteArray, key: ByteArray?): ByteArray?
  @JvmStatic external fun randomBytesBuf(size: Int): ByteArray?
}
