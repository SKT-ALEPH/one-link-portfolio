import { defineConfig } from "@playwright/test";

const localBrowserPath = process.env.ONE_LINK_BROWSER_PATH;

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://127.0.0.1:4173/",
    browserName: "chromium",
    launchOptions: localBrowserPath ? { executablePath: localBrowserPath } : undefined,
    colorScheme: "light",
    locale: "ko-KR",
  },
});
