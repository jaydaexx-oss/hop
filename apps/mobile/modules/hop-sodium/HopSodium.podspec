Pod::Spec.new do |s|
  s.name           = 'HopSodium'
  s.version        = '1.0.20'
  s.summary        = 'Minimal official libsodium C backend for HOP'
  s.description    = 'Expo module wrapping official libsodium 1.0.20 crypto_box, beforenm, auth, and generichash.'
  s.author         = 'HOP'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.license        = 'ISC'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.prepare_command = <<-CMD
    sh "#{__dir__}/scripts/fetch-libsodium.sh"
    cp "#{__dir__}/cpp/hop_sodium.h" "#{__dir__}/ios/hop_sodium.h"
  CMD

  # CocoaPods PathList only indexes files under the podspec directory, so this
  # spec lives at the module root. ios/*.c is omitted so hop_sodium.c compiles
  # once from cpp/. Public hop_sodium.h stays in ios/ for the Clang module.
  s.source_files = [
    'ios/*.{h,m,swift}',
    'cpp/*.c',
    'include/sodium/version.h',
    'vendor/libsodium/src/libsodium/**/*.{c,h}'
  ]
  s.exclude_files = [
    'ios/HopSodiumTests.swift',
    'vendor/libsodium/src/libsodium/**/aesni/**',
    'vendor/libsodium/src/libsodium/**/avx2/**',
    'vendor/libsodium/src/libsodium/**/avx512f/**',
    'vendor/libsodium/src/libsodium/**/sse2/**',
    'vendor/libsodium/src/libsodium/**/sse41/**',
    'vendor/libsodium/src/libsodium/**/ssse3/**',
    'vendor/libsodium/src/libsodium/**/xmm6/**',
    'vendor/libsodium/src/libsodium/**/xmm6int/**',
    'vendor/libsodium/src/libsodium/**/dolbeau/**',
    'vendor/libsodium/src/libsodium/**/sandy2x/**',
    'vendor/libsodium/src/libsodium/**/armcrypto/**',
    'vendor/libsodium/src/libsodium/**/randombytes/internal/**',
    'vendor/libsodium/src/libsodium/**/*aesni*.c',
    'vendor/libsodium/src/libsodium/**/*armcrypto*.c',
    'vendor/libsodium/src/libsodium/**/*avx2*.c',
    'vendor/libsodium/src/libsodium/**/*ssse3*.c',
    'vendor/libsodium/src/libsodium/**/*sse41*.c',
    'vendor/libsodium/src/libsodium/**/*avx512f*.c'
  ]
  s.public_header_files = [
    'ios/HopSodiumBridge.h',
    'ios/hop_sodium.h'
  ]

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/include" "$(PODS_TARGET_SRCROOT)/include/sodium" "$(PODS_TARGET_SRCROOT)/cpp" "$(PODS_TARGET_SRCROOT)/ios" "$(PODS_TARGET_SRCROOT)/vendor/libsodium/src/libsodium/include" "$(PODS_TARGET_SRCROOT)/vendor/libsodium/src/libsodium/include/sodium"',
    'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) CONFIGURED=1 SODIUM_STATIC=1 NATIVE_LITTLE_ENDIAN=1 HAVE_PTHREAD=1 HAVE_POSIX_MEMALIGN=1 HAVE_WEAK_SYMBOLS=1 HAVE_INLINE_ASM=1 HAVE_NANOSLEEP=1 HAVE_SYS_MMAN_H=1 HAVE_MMAP=1 HAVE_MPROTECT=1 HAVE_SYSCONF=1 HAVE_RAISE=1 HAVE_SAFE_ARC4RANDOM=1 HAVE_MEMSET_S=1',
    'CLANG_WARN_DOCUMENTATION_COMMENTS' => 'NO'
  }
end
