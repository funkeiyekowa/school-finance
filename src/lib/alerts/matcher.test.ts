/**
 * Comprehensive unit tests for the matching engine.
 *
 * These test the pure scoring/normalization functions directly (no DB),
 * then use a mock Supabase client to test the full matchStudent/matchVendor
 * pipeline with controlled data.
 *
 * Run: node --loader ts-node/esm src/lib/alerts/matcher.test.ts
 * Or compile + run: tsc matcher.test.ts --outDir ... && node ...
 *
 * For CI this would use a proper test runner (vitest/jest), but for now
 * this is a standalone assertion script.
 */

import {
  normalize,
  tokenize,
  extractStudentCode,
  matchStudent,
  matchVendor,
  type MatchResult,
  type VendorMatchResult,
} from "./matcher.js";

// ============================================================
// TEST INFRASTRUCTURE
// ============================================================

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

function checkNot(label: string, actual: unknown, notExpected: unknown) {
  const a = JSON.stringify(actual);
  const n = JSON.stringify(notExpected);
  if (a !== n) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL ${label}\n         should NOT be ${n}\n         but it is`);
  }
}

function section(name: string) {
  console.log(`\n${name}`);
}

// ============================================================
// MOCK SUPABASE CLIENT
// ============================================================

interface MockStudent {
  id: string;
  student_code: string;
  full_name: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
}

interface MockVendor {
  id: string;
  vendor_code: string;
  name: string;
}

function createMockSupabase(students: MockStudent[], vendors: MockVendor[] = []) {
  return {
    from(table: string) {
      const data = table === "students" ? students : table === "vendors" ? vendors : [];
      return {
        select() {
          return {
            eq(_col: string, _val: string) {
              return {
                // Filter by status=active for students
                then: undefined,
                data: data.filter((r: any) => r.status === _val || table !== "students"),
                error: null,
              };
            },
            // Direct return for vendors (no .eq chain)
            data,
            error: null,
          };
        },
      };
    },
  } as any;
}

// ============================================================
// PURE FUNCTION TESTS
// ============================================================

section("normalize()");
check("lowercase", normalize("AYOADE"), "ayoade");
check("trim + collapse", normalize("  Ayoade   Johnson  "), "ayoade johnson");
check("punctuation", normalize("Ayoade, Johnson"), "ayoade johnson");
check("accents", normalize("Àyọadé"), "ayoade");
check("null", normalize(null), "");
check("apostrophe", normalize("O'Brien"), "obrien");

section("tokenize()");
check("basic", tokenize("ayoade johnson"), ["ayoade", "johnson"]);
check("short tokens dropped", tokenize("a ab ayoade"), ["ayoade"]);
check("empty", tokenize(""), []);

section("extractStudentCode()");
check("standalone S583", extractStudentCode("S583 Ayoade Johnson"), "S583");
check("standalone s327", extractStudentCode("payment for s327"), "S327");
check("NOT embedded XS5839", extractStudentCode("XS5839 something"), null);
check("NOT embedded S58345", extractStudentCode("S58345 something"), null);
check("code at end", extractStudentCode("payment S612"), "S612");
check("code after comma", extractStudentCode("hello,S999 test"), "S999");
check("no code present", extractStudentCode("Ayoade Johnson payment"), null);

// ============================================================
// STUDENT MATCHING — FULL PIPELINE
// ============================================================

const STUDENTS: MockStudent[] = [
  { id: "1", student_code: "S583", full_name: "Ayoade Johnson", first_name: "Ayoade", last_name: "Johnson", status: "active" },
  { id: "2", student_code: "S584", full_name: "Ayoade Williams", first_name: "Ayoade", last_name: "Williams", status: "active" },
  { id: "3", student_code: "S585", full_name: "Ayoade Brown", first_name: "Ayoade", last_name: "Brown", status: "active" },
  { id: "4", student_code: "S586", full_name: "Ayodele Johnson", first_name: "Ayodele", last_name: "Johnson", status: "active" },
  { id: "5", student_code: "S587", full_name: "Ayodeji Johnson", first_name: "Ayodeji", last_name: "Johnson", status: "active" },
  { id: "6", student_code: "S588", full_name: "Chukwudi Okafor", first_name: "Chukwudi", last_name: "Okafor", status: "active" },
  { id: "7", student_code: "S589", full_name: "Taiwo Shakirah Okeowo", first_name: "Taiwo", last_name: "Okeowo", status: "active" },
];

async function testStudents() {
  const supabase = createMockSupabase(STUDENTS);

  section("EXACT CODE MATCH");
  {
    const r = await matchStudent(supabase, "S583", null);
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Ayoade Johnson");
    check("method", r.method, "EXACT_CODE");
    check("confidence", r.confidence, 100);
  }

  section("CODE NOT FOUND");
  {
    const r = await matchStudent(supabase, "S999", null);
    check("status", r.status, "NO_MATCH");
  }

  section("EXACT FULL NAME — Ayoade Johnson");
  {
    const r = await matchStudent(supabase, null, "Ayoade Johnson");
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Ayoade Johnson");
    check("method includes EXACT or FIRST_PLUS", r.method === "EXACT_FULL_NAME" || r.method === "EXACT_FIRST_PLUS_EXACT_LAST", true);
  }

  section("REVERSED NAME — Johnson Ayoade");
  {
    const r = await matchStudent(supabase, null, "Johnson Ayoade");
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Ayoade Johnson");
  }

  section("PREFIX MATCH — Ayoade John");
  {
    const r = await matchStudent(supabase, null, "Ayoade John");
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Ayoade Johnson");
    check("method", r.method, "EXACT_FIRST_PLUS_PREFIX_LAST");
  }

  section("PREFIX MATCH — Ayoade Johns");
  {
    const r = await matchStudent(supabase, null, "Ayoade Johns");
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Ayoade Johnson");
  }

  section("SHORT PREFIX — Ayoade Joh (3 chars, below MIN_PREFIX_LENGTH=4)");
  {
    const r = await matchStudent(supabase, null, "Ayoade Joh");
    // "Joh" is 3 chars — below MIN_PREFIX_LENGTH so prefix doesn't fire.
    // Should NOT auto-match
    checkNot("status not AUTO_MATCHED", r.status, "AUTO_MATCHED");
  }

  section("INVALID MATCH — Ayoade James");
  {
    const r = await matchStudent(supabase, null, "Ayoade James");
    // James ≠ Johnson, Williams, Brown — no last name match
    checkNot("status not AUTO_MATCHED", r.status, "AUTO_MATCHED");
  }

  section("INVALID MATCH — Ayoade Ayodele");
  {
    const r = await matchStudent(supabase, null, "Ayoade Ayodele");
    // Ayodele is a different first name (S586), Ayoade is a first name (S583/S584/S585)
    // The engine should not auto-match because Ayoade+Ayodele doesn't cleanly identify one person
    checkNot("status not AUTO_MATCHED", r.status, "AUTO_MATCHED");
  }

  section("SINGLE NAME — Ayoade (multiple students have this first name)");
  {
    const r = await matchStudent(supabase, null, "Ayoade");
    // Must NOT auto-match — 3 students share this first name
    checkNot("status not AUTO_MATCHED", r.status, "AUTO_MATCHED");
    check("has multiple candidates or is ambiguous/no_match", r.candidateCount > 1 || r.status === "NO_MATCH" || r.status === "AMBIGUOUS" || r.status === "MANUAL_REVIEW", true);
  }

  section("SINGLE SURNAME — Johnson (multiple students have this last name)");
  {
    const r = await matchStudent(supabase, null, "Johnson");
    checkNot("status not AUTO_MATCHED", r.status, "AUTO_MATCHED");
  }

  section("VERY SHORT TOKEN — Ayo (3 chars)");
  {
    const r = await matchStudent(supabase, null, "Ayo");
    checkNot("never auto-match", r.status, "AUTO_MATCHED");
  }

  section("UNIQUE SINGLE-TOKEN FULL NAME — Chukwudi Okafor");
  {
    const r = await matchStudent(supabase, null, "Chukwudi Okafor");
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Chukwudi Okafor");
  }

  section("CONFLICT — code says S583 (Ayoade Johnson) but name says Ayoade Williams");
  {
    const r = await matchStudent(supabase, "S583", "Ayoade Williams");
    // Code matches Ayoade Johnson, but name strongly matches Ayoade Williams
    check("status is CONFLICT", r.status, "CONFLICT");
  }

  section("CODE + MATCHING NAME — S583 + Ayoade Johnson (no conflict)");
  {
    const r = await matchStudent(supabase, "S583", "Ayoade Johnson");
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Ayoade Johnson");
    check("method", r.method, "EXACT_CODE");
  }

  section("SIMILAR NAMES — Ayodele vs Ayodeji (must not confuse)");
  {
    const r1 = await matchStudent(supabase, null, "Ayodele Johnson");
    check("Ayodele Johnson → correct student", r1.matchedName, "Ayodele Johnson");
    check("status", r1.status, "AUTO_MATCHED");

    const r2 = await matchStudent(supabase, null, "Ayodeji Johnson");
    check("Ayodeji Johnson → correct student", r2.matchedName, "Ayodeji Johnson");
    check("status", r2.status, "AUTO_MATCHED");
  }

  section("SUBSTRING vs PREFIX — Son inside Johnson");
  {
    const r = await matchStudent(supabase, null, "Ayoade Son");
    // "Son" is 3 chars (below MIN_PREFIX_LENGTH) and is a substring of "Johnson" (not a prefix)
    // Should not auto-match
    checkNot("status not AUTO_MATCHED", r.status, "AUTO_MATCHED");
  }

  section("NO INPUT");
  {
    const r = await matchStudent(supabase, null, null);
    check("status", r.status, "NO_MATCH");
  }
}

// ============================================================
// VENDOR MATCHING — FULL PIPELINE
// ============================================================

const VENDORS: MockVendor[] = [
  { id: "v1", vendor_code: "VND-001", name: "Adeyemi Office Supplies" },
  { id: "v2", vendor_code: "VND-002", name: "Olukosi Transport Services" },
  { id: "v3", vendor_code: "VND-003", name: "Adeyemi Bookshop" },
];

async function testVendors() {
  const supabase = createMockSupabase([], VENDORS);

  section("VENDOR — exact name match");
  {
    const r = await matchVendor(supabase, "Olukosi Transport Services");
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Olukosi Transport Services");
  }

  section("VENDOR — partial name, unique");
  {
    const r = await matchVendor(supabase, "Olukosi Transport");
    check("status", r.status, "AUTO_MATCHED");
    check("matchedName", r.matchedName, "Olukosi Transport Services");
  }

  section("VENDOR — ambiguous (Adeyemi matches two vendors)");
  {
    const r = await matchVendor(supabase, "Adeyemi");
    // Single token "adeyemi" appears in both vendors — should NOT auto-match
    checkNot("status not AUTO_MATCHED", r.status, "AUTO_MATCHED");
  }

  section("VENDOR — no match");
  {
    const r = await matchVendor(supabase, "Unknown Company");
    check("status", r.status, "NO_MATCH");
  }
}

// ============================================================
// RUN ALL
// ============================================================

async function runAll() {
  await testStudents();
  await testVendors();

  console.log(`\n${"=".repeat(40)}`);
  console.log(`${pass} passed, ${fail} failed`);
  process.exitCode = fail > 0 ? 1 : 0;
}

runAll();
