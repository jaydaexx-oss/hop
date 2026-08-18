import ExpoModulesCore
import Foundation

private final class HopSodiumFailedException: GenericException<String> {
  override var reason: String {
    "\(param) failed"
  }
}

public class HopSodiumModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HopSodium")

    OnCreate {
      if hop_sodium_init() < 0 {
        assertionFailure("sodium_init failed")
      }
    }

    Constant("crypto_box_NONCEBYTES") { 24 }
    Constant("crypto_box_PUBLICKEYBYTES") { 32 }
    Constant("crypto_box_SECRETKEYBYTES") { 32 }
    Constant("crypto_box_MACBYTES") { 16 }
    Constant("crypto_box_BEFORENMBYTES") { 32 }
    Constant("crypto_auth_KEYBYTES") { 32 }
    Constant("crypto_auth_BYTES") { 32 }
    Constant("version") {
      String(cString: hop_sodium_version())
    }

    Function("init") {
      hop_sodium_init()
    }

    Function("cryptoBoxKeypair") { () -> [String: Data] in
      var pk = Data(count: Int(HOP_CRYPTO_BOX_PUBLICKEYBYTES))
      var sk = Data(count: Int(HOP_CRYPTO_BOX_SECRETKEYBYTES))
      let rc = pk.withUnsafeMutableBytes { pkBuf in
        sk.withUnsafeMutableBytes { skBuf in
          hop_crypto_box_keypair(
            pkBuf.bindMemory(to: UInt8.self).baseAddress,
            skBuf.bindMemory(to: UInt8.self).baseAddress
          )
        }
      }
      if rc != 0 {
        throw HopSodiumFailedException("crypto_box_keypair")
      }
      return ["publicKey": pk, "privateKey": sk]
    }

    Function("cryptoBoxEasy") { (message: Data, nonce: Data, pk: Data, sk: Data) -> Data in
      try Self.requireSize(nonce, Int(HOP_CRYPTO_BOX_NONCEBYTES), "nonce")
      try Self.requireSize(pk, Int(HOP_CRYPTO_BOX_PUBLICKEYBYTES), "pk")
      try Self.requireSize(sk, Int(HOP_CRYPTO_BOX_SECRETKEYBYTES), "sk")
      var ciphertext = Data(count: message.count + Int(HOP_CRYPTO_BOX_MACBYTES))
      let rc = ciphertext.withUnsafeMutableBytes { cBuf in
        message.withUnsafeBytes { mBuf in
          nonce.withUnsafeBytes { nBuf in
            pk.withUnsafeBytes { pkBuf in
              sk.withUnsafeBytes { skBuf in
                hop_crypto_box_easy(
                  cBuf.bindMemory(to: UInt8.self).baseAddress,
                  mBuf.bindMemory(to: UInt8.self).baseAddress,
                  UInt64(message.count),
                  nBuf.bindMemory(to: UInt8.self).baseAddress,
                  pkBuf.bindMemory(to: UInt8.self).baseAddress,
                  skBuf.bindMemory(to: UInt8.self).baseAddress
                )
              }
            }
          }
        }
      }
      if rc != 0 {
        throw HopSodiumFailedException("crypto_box_easy")
      }
      return ciphertext
    }

    Function("cryptoBoxOpenEasy") { (ciphertext: Data, nonce: Data, pk: Data, sk: Data) -> Data in
      try Self.requireSize(nonce, Int(HOP_CRYPTO_BOX_NONCEBYTES), "nonce")
      try Self.requireSize(pk, Int(HOP_CRYPTO_BOX_PUBLICKEYBYTES), "pk")
      try Self.requireSize(sk, Int(HOP_CRYPTO_BOX_SECRETKEYBYTES), "sk")
      if ciphertext.count < Int(HOP_CRYPTO_BOX_MACBYTES) {
        throw HopSodiumFailedException("crypto_box_open_easy")
      }
      var message = Data(count: ciphertext.count - Int(HOP_CRYPTO_BOX_MACBYTES))
      let rc = message.withUnsafeMutableBytes { mBuf in
        ciphertext.withUnsafeBytes { cBuf in
          nonce.withUnsafeBytes { nBuf in
            pk.withUnsafeBytes { pkBuf in
              sk.withUnsafeBytes { skBuf in
                hop_crypto_box_open_easy(
                  mBuf.bindMemory(to: UInt8.self).baseAddress,
                  cBuf.bindMemory(to: UInt8.self).baseAddress,
                  UInt64(ciphertext.count),
                  nBuf.bindMemory(to: UInt8.self).baseAddress,
                  pkBuf.bindMemory(to: UInt8.self).baseAddress,
                  skBuf.bindMemory(to: UInt8.self).baseAddress
                )
              }
            }
          }
        }
      }
      if rc != 0 {
        throw HopSodiumFailedException("crypto_box_open_easy")
      }
      return message
    }

    Function("cryptoBoxBeforenm") { (pk: Data, sk: Data) -> Data in
      try Self.requireSize(pk, Int(HOP_CRYPTO_BOX_PUBLICKEYBYTES), "pk")
      try Self.requireSize(sk, Int(HOP_CRYPTO_BOX_SECRETKEYBYTES), "sk")
      var shared = Data(count: Int(HOP_CRYPTO_BOX_BEFORENMBYTES))
      let rc = shared.withUnsafeMutableBytes { kBuf in
        pk.withUnsafeBytes { pkBuf in
          sk.withUnsafeBytes { skBuf in
            hop_crypto_box_beforenm(
              kBuf.bindMemory(to: UInt8.self).baseAddress,
              pkBuf.bindMemory(to: UInt8.self).baseAddress,
              skBuf.bindMemory(to: UInt8.self).baseAddress
            )
          }
        }
      }
      if rc != 0 {
        throw HopSodiumFailedException("crypto_box_beforenm")
      }
      return shared
    }

    Function("cryptoAuth") { (message: Data, key: Data) -> Data in
      try Self.requireSize(key, Int(HOP_CRYPTO_AUTH_KEYBYTES), "key")
      var mac = Data(count: Int(HOP_CRYPTO_AUTH_BYTES))
      let rc = mac.withUnsafeMutableBytes { outBuf in
        message.withUnsafeBytes { mBuf in
          key.withUnsafeBytes { kBuf in
            hop_crypto_auth(
              outBuf.bindMemory(to: UInt8.self).baseAddress,
              mBuf.bindMemory(to: UInt8.self).baseAddress,
              UInt64(message.count),
              kBuf.bindMemory(to: UInt8.self).baseAddress
            )
          }
        }
      }
      if rc != 0 {
        throw HopSodiumFailedException("crypto_auth")
      }
      return mac
    }

    Function("cryptoAuthVerify") { (mac: Data, message: Data, key: Data) -> Bool in
      if mac.count != Int(HOP_CRYPTO_AUTH_BYTES) || key.count != Int(HOP_CRYPTO_AUTH_KEYBYTES) {
        return false
      }
      return mac.withUnsafeBytes { hBuf in
        message.withUnsafeBytes { mBuf in
          key.withUnsafeBytes { kBuf in
            hop_crypto_auth_verify(
              hBuf.bindMemory(to: UInt8.self).baseAddress,
              mBuf.bindMemory(to: UInt8.self).baseAddress,
              UInt64(message.count),
              kBuf.bindMemory(to: UInt8.self).baseAddress
            ) == 0
          }
        }
      }
    }

    Function("cryptoGenerichash") { (outlen: Int, message: Data, key: Data?) -> Data in
      var digest = Data(count: outlen)
      let rc = digest.withUnsafeMutableBytes { outBuf in
        message.withUnsafeBytes { mBuf in
          if let key {
            return key.withUnsafeBytes { kBuf in
              hop_crypto_generichash(
                outBuf.bindMemory(to: UInt8.self).baseAddress,
                outlen,
                mBuf.bindMemory(to: UInt8.self).baseAddress,
                UInt64(message.count),
                kBuf.bindMemory(to: UInt8.self).baseAddress,
                key.count
              )
            }
          }
          return hop_crypto_generichash(
            outBuf.bindMemory(to: UInt8.self).baseAddress,
            outlen,
            mBuf.bindMemory(to: UInt8.self).baseAddress,
            UInt64(message.count),
            nil,
            0
          )
        }
      }
      if rc != 0 {
        throw HopSodiumFailedException("crypto_generichash")
      }
      return digest
    }

    Function("randomBytesBuf") { (size: Int) -> Data in
      var bytes = Data(count: size)
      let rc = bytes.withUnsafeMutableBytes { buf in
        hop_randombytes_buf(buf.bindMemory(to: UInt8.self).baseAddress, size)
      }
      if rc != 0 {
        throw HopSodiumFailedException("randombytes_buf")
      }
      return bytes
    }
  }

  private static func requireSize(_ data: Data, _ size: Int, _ name: String) throws {
    if data.count != size {
      throw HopSodiumFailedException(name)
    }
  }
}
