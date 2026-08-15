/**
 * Jest config for tests that mount React Native components / context providers.
 *
 * Uses the jest-expo preset so babel-jest transforms react-native packages
 * correctly (the default ts-jest config runs in a plain node environment that
 * cannot parse react-native's Flow-typed source).
 *
 * The only override: react-native/setup-env is mapped to a local stub because
 * @react-native/jest-preset 0.87.0 points to src/setup-env.js which doesn't
 * exist in react-native 0.81.5.
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/hop-context*.test.[jt]s?(x)'],
  moduleNameMapper: {
    '^react-native/setup-env$':
      '<rootDir>/__mocks__/react-native-setup-env-stub.js',
    '^@/(.*)$': '<rootDir>/$1',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/__mocks__/@react-native-async-storage/async-storage.ts',
  },
};
