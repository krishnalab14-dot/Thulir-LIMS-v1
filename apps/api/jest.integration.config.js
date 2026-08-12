/** Integration (real-DB) jest config — extends the unit config, targets test-e2e/. */
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['<rootDir>/test-e2e/**/*.spec.ts'],
};
