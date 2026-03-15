import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { CHAIN_ENUM } from "./config";
import { HANDLERS } from "./handlers";

// Wraps a handler for MCP — converts plain object response to MCP content format
function wrapMcp(handler: (params: any) => Promise<any>) {
  return async (params: any) => {
    try {
      const result = await handler(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text" as const, text: JSON.stringify({ error: e.message }) }] };
    }
  };
}

export function createMcpServer() {
  const server = new McpServer({ name: "Carbon DeFi", version: "0.3.0" });

  // ── Read ────────────────────────────────────────────────────────────────────

  server.tool("carbon_get_strategies",
    "Fetch all active Carbon DeFi maker strategies for a wallet. Always call this first to check existing positions before creating or modifying anything.",
    {
      wallet_address: z.string().describe("EVM wallet address (0x...)"),
      chain: z.enum(CHAIN_ENUM).describe("Chain to query"),
    },
    wrapMcp(HANDLERS.get_strategies));

  // ── Create ──────────────────────────────────────────────────────────────────

  server.tool("carbon_create_limit_order",
    "Create a single one-time limit order on Carbon DeFi - buy or sell at one exact price. Executes once and closes.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      base_token: z.string().describe("Base token address - the token being bought or sold. Prices = quote per 1 base."),
      quote_token: z.string().describe("Quote token address - the pricing token. All prices expressed as quote per 1 base."),
      direction: z.enum(["buy", "sell"]),
      price: z.number().describe("Exact execution price in quote per base"),
      budget: z.number().describe("Budget - quote token for buy, base token for sell"),
      market_price: z.number().optional(),
    },
    wrapMcp(HANDLERS.create_limit_order));

  server.tool("carbon_create_range_order",
    "Create a one-time range order on Carbon DeFi - buy or sell gradually across a price range. Good for DCA or gradual exits.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      base_token: z.string().describe("Base token address - the token being bought or sold. Prices = quote per 1 base."),
      quote_token: z.string().describe("Quote token address - the pricing token. All prices expressed as quote per 1 base."),
      direction: z.enum(["buy", "sell"]),
      price_low: z.number(),
      price_high: z.number(),
      budget: z.number().describe("Total budget - quote token for buy, base token for sell"),
      market_price: z.number().optional(),
    },
    wrapMcp(HANDLERS.create_range_order));

  server.tool("carbon_create_recurring_strategy",
    "Create a linked buy+sell strategy that repeats indefinitely on Carbon DeFi. Buy low, sell high, repeat automatically with zero gas on fills.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      base_token: z.string().describe("Base token address - token being bought/sold. Prices = quote per 1 base."),
      quote_token: z.string().describe("Quote token address - pricing token. Prices = quote per 1 base."),
      buy_price_low: z.number(),
      buy_price_high: z.number(),
      buy_price_marginal: z.number().optional().describe("Optional: set to market price to place liquidity only below market. If omitted, spans full buy range."),
      buy_budget: z.number(),
      sell_price_low: z.number(),
      sell_price_high: z.number(),
      sell_budget: z.number(),
      market_price: z.number().optional(),
    },
    wrapMcp(HANDLERS.create_recurring_strategy));

  server.tool("carbon_create_concentrated_strategy",
    "Create a two-sided concentrated liquidity strategy on Carbon DeFi with a defined spread. Earn fees on both sides. User provides a budget for one anchor side - the other is auto-calculated. anchor='buy' means user provides quote token budget; anchor='sell' means user provides base token budget.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      base_token: z.string().describe("Base token address - token being bought/sold. Prices = quote per 1 base."),
      quote_token: z.string().describe("Quote token address - pricing token. Prices = quote per 1 base."),
      price_low: z.number(),
      price_high: z.number(),
      spread_percentage: z.number().describe("Spread in percent, e.g. 1 for 1%"),
      anchor: z.enum(["buy", "sell"]).describe("Which side the user is funding. buy = provide quote token budget; sell = provide base token budget."),
      budget: z.number().describe("Budget for the anchor side. Quote token if anchor=buy, base token if anchor=sell."),
      market_price: z.number().describe("Current market price in quote per base - required for concentrated strategy"),
    },
    wrapMcp(HANDLERS.create_concentrated_strategy));

  server.tool("carbon_create_full_range_strategy",
    "Create a two-sided full range concentrated liquidity strategy on Carbon DeFi. Automatically sets the widest possible price range (capped at 1000x from market price). User provides an anchor budget on one side - the other side is calculated automatically. anchor='buy' means user provides quote token budget; anchor='sell' means user provides base token budget.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      base_token: z.string().describe("Base token address. Prices = quote per 1 base."),
      quote_token: z.string().describe("Quote token address. Prices = quote per 1 base."),
      spread_percentage: z.number().describe("Spread in percent, e.g. 1 for 1%"),
      anchor: z.enum(["buy", "sell"]).describe("Which side the user is funding. buy = provide quote token budget; sell = provide base token budget."),
      budget: z.number().describe("Budget for the anchor side. Quote token if anchor=buy, base token if anchor=sell."),
      market_price: z.number().describe("Current market price in quote per base. Required to calculate full range and marginal prices."),
    },
    wrapMcp(HANDLERS.create_full_range_strategy));

  // ── Manage ──────────────────────────────────────────────────────────────────

  server.tool("carbon_reprice_strategy",
    "Adjust the price ranges of an existing Carbon DeFi strategy in a single atomic transaction. Always call this ONCE with all four prices - buy_price_low, buy_price_high, sell_price_low, sell_price_high. If the user only mentions one side, fill the other side with current prices from carbon_get_strategies. Never call this twice for the same strategy.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string(),
      buy_price_low: z.number().optional(),
      buy_price_high: z.number().optional(),
      sell_price_low: z.number().optional(),
      sell_price_high: z.number().optional(),
    },
    wrapMcp(HANDLERS.reprice_strategy));

  server.tool("carbon_edit_strategy",
    "Edit prices and/or budgets of an existing Carbon DeFi strategy in one transaction. Use this when changing both prices and budgets together. For price-only changes use carbon_reprice_strategy. For budget-only changes use carbon_deposit_budget or carbon_withdraw_budget.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string(),
      buy_price_low: z.number().optional(),
      buy_price_high: z.number().optional(),
      buy_budget: z.number().optional().describe("Absolute new buy budget in quote token"),
      sell_price_low: z.number().optional(),
      sell_price_high: z.number().optional(),
      sell_budget: z.number().optional().describe("Absolute new sell budget in base token"),
      market_price: z.number().optional(),
    },
    wrapMcp(HANDLERS.edit_strategy));

  server.tool("carbon_deposit_budget",
    "Add funds to an existing Carbon DeFi strategy. For simple strategies: provide buy_budget_increase and/or sell_budget_increase as deltas. For concentrated or full range strategies: provide anchor, budget_increase, market_price, and spread_percentage - the other side will be recalculated automatically.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string(),
      buy_budget_increase: z.number().optional().describe("Amount to add to buy budget, in quote token. For simple strategies only."),
      sell_budget_increase: z.number().optional().describe("Amount to add to sell budget, in base token. For simple strategies only."),
      anchor: z.enum(["buy", "sell"]).optional().describe("For concentrated/full range strategies: which side to anchor the deposit on."),
      budget_increase: z.number().optional().describe("For concentrated/full range strategies: amount to deposit on the anchor side."),
      market_price: z.number().optional().describe("Required for concentrated/full range strategies to recalculate the other side."),
      spread_percentage: z.number().optional().describe("Required for concentrated/full range strategies."),
    },
    wrapMcp(HANDLERS.deposit_budget));

  server.tool("carbon_withdraw_budget",
    "Withdraw funds from an existing Carbon DeFi strategy without closing it. For simple strategies: provide buy_budget_decrease and/or sell_budget_decrease as deltas. For concentrated or full range strategies: provide anchor, budget_decrease, market_price, and spread_percentage - the other side will be recalculated automatically.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string(),
      buy_budget_decrease: z.number().optional().describe("Amount to remove from buy budget, in quote token. For simple strategies only."),
      sell_budget_decrease: z.number().optional().describe("Amount to remove from sell budget, in base token. For simple strategies only."),
      anchor: z.enum(["buy", "sell"]).optional().describe("For concentrated/full range strategies: which side to anchor the withdrawal on."),
      budget_decrease: z.number().optional().describe("For concentrated/full range strategies: amount to withdraw from the anchor side."),
      market_price: z.number().optional().describe("Required for concentrated/full range strategies to recalculate the other side."),
      spread_percentage: z.number().optional().describe("Required for concentrated/full range strategies."),
    },
    wrapMcp(HANDLERS.withdraw_budget));

  server.tool("carbon_pause_strategy",
    "Pause an active Carbon DeFi strategy by zeroing order prices. Funds remain in the strategy. Always call this tool - never assume current state from prior context. BEFORE calling this tool: (1) Show the user their current prices and tell them to save them - they will need these to resume. (2) Ask if they want to pause (funds stay), withdraw funds, or delete the strategy entirely. Only call this tool if they confirm pause.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string(),
    },
    wrapMcp(HANDLERS.pause_strategy));

  server.tool("carbon_resume_strategy",
    "Resume a paused Carbon DeFi strategy by restoring its price ranges. Funds already in the strategy are preserved - do not ask the user for budgets. Always call this tool directly - never assume paused state from prior context.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string(),
      buy_price_low: z.number().optional().describe("Lower bound of buy range in quote per base. Omit to leave buy order inactive."),
      buy_price_high: z.number().optional().describe("Upper bound of buy range in quote per base. Omit to leave buy order inactive."),
      sell_price_low: z.number().optional().describe("Lower bound of sell range in quote per base. Omit to leave sell order inactive."),
      sell_price_high: z.number().optional().describe("Upper bound of sell range in quote per base. Omit to leave sell order inactive."),
      market_price: z.number().describe("Current market price in quote per base - required to check if prices are sensible."),
    },
    wrapMcp(HANDLERS.resume_strategy));

  server.tool("carbon_delete_strategy",
    "Permanently close a Carbon DeFi strategy and return all funds to the wallet. This is irreversible. Always confirm with the user before calling this tool.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string().describe("Strategy ID from carbon_get_strategies"),
    },
    wrapMcp(HANDLERS.delete_strategy));

  // ── Prompt & Skill Resource ─────────────────────────────────────────────────

  server.prompt("carbon-defi-instructions", "Instructions for using Carbon DeFi tools correctly", () => ({
    messages: [{ role: "user", content: { type: "text", text: "Before using any Carbon DeFi tools, read the carbon-defi-skill resource at carbon://skill. It contains critical instructions for token addresses, price conventions, allowance checks, marginal price behavior, and execution flow. Always follow those instructions when helping users create or manage Carbon DeFi strategies." } }]
  }));

  server.resource("carbon-defi-skill", "carbon://skill", async (uri) => {
    const skillPath = path.join(__dirname, "..", "SKILL.md");
    const text = fs.readFileSync(skillPath, "utf-8");
    return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
  });

  return server;
}
