/** @type {import('jest').Config} */
module.exports = {
  projects: [
    {
      displayName: "unit",
      testMatch: ["<rootDir>/test/unit/**/*.spec.ts"],
      preset: "ts-jest",
      testEnvironment: "node"
    },
    {
      displayName: "integration",
      testMatch: ["<rootDir>/test/integration/**/*.spec.ts"],
      preset: "ts-jest",
      testEnvironment: "node"
    },
    {
      displayName: "e2e",
      testMatch: ["<rootDir>/test/e2e/**/*.spec.ts"],
      preset: "ts-jest",
      testEnvironment: "node"
    }
  ]
};

