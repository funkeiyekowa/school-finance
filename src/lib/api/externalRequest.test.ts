import { isPublicIpAddress, parseExternalHttpsUrl } from "./externalRequest";

interface TestResult {
  pass: boolean;
  name: string;
  detail?: string;
}

function check(name: string, fn: () => boolean): TestResult {
  try {
    return fn() ? { pass: true, name } : { pass: false, name, detail: "Assertion failed" };
  } catch (error) {
    return { pass: false, name, detail: error instanceof Error ? error.message : String(error) };
  }
}

function rejects(value: string): boolean {
  try {
    parseExternalHttpsUrl(value);
    return false;
  } catch {
    return true;
  }
}

export function runAll(): { results: TestResult[]; passed: number; failed: number } {
  const results = [
    check("accepts a public HTTPS gateway", () => parseExternalHttpsUrl("https://api.sms-gate.app").hostname === "api.sms-gate.app"),
    check("defaults a hostname to HTTPS", () => parseExternalHttpsUrl("api.sms-gate.app").protocol === "https:"),
    check("rejects HTTP", () => rejects("http://api.sms-gate.app")),
    check("rejects embedded credentials", () => rejects("https://user:pass@example.com")),
    check("rejects unsafe ports", () => rejects("https://example.com:3000")),
    check("rejects localhost", () => rejects("https://localhost")),
    check("rejects private IPv4", () => !isPublicIpAddress("10.0.0.1") && !isPublicIpAddress("169.254.169.254") && !isPublicIpAddress("192.168.1.1")),
    check("rejects private IPv6", () => !isPublicIpAddress("::1") && !isPublicIpAddress("fd00::1") && !isPublicIpAddress("fe80::1")),
    check("accepts public addresses", () => isPublicIpAddress("8.8.8.8") && isPublicIpAddress("2606:4700:4700::1111")),
  ];

  return {
    results,
    passed: results.filter(result => result.pass).length,
    failed: results.filter(result => !result.pass).length,
  };
}
