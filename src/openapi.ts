import { HANDLERS } from "./handlers";

const CHAIN_ENUM = { type: "string", enum: ["ethereum", "sei", "celo", "tac"] };

// Tool-specific request schemas
const SCHEMAS: Record<string, object> = {
  get_strategies: {
    required: ["wallet_address", "chain"],
    properties: { wallet_address: { type: "string", description: "EVM wallet address (0x...)" }, chain: CHAIN_ENUM },
  },
  create_limit_order: {
    required: ["wallet_address", "chain", "base_token", "quote_token", "direction", "price", "budget"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, base_token: { type: "string" }, quote_token: { type: "string" }, direction: { type: "string", enum: ["buy", "sell"] }, price: { type: "number", description: "Exact execution price in quote per base" }, budget: { type: "number", description: "Quote token for buy, base token for sell" }, market_price: { type: "number" } },
  },
  create_range_order: {
    required: ["wallet_address", "chain", "base_token", "quote_token", "direction", "price_low", "price_high", "budget"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, base_token: { type: "string" }, quote_token: { type: "string" }, direction: { type: "string", enum: ["buy", "sell"] }, price_low: { type: "number" }, price_high: { type: "number" }, budget: { type: "number" }, market_price: { type: "number" } },
  },
  create_recurring_strategy: {
    required: ["wallet_address", "chain", "base_token", "quote_token", "buy_price_low", "buy_price_high", "buy_budget", "sell_price_low", "sell_price_high", "sell_budget"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, base_token: { type: "string" }, quote_token: { type: "string" }, buy_price_low: { type: "number" }, buy_price_high: { type: "number" }, buy_price_marginal: { type: "number" }, buy_budget: { type: "number" }, sell_price_low: { type: "number" }, sell_price_high: { type: "number" }, sell_budget: { type: "number" }, market_price: { type: "number" } },
  },
  create_concentrated_strategy: {
    required: ["wallet_address", "chain", "base_token", "quote_token", "price_low", "price_high", "spread_percentage", "anchor", "budget", "market_price"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, base_token: { type: "string" }, quote_token: { type: "string" }, price_low: { type: "number" }, price_high: { type: "number" }, spread_percentage: { type: "number" }, anchor: { type: "string", enum: ["buy", "sell"] }, budget: { type: "number" }, market_price: { type: "number" } },
  },
  create_full_range_strategy: {
    required: ["wallet_address", "chain", "base_token", "quote_token", "spread_percentage", "anchor", "budget", "market_price"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, base_token: { type: "string" }, quote_token: { type: "string" }, spread_percentage: { type: "number" }, anchor: { type: "string", enum: ["buy", "sell"] }, budget: { type: "number" }, market_price: { type: "number" } },
  },
  reprice_strategy: {
    required: ["wallet_address", "chain", "strategy_id"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, strategy_id: { type: "string" }, buy_price_low: { type: "number" }, buy_price_high: { type: "number" }, sell_price_low: { type: "number" }, sell_price_high: { type: "number" } },
  },
  edit_strategy: {
    required: ["wallet_address", "chain", "strategy_id"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, strategy_id: { type: "string" }, buy_price_low: { type: "number" }, buy_price_high: { type: "number" }, buy_budget: { type: "number" }, sell_price_low: { type: "number" }, sell_price_high: { type: "number" }, sell_budget: { type: "number" }, market_price: { type: "number" } },
  },
  deposit_budget: {
    required: ["wallet_address", "chain", "strategy_id"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, strategy_id: { type: "string" }, buy_budget_increase: { type: "number" }, sell_budget_increase: { type: "number" }, anchor: { type: "string", enum: ["buy", "sell"] }, budget_increase: { type: "number" }, market_price: { type: "number" }, spread_percentage: { type: "number" } },
  },
  withdraw_budget: {
    required: ["wallet_address", "chain", "strategy_id"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, strategy_id: { type: "string" }, buy_budget_decrease: { type: "number" }, sell_budget_decrease: { type: "number" }, anchor: { type: "string", enum: ["buy", "sell"] }, budget_decrease: { type: "number" }, market_price: { type: "number" }, spread_percentage: { type: "number" } },
  },
  pause_strategy: {
    required: ["wallet_address", "chain", "strategy_id"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, strategy_id: { type: "string" } },
  },
  resume_strategy: {
    required: ["wallet_address", "chain", "strategy_id", "market_price"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, strategy_id: { type: "string" }, buy_price_low: { type: "number" }, buy_price_high: { type: "number" }, sell_price_low: { type: "number" }, sell_price_high: { type: "number" }, market_price: { type: "number" } },
  },
  delete_strategy: {
    required: ["wallet_address", "chain", "strategy_id"],
    properties: { wallet_address: { type: "string" }, chain: CHAIN_ENUM, strategy_id: { type: "string" } },
  },
};

const SUMMARIES: Record<string, string> = {
  get_strategies:               "Fetch all active strategies for a wallet",
  create_limit_order:           "Create a one-time limit order at exact price",
  create_range_order:           "Create a one-time range order across a price range. Good for DCA.",
  create_recurring_strategy:    "Create a looping buy+sell strategy with zero gas on fills",
  create_concentrated_strategy: "Create two-sided liquidity with a defined spread",
  create_full_range_strategy:   "Create full range liquidity (up to 1000x from market price)",
  reprice_strategy:             "Update price ranges of an existing strategy",
  edit_strategy:                "Edit prices and budgets together in one transaction",
  deposit_budget:               "Add funds to an existing strategy",
  withdraw_budget:              "Withdraw funds from a strategy without closing it",
  pause_strategy:               "Pause a strategy - prices zeroed, funds stay",
  resume_strategy:              "Resume a paused strategy by restoring price ranges",
  delete_strategy:              "Permanently close a strategy and return all funds",
};

const TAGS: Record<string, string[]> = {
  get_strategies: ["Read"],
  create_limit_order: ["Create"], create_range_order: ["Create"],
  create_recurring_strategy: ["Create"], create_concentrated_strategy: ["Create"],
  create_full_range_strategy: ["Create"],
  reprice_strategy: ["Manage"], edit_strategy: ["Manage"],
  deposit_budget: ["Manage"], withdraw_budget: ["Manage"],
  pause_strategy: ["Manage"], resume_strategy: ["Manage"], delete_strategy: ["Manage"],
};

// Build paths dynamically from HANDLERS keys
const paths: Record<string, object> = {};
for (const toolName of Object.keys(HANDLERS)) {
  paths[`/tools/${toolName}`] = {
    post: {
      operationId: toolName,
      summary: SUMMARIES[toolName] || toolName,
      tags: TAGS[toolName] || ["Tools"],
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", ...(SCHEMAS[toolName] || {}) } } },
      },
      responses: {
        "200": { description: "Success — returns strategy preview and unsigned transaction" },
        "400": { description: "Invalid parameters or business logic error" },
      },
    },
  };
}

export const OPENAPI_SPEC = {
  openapi: "3.0.0",
  info: {
    title: "Carbon DeFi API",
    version: "0.3.0",
    description: "REST API for creating and managing on-chain maker trading strategies on Carbon DeFi. All write operations return unsigned transactions — the user signs and broadcasts.",
  },
  servers: [
    { url: "https://carbon-mcp.duckdns.org", description: "Production" },
    { url: "http://localhost:3000", description: "Local" },
  ],
  paths,
};
