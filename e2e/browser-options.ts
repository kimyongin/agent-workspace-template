import type { LaunchOptions } from "@playwright/test";

// Opt in to an installed Chromium when the Playwright download is unavailable.
// An unset variable keeps Playwright's bundled browser and launch defaults.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
export const browserLaunchOptions: LaunchOptions = executablePath ? { executablePath } : {};
