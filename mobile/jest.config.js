/** Jest for the iOS app (jest-expo). Shared code keeps its own Vitest tests in ../shared. */
module.exports = {
  preset: 'jest-expo/ios',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@rack/shared/(.*)$': '<rootDir>/../shared/src/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};
