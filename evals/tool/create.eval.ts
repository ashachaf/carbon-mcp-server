/**
 * Tool evals — create strategies
 * These call the live server and assert that:
 * - The response has status "ok"
 * - The unsigned transaction has a valid `to`, `data`, and `value`
 * - Strategy preview fields match what was requested
 */

import { EvalSuite, assert, assertEq, assertApprox, assertHexAddress, assertHexData, assertDefined } from "../utils";

const SERVER = process.env.EVAL_SERVER_URL || "http://localhost:3000";
const WALLET = "0x423617B2970Dd2Fc66F646d18B8E7f89731405e6";
const CHAIN = "ethereum";
const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const MARKET_PRICE = 2000;

async function callTool(toolName: string, params: object): Promise<any> {
  const res = await fetch(`${SERVER}/tools/${toolName.replace(/^carbon_/, "")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return await res.json() as any;
}

function assertValidTx(result: any): void {
  const tx = result.unsigned_transaction;
  assertDefined(tx, "unsigned_transaction");
  assertHexAddress(tx.to, "tx.to");
  assertHexData(tx.data, "tx.data");
  assertDefined(tx.value, "tx.value");
}

export const createToolSuite: EvalSuite = {
  name: "Create Tools",
  cases: [
    {
      name: "limit order — buy ETH at exact price",
      run: async () => {
        const result = await callTool("carbon_create_limit_order", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          direction: "buy", price: 1950, budget: 500,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assertEq(result.strategy_preview.type, "limit_order", "type");
        assertEq(result.strategy_preview.direction, "buy", "direction");
        assertEq(result.strategy_preview.price, 1950, "price");
        assertEq(result.strategy_preview.budget, 500, "budget");
        assertValidTx(result);
      },
    },
    {
      name: "limit order — sell ETH at exact price",
      run: async () => {
        const result = await callTool("carbon_create_limit_order", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          direction: "sell", price: 2100, budget: 0.1,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assertEq(result.strategy_preview.direction, "sell", "direction");
        assertValidTx(result);
      },
    },
    {
      name: "limit order — buy above market triggers warning",
      run: async () => {
        const result = await callTool("carbon_create_limit_order", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          direction: "buy", price: 2100, budget: 500,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assert(result.warnings.length > 0, "should have warning for buy above market");
        assertValidTx(result);
      },
    },
    {
      name: "range order — buy ETH across range",
      run: async () => {
        const result = await callTool("carbon_create_range_order", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          direction: "buy", price_low: 1800, price_high: 1950,
          budget: 1000, market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assertEq(result.strategy_preview.type, "range_order", "type");
        assertEq(result.strategy_preview.direction, "buy", "direction");
        assertValidTx(result);
      },
    },
    {
      name: "range order — sell ETH across range",
      run: async () => {
        const result = await callTool("carbon_create_range_order", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          direction: "sell", price_low: 2100, price_high: 2300,
          budget: 0.5, market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assertEq(result.strategy_preview.direction, "sell", "direction");
        assertValidTx(result);
      },
    },
    {
      name: "recurring strategy — buy low sell high",
      run: async () => {
        const result = await callTool("carbon_create_recurring_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          buy_price_low: 1800, buy_price_high: 1950, buy_budget: 1000,
          sell_price_low: 2100, sell_price_high: 2300, sell_budget: 0,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assertEq(result.strategy_preview.type, "recurring", "type");
        assertValidTx(result);
      },
    },
    {
      name: "recurring strategy — overlap triggers warning",
      run: async () => {
        const result = await callTool("carbon_create_recurring_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          buy_price_low: 1900, buy_price_high: 2100, buy_budget: 1000,
          sell_price_low: 2000, sell_price_high: 2200, sell_budget: 0,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assert(result.warnings.some((w: string) => w.includes("overlap")), "should warn about overlap");
        assertValidTx(result);
      },
    },
    {
      name: "concentrated strategy — buy anchor",
      run: async () => {
        const result = await callTool("carbon_create_concentrated_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          price_low: 1900, price_high: 2100,
          spread_percentage: 1, anchor: "buy", budget: 1000,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assertEq(result.strategy_preview.type, "concentrated", "type");
        assertEq(result.strategy_preview.anchor, "buy", "anchor");
        assert(parseFloat(result.strategy_preview.sell_budget) > 0, "sell budget should be auto-calculated");
        assertValidTx(result);
      },
    },
    {
      name: "concentrated strategy — sell anchor",
      run: async () => {
        const result = await callTool("carbon_create_concentrated_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          price_low: 1900, price_high: 2100,
          spread_percentage: 1, anchor: "sell", budget: 0.5,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assertEq(result.strategy_preview.anchor, "sell", "anchor");
        assert(parseFloat(result.strategy_preview.buy_budget) > 0, "buy budget should be auto-calculated");
        assertValidTx(result);
      },
    },
    {
      name: "concentrated strategy — market price outside range returns error",
      run: async () => {
        const result = await callTool("carbon_create_concentrated_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          price_low: 1900, price_high: 2100,
          spread_percentage: 1, anchor: "buy", budget: 1000,
          market_price: 1500,
        });
        assert(result.error !== undefined, "should return error when market price outside range");
      },
    },
    {
      name: "full range strategy — buy anchor",
      run: async () => {
        const result = await callTool("carbon_create_full_range_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          spread_percentage: 1, anchor: "buy", budget: 1000,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assertEq(result.strategy_preview.type, "full_range", "type");
        assert(parseFloat(result.strategy_preview.sell_budget) > 0, "sell budget auto-calculated");
        assert(parseFloat(result.strategy_preview.price_low) < MARKET_PRICE, "price_low below market");
        assert(parseFloat(result.strategy_preview.price_high) > MARKET_PRICE, "price_high above market");
        assertValidTx(result);
      },
    },
    {
      name: "full range strategy — sell anchor",
      run: async () => {
        const result = await callTool("carbon_create_full_range_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          spread_percentage: 1, anchor: "sell", budget: 0.5,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        assert(parseFloat(result.strategy_preview.buy_budget) > 0, "buy budget auto-calculated");
        assertValidTx(result);
      },
    },
    {
      name: "full range — factor capped at 1000x",
      run: async () => {
        const result = await callTool("carbon_create_full_range_strategy", {
          wallet_address: WALLET, chain: CHAIN,
          base_token: ETH, quote_token: USDC,
          spread_percentage: 1, anchor: "buy", budget: 1000,
          market_price: MARKET_PRICE,
        });
        assertEq(result.status, "ok", "status");
        const factor = parseFloat(result.strategy_preview.factor);
        assert(factor <= 1000, `factor should be <= 1000, got ${factor}`);
      },
    },
  ],
};
