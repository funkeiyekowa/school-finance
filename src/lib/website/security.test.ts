import { emphasisHtml, escapeHtml, safeExternalUrl, safeStyleSheet, serializeJsonLd } from "./security";

interface TestResult {
  pass: boolean;
  name: string;
  detail?: string;
}

function test(name: string, fn: () => boolean | string): TestResult {
  try {
    const result = fn();
    return result === true
      ? { pass: true, name }
      : { pass: false, name, detail: typeof result === "string" ? result : "Assertion failed" };
  } catch (error: unknown) {
    return { pass: false, name, detail: String(error) };
  }
}

export function testEscapesHtml(): TestResult {
  return test("escapes CMS HTML", () =>
    escapeHtml(`<img src=x onerror="alert('x')">`) ===
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;" || "HTML was not escaped"
  );
}

export function testEscapesBeforeEmphasis(): TestResult {
  return test("escapes text before adding emphasis", () => {
    const result = emphasisHtml(`Welcome *<img src=x onerror=alert(1)>*`);
    if (result !== "Welcome <em>&lt;img src=x onerror=alert(1)&gt;</em>") return result;
    return !result.includes("<img") || "User markup remained executable";
  });
}

export function testJsonLdCannotCloseScript(): TestResult {
  return test("JSON-LD cannot close its script element", () => {
    const result = serializeJsonLd({ name: "</script><script>alert(1)</script>", separator: "\u2028" });
    if (result.toLowerCase().includes("</script")) return result;
    return result.includes("\\u003c/script\\u003e") || result;
  });
}

export function testRejectsExecutableUrls(): TestResult {
  return test("rejects executable external URLs", () => {
    if (safeExternalUrl("javascript:alert(1)") !== null) return "javascript: URL was accepted";
    return safeExternalUrl("https://example.com/path") === "https://example.com/path" || "HTTPS URL was rejected";
  });
}

export function testStyleCannotCloseElement(): TestResult {
  return test("stylesheet cannot close its style element", () =>
    safeStyleSheet("body{color:red}</STYLE><script>alert(1)</script>") ===
      "body{color:red}<\\/STYLE><script>alert(1)</script>" || "Style terminator was not neutralized"
  );
}

export function runAll(): { results: TestResult[]; passed: number; failed: number } {
  const results = [
    testEscapesHtml(),
    testEscapesBeforeEmphasis(),
    testJsonLdCannotCloseScript(),
    testRejectsExecutableUrls(),
    testStyleCannotCloseElement(),
  ];
  return {
    results,
    passed: results.filter(result => result.pass).length,
    failed: results.filter(result => !result.pass).length,
  };
}
