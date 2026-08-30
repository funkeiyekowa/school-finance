import { runAll as runContrastTests } from "./src/lib/website/contrast.test";
import { runAll as runThemeValidatorTests } from "./src/lib/website/theme-validator.test";
import { runAll as runWebsiteSecurityTests } from "./src/lib/website/security.test";
import { runAll as runExternalRequestTests } from "./src/lib/api/externalRequest.test";

interface TestResult {
  pass: boolean;
  name: string;
  detail?: string;
}

function reportSuite(
  name: string,
  run: () => { results: TestResult[]; passed: number; failed: number },
): number {
  const { results, passed, failed } = run();

  for (const result of results) {
    if (!result.pass) {
      console.error(`FAIL ${name}: ${result.name}${result.detail ? ` — ${result.detail}` : ""}`);
    }
  }

  console.log(`${name}: ${passed} passed, ${failed} failed`);
  return failed;
}

const failures = [
  reportSuite("Contrast", runContrastTests),
  reportSuite("Theme validator", runThemeValidatorTests),
  reportSuite("Website security", runWebsiteSecurityTests),
  reportSuite("External request security", runExternalRequestTests),
].reduce((total, failed) => total + failed, 0);

if (failures > 0) {
  process.exitCode = 1;
}
