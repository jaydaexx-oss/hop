cmake_minimum_required(VERSION 3.22.1)
project(hop-sodium)

execute_process(
  COMMAND "${CMAKE_CURRENT_LIST_DIR}/../scripts/fetch-libsodium.sh"
  RESULT_VARIABLE FETCH_RESULT
)
if(NOT FETCH_RESULT EQUAL 0)
  message(FATAL_ERROR "Failed to fetch official libsodium 1.0.20")
endif()

set(SODIUM_ROOT "${CMAKE_CURRENT_LIST_DIR}/../vendor/libsodium")
set(SODIUM_SRC "${SODIUM_ROOT}/src/libsodium")

file(GLOB_RECURSE SODIUM_C CONFIGURE_DEPENDS "${SODIUM_SRC}/*.c")
list(FILTER SODIUM_C EXCLUDE REGEX ".*/(aesni|avx2|avx512f|sse2|sse41|ssse3|xmm6|xmm6int|dolbeau|sandy2x|armcrypto|randombytes/internal)/")
list(FILTER SODIUM_C EXCLUDE REGEX ".*(_aesni|_armcrypto|-avx2|-ssse3|-sse41|-avx512f)\\.c$")

add_library(
  hop-sodium
  SHARED
  ${SODIUM_C}
  "${CMAKE_CURRENT_LIST_DIR}/../cpp/hop_sodium.c"
  "${CMAKE_CURRENT_LIST_DIR}/src/main/cpp/hop_sodium_jni.c"
)

target_include_directories(
  hop-sodium
  PRIVATE
  "${CMAKE_CURRENT_LIST_DIR}/../include"
  "${CMAKE_CURRENT_LIST_DIR}/../include/sodium"
  "${CMAKE_CURRENT_LIST_DIR}/../cpp"
  "${SODIUM_SRC}/include"
  "${SODIUM_SRC}/include/sodium"
)

target_compile_definitions(
  hop-sodium
  PRIVATE
  CONFIGURED=1
  SODIUM_STATIC=1
  NATIVE_LITTLE_ENDIAN=1
  HAVE_PTHREAD=1
  HAVE_POSIX_MEMALIGN=1
  HAVE_WEAK_SYMBOLS=1
  HAVE_INLINE_ASM=1
  HAVE_NANOSLEEP=1
  HAVE_SYS_MMAN_H=1
  HAVE_MMAP=1
  HAVE_MPROTECT=1
  HAVE_SYSCONF=1
  HAVE_RAISE=1
  HAVE_GETRANDOM=1
  HAVE_SYS_RANDOM_H=1
)

find_library(LOG_LIB log)
target_link_libraries(hop-sodium ${LOG_LIB})
