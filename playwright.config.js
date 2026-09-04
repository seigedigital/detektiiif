const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 45000,
  expect: {
    timeout: 15000,
  },
  reporter: [['list']],
});
