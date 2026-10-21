// Only the finite full runner supplies this mode to compatible Playwright subprocesses.
// Standalone commands retain their original strict, independently owned webServer settings.
export function ownedFixtureWebServer<T>(standalone: T): T | undefined {
  const group = process.env.WORKSPACE_FIXTURE_WEB_SERVER_GROUP;
  const pid = process.env.WORKSPACE_FIXTURE_WEB_SERVER_PID;
  if (group === undefined && pid === undefined) return standalone;
  if (group !== "settings-model" || !/^[1-9][0-9]*$/.test(pid ?? "")) {
    throw new Error("Invalid owned fixture web server handoff");
  }
  try {
    process.kill(Number(pid), 0);
  } catch {
    throw new Error("Owned fixture web server is no longer running");
  }
  return undefined;
}
