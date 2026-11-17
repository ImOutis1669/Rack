/** Jest for the iOS app (jest-expo). Shared code keeps its own Vitest tests in ../shared. */
module.exports = {
  preset: 'jest-expo/ios',
  roots: ['<rootDir>/src'],
  // ../shared has no node_modules of its own: resolve its Babel helpers from the app's
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  moduleNameMapper: {
    '^@rack/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
