/**
 * Tool evals — management tools
 * Tests get_strategies, deposit, withdraw, reprice, pause, resume, delete.
 * These tests use a real strategy on the test fork — run against the test environment.
 */

import { EvalSuite, assert, assertEq, assertDefined, assertHexAddress, assertHexData } from "../utils";

const SERVER = process.env.EVAL_SERVER_URL || "https://carbon-mcp.duckdns.org";
const WALLET = "0x423617B2970Dd2Fc66F646d18B8E7f89731405e6";
const CHAIN = "ethereum";
const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

async function callTool(toolName: string, params: object): Promise<any> {
  const res = await fetch(`${SERVER}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: toolName, arguments: params },
    }),
  });
  const raw = await res.text();
  // Parse SSE format: find "data: {...}" line
  const dataLine = raw.split("\n").find((l: string) => l.startsWith("data: "));
  if (!dataLine) throw new Error(`No data line in SSE response: ${raw.substring(0, 200)}`);
  const json = JSON.parse(dataLine.slice(6)) as any;
  const text = json?.result?.content?.[0]?.text;
  if (!text) throw new Error(`No content in response: ${JSON.stringify(json)}`);
  return JSON.parse(text);
}

function assertValidTx(result: any): void {
  const tx = result.unsigned_transaction;
  assertDefined(tx, "unsigned_transaction");
  assertHexAddress(tx.to, "tx.to");
  assertHexData(tx.data, "tx.data");
  assertDefined(tx.value, "tx.value");
}

async function getFirstStrategy(): Promise<any> {
  const result = await callTool("carbon_get_strategies", { wallet_address: WALLET, chain: CHAIN });
  assert(result.strategies.length > 0, "wallet must have at least one strategy for management tests");
  return result.strategies[0];
}

export const managementToolSuite: EvalSuite = {
  name: "Management Tools",
  cases: [
    {
      name: "get_strategies — returns valid response",
      run: async () => {
        const result = await callTool("carbon_get_strategies", { wallet_address: WALLET, chain: CHAIN });
        assertEq(result.status, "ok", "status");
        assertDefined(result.strategies, "strategies array");
        assert(Array.isArray(result.strategies), "strategies should be array");
        assertDefined(result.strategy_count, "strategy_count");
        assertEq(result.strategy_count, result.strategies.length, "strategy_count matches array length");
      },
    },
    {
      name: "get_strategies — each strategy has required fields",
      run: async () => {
        const result = await callTool("carbon_get_strategies", { wallet_address: WALLET, chain: CHAIN });
        assertEq(result.status, "ok", "status");
        for (const s of result.strategies) {
          assertDefined(s.strategy_id, "strategy_id");
          assertDefined(s.base_token, "base_token");
          assertDefined(s.quote_token, "quote_token");
          assertDefined(s.buy_budget_token, "buy_budget_token");
          assertDefined(s.sell_budget_token, "sell_budget_token");
          assertEq(s.price_unit, "quote per base", "price_unit");
          assertEq(s.buy_budget_token, s.quote_token, "buy_budget_token should be quote_token");
          assertEq(s.sell_budget_token, s.base_token, "sell_budget_token should be base_token");
        }
      },
    },
    {
      name: "deposit_budget — simple strategy buy side",
      run: async () => {
        const strategy = await getFirstStrategy();
        const result = await callTool("carbon_deposit_budget", {
          wallet_address: WALLET, chain: CHAIN,
          strategy_id: strategy.strategy_id,
          buy_budget_increase: 10,
        });
        assertEq(result.status, "ok", "status");
        assertValidTx(result);
      },
    },
    {
      name: "withdraw_budget — simple strategy buy side",
      run: async () => {
        const strategy = await getFirstStrategy();
        const currentBuy = parseFloat(strategy.buy_budget || "0");
        if (currentBuy < 1) {
          console.log("      (skipped — insufficient buy budget)");
          return;
        }
        const result = await callTool("carbon_withdraw_budget", {
          wallet_address: WALLET, chain: CHAIN,
          strategy_id: strategy.strategy_id,
          buy_budget_decrease: 1,
        });
        assertEq(result.status, "ok", "status");
        assertValidTx(result);
      },
    },
    {
      name: "withdraw_budget — exceeding balance returns error",
      run: async () => {
        const strategy = await getFirstStrategy();
        const currentBuy = parseFloat(strategy.buy_budget || "0");
        const result = await callTool("carbon_withdraw_budget", {
          wallet_address: WALLET, chain: CHAIN,
          strategy_id: strategy.strategy_id,
          buy_budget_decrease: currentBuy + 99999,
        });
        assertDefined(result.error, "should return error when withdrawing more than balance");
      },
    },
    {
      name: "reprice_strategy — change buy range",
      run: async () => {
        const strategy = await getFirstStrategy();
        const result = await callTool("carbon_reprice_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          strategy_id: strategy.strategy_id,
          buy_price_low: 1800,
          buy_price_high: 1900,
        });
        assertEq(result.status, "ok", "status");
        assertValidTx(result);
      },
    },
    {
      name: "reprice_strategy — no change returns no_change status",
      run: async () => {
        const strategy = await getFirstStrategy();
        const result = await callTool("carbon_reprice_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          strategy_id: strategy.strategy_id,
          buy_price_low: parseFloat(strategy.buy_price_low || "0"),
          buy_price_high: parseFloat(strategy.buy_price_high || "0"),
          sell_price_low: parseFloat(strategy.sell_price_low || "0"),
          sell_price_high: parseFloat(strategy.sell_price_high || "0"),
        });
        assertEq(result.status, "no_change", "status should be no_change");
      },
    },
    {
      name: "pause_strategy — generates valid transaction",
      run: async () => {
        const strategy = await getFirstStrategy();
        const buyHigh = parseFloat(strategy.buy_price_high || "0");
        const sellHigh = parseFloat(strategy.sell_price_high || "0");
        if (buyHigh === 0 && sellHigh === 0) {
          // Already paused — should return already_paused status
          const result = await callTool("carbon_pause_strategy", {
            wallet_address: WALLET, chain: CHAIN,
            strategy_id: strategy.strategy_id,
          });
          assertEq(result.status, "already_paused", "already paused status");
          return;
        }
        const result = await callTool("carbon_pause_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          strategy_id: strategy.strategy_id,
        });
        assertEq(result.status, "ok", "status");
        assertDefined(result.prices_to_save, "prices_to_save should be returned");
        assertValidTx(result);
      },
    },
    {
      name: "delete_strategy — generates valid transaction",
      run: async () => {
        const strategy = await getFirstStrategy();
        const result = await callTool("carbon_delete_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          strategy_id: strategy.strategy_id,
        });
        assertEq(result.status, "ok", "status");
        assert(result.warning.includes("IRREVERSIBLE"), "should include irreversible warning");
        assertValidTx(result);
      },
    },
  ],
};
