/**
 * Carbon DeFi MCP Server — Eval Runner
 *
 * Usage:
 *   Run all evals:        npx ts-node evals/run.ts
 *   Run tool evals only:  npx ts-node evals/run.ts --tool
 *   Run agent evals only: npx ts-node evals/run.ts --agent
 *
 * Environment:
 *   EVAL_SERVER_URL   — MCP server URL (default: https://carbon-mcp.duckdns.org)
 *   ANTHROPIC_API_KEY — Required for agent evals
 */

import { runSuites } from "./utils";
import { createToolSuite } from "./tool/create.eval";
import { managementToolSuite } from "./tool/management.eval";
import { agentSelectionSuite, agentBehaviorSuite } from "./agent/selection.eval";

const args = process.argv.slice(2);
const runTool = args.includes("--tool") || args.length === 0;
const runAgent = args.includes("--agent") || args.length === 0;

const suites = [
  ...(runTool ? [createToolSuite, managementToolSuite] : []),
  ...(runAgent ? [agentSelectionSuite, agentBehaviorSuite] : []),
];

if (suites.length === 0) {
  console.error("No suites selected. Use --tool, --agent, or no flags to run all.");
  process.exit(1);
}

runSuites(suites).catch((e) => {
  console.error("Unexpected error:", e);
  process.exit(1);
});
