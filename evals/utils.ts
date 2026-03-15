import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

dotenv.config({ path: path.join(__dirname, "../.env") });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvalCase {
  name: string;
  run: () => Promise<void>;
}

export interface EvalSuite {
  name: string;
  cases: EvalCase[];
}

// ─── Assertion Helpers ────────────────────────────────────────────────────────

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

export function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`ASSERTION FAILED: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

export function assertApprox(actual: number, expected: number, tolerancePct: number, label: string): void {
  const diff = Math.abs(actual - expected) / expected * 100;
  if (diff > tolerancePct) {
    throw new Error(`ASSERTION FAILED: ${label}\n  expected: ${expected} (±${tolerancePct}%)\n  actual:   ${actual} (diff: ${diff.toFixed(2)}%)`);
  }
}

export function assertDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) {
    throw new Error(`ASSERTION FAILED: ${label} is undefined/null`);
  }
  return value;
}

export function assertHexAddress(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`ASSERTION FAILED: ${label} is not a valid hex address: ${value}`);
  }
}

export function assertHexData(value: string, label: string): void {
  if (!/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new Error(`ASSERTION FAILED: ${label} is not valid hex data: ${value.substring(0, 20)}...`);
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runSuites(suites: EvalSuite[]): Promise<void> {
  let totalPassed = 0;
  let totalFailed = 0;
  const failures: string[] = [];

  console.log("\n" + "=".repeat(60));
  console.log("  Carbon DeFi MCP Server — Eval Suite");
  console.log("=".repeat(60));

  for (const suite of suites) {
    console.log(`\n[ ${suite.name} ]`);
    for (const evalCase of suite.cases) {
      try {
        await evalCase.run();
        console.log(`  ✅  ${evalCase.name}`);
        totalPassed++;
      } catch (e: any) {
        console.log(`  ❌  ${evalCase.name}`);
        console.log(`      ${e.message}`);
        totalFailed++;
        failures.push(`${suite.name} > ${evalCase.name}: ${e.message}`);
      }
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log(`  Results: ${totalPassed} passed, ${totalFailed} failed`);
  console.log("=".repeat(60) + "\n");

  if (totalFailed > 0) {
    console.log("Failures:\n");
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}\n`));
    process.exit(1);
  }
}
