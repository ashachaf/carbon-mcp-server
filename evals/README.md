# Carbon DeFi MCP Server — Evals

Automated test suite for validating tool behavior and agent strategy selection.

## Structure

```
evals/
  run.ts                    — Main entry point
  utils.ts                  — Assertion helpers and runner
  tool/
    create.eval.ts          — Tests for all 5 create tools
    management.eval.ts      — Tests for get, deposit, withdraw, reprice, pause, delete
  agent/
    selection.eval.ts       — Tests agent picks correct tool from natural language prompts
```

## Running

```bash
# Run all evals
npx ts-node evals/run.ts

# Run tool evals only (no API key needed)
npx ts-node evals/run.ts --tool

# Run agent evals only (requires ANTHROPIC_API_KEY)
npx ts-node evals/run.ts --agent
```

## Environment

Add to your `.env`:

```
EVAL_SERVER_URL=https://carbon-mcp.duckdns.org   # or http://localhost:3000 for local
ANTHROPIC_API_KEY=sk-ant-...                       # required for agent evals only
```

## Tool Evals

Call the live MCP server directly and assert:
- Response has `status: "ok"`
- `unsigned_transaction` has valid `to`, `data`, `value`
- Strategy preview fields match what was requested
- Error cases return correct error messages

No API key needed — just a running server.

## Agent Evals

Call the Anthropic API with `SKILL.md` loaded as system prompt and assert:
- Agent picks the correct tool for each natural language prompt
- Agent uses correct anchor side (buy vs sell)
- Agent does not confuse range orders with recurring strategies

Costs a small amount per run (~$0.01–0.05 for the full suite).

## Adding New Tests

To add a tool eval, add a new case to `tool/create.eval.ts` or `tool/management.eval.ts`:

```typescript
{
  name: "my new test",
  run: async () => {
    const result = await callTool("carbon_create_limit_order", { ... });
    assertEq(result.status, "ok", "status");
    assertValidTx(result);
  },
},
```

To add an agent eval, add a new case to `agent/selection.eval.ts`:

```typescript
{
  name: "user intent → correct tool",
  run: async () => {
    const res = await askAgent("natural language prompt here");
    assertEq(res.tool_name, "carbon_create_limit_order", "tool_name");
  },
},
```
