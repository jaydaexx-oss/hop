package app.hop.sodium

/**
 * Official NaCl/libsodium 1.0.20 vectors. Host CI compiles tests/host_vectors.c.
 * This file documents the same fixtures for an Android instrumented/unit run
 * after the NDK library is linked.
 */
object HopSodiumVectors {
  const val ALICE_SK = "77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"
  const val BOB_PK = "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f"
  const val NONCE = "69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37"
  const val BOX_EASY =
    "f3ffc7703f9400e52a7dfb4b3d3305d98e993b9f48681273c29650ba32fc76ce48332ea7164d96a4476fb8c531a1186ac0dfc17c98dce87b4da7f011ec48c97271d2c20f9b928fe2270d6fb863d51738b48eeee314a7cc8ab932164548e526ae90224368517acfeabd6bb3732bc0e9da99832b61ca01b6de56244a9e88d5f9b37973f622a43d14a6599b1f654cb45a74e355a5"
  const val BEFORENM = "1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389"
}
