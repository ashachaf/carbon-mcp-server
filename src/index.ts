import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Toolkit, MarginalPriceOptions, calculateOverlappingPrices, calculateOverlappingBuyBudget, calculateOverlappingSellBudget, getMinMaxPricesByDecimals } from "@bancor/carbon-sdk/strategy-management";
import { ChainCache, initSyncedCache } from "@bancor/carbon-sdk/chain-cache";
import { ContractsApi } from "@bancor/carbon-sdk/contracts-api";
import { JsonRpcProvider, Contract, parseUnits } from "ethers";
import { z } from "zod";
import * as http from "http";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Chain Configuration ────────────────────────────────────────────────────

const CHAIN_CONFIG: Record<string, {
  rpcUrl: string;
  carbonControllerAddress: string;
  voucherAddress: string;
  chainId: number;
}> = {
  ethereum: {
    rpcUrl: process.env.RPC_URL_ETHEREUM || "https://eth.llamarpc.com",
    carbonControllerAddress: "0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1",
    voucherAddress: "0x3660F04B79751e31128f6378eAC70807e38f554E",
    chainId: parseInt(process.env.CHAIN_ID_ETHEREUM || "1"),
  },
  sei: {
    rpcUrl: process.env.RPC_URL_SEI || "https://evm-rpc.sei-apis.com",
    carbonControllerAddress: "0xe4816658ad10bF215053C533cceAe3f59e1f1087",
    voucherAddress: "0xA4682A2A5Fe02feFF8Bd200240A41AD0E6EaF8d5",
    chainId: 1329,
  },
  celo: {
    rpcUrl: process.env.RPC_URL_CELO || "https://forno.celo.org",
    carbonControllerAddress: "0x6619871118D144c1c28eC3b23036FC1f0829ed3a",
    voucherAddress: "0x5E994Ac7d65d81f51a76e0bB5a236C6fDA8dBF9A",
    chainId: 42220,
  },
  tac: {
    rpcUrl: process.env.RPC_URL_TAC || "https://rpc.tac.build",
    carbonControllerAddress: "0xA4682A2A5Fe02feFF8Bd200240A41AD0E6EaF8d5",
    voucherAddress: "0xb0d39990E1C38B50D0b7f6911525535Fbacb4C26",
    chainId: 239,
  },
};

const CHAIN_ENUM = ["ethereum", "sei", "celo", "tac"] as const;

// ─── SDK Cache ───────────────────────────────────────────────────────────────

const sdkCache: Record<string, Toolkit> = {};

async function getSDK(chain: string): Promise<Toolkit> {
  if (sdkCache[chain]) return sdkCache[chain];
  const config = CHAIN_CONFIG[chain];
  if (!config) throw new Error(`Unsupported chain: ${chain}`);
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
  const api = new ContractsApi(provider as any, {
    carbonControllerAddress: config.carbonControllerAddress,
    voucherAddress: config.voucherAddress,
  });
  const { cache, startDataSync } = initSyncedCache(api.reader, undefined, 2000);
  const toolkit = new Toolkit(api, cache as ChainCache);
  startDataSync();
  sdkCache[chain] = toolkit;
  return toolkit;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

async function checkAllowance(
  chain: string,
  tokenAddress: string,
  walletAddress: string,
  budget: number
): Promise<string | null> {
  if (tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase()) return null;
  try {
    const config = CHAIN_CONFIG[chain];
    const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
    const token = new Contract(tokenAddress, ERC20_ABI, provider);
    const decimals = await token.decimals();
    const allowance = await token.allowance(walletAddress, config.carbonControllerAddress);
    const required = parseUnits(budget.toString(), decimals);
    if (allowance < required) {
      return `Token allowance insufficient. Before submitting, approve the Carbon DeFi controller (${config.carbonControllerAddress}) to spend at least ${budget} tokens on contract ${tokenAddress}. Note: USDT on Ethereum requires setting allowance to 0 before increasing.`;
    }
    return null;
  } catch (e: any) {
    return `Could not check token allowance: ${e.message}`;
  }
}

function formatTx(tx: any) {
  return { to: tx.to, data: tx.data, value: tx.value?.toString() || "0" };
}

function ok(data: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ status: "ok", ...data }, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }] };
}

// ─── Server ───────────────────────────────────────────────────────────────────

function createServer() {
  const server = new McpServer({ name: "Carbon DeFi", version: "0.3.0" });

  // ── Get Strategies ──────────────────────────────────────────────────────────

  server.tool(
    "carbon_get_strategies",
    "Fetch all active Carbon DeFi maker strategies for a wallet. Always call this first to check existing positions before creating or modifying anything.",
    {
      wallet_address: z.string().describe("EVM wallet address (0x...)"),
      chain: z.enum(CHAIN_ENUM).describe("Chain to query"),
    },
    async ({ wallet_address, chain }) => {
      try {
        const sdk = await getSDK(chain);
        const strategies = await sdk.getUserStrategies(wallet_address);
        return ok({
          wallet_address,
          chain,
          strategy_count: strategies.length,
          strategies: strategies.map((s: any) => ({
            strategy_id: s.id,
            base_token: s.baseToken,
            quote_token: s.quoteToken,
            buy_price_low: s.buyPriceLow,
            buy_price_high: s.buyPriceHigh,
            buy_budget: s.buyBudget,
            buy_budget_token: s.quoteToken,
            sell_price_low: s.sellPriceLow,
            sell_price_high: s.sellPriceHigh,
            sell_budget: s.sellBudget,
            sell_budget_token: s.baseToken,
            price_unit: "quote per base",
            encoded: s.encoded,
          })),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Create Limit Order ──────────────────────────────────────────────────────

  server.tool(
    "carbon_create_limit_order",
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
    async (params) => {
      const warnings: string[] = [];
      if (params.market_price) {
        if (params.direction === "buy" && params.price > params.market_price)
          warnings.push(`Buy price (${params.price}) is above market (${params.market_price}) - order may fill immediately.`);
        if (params.direction === "sell" && params.price < params.market_price)
          warnings.push(`Sell price (${params.price}) is below market (${params.market_price}) - order may fill immediately.`);
      }
      const checkToken = params.direction === "buy" ? params.quote_token : params.base_token;
      const aw = await checkAllowance(params.chain, checkToken, params.wallet_address, params.budget);
      if (aw) warnings.push(aw);
      try {
        const sdk = await getSDK(params.chain);
        const isBuy = params.direction === "buy";
        const p = params.price.toString();
        const b = params.budget.toString();
        const tx = await sdk.createBuySellStrategy(
          params.base_token, params.quote_token,
          isBuy ? p : "0", isBuy ? p : "0", isBuy ? p : "0", isBuy ? b : "0",
          isBuy ? "0" : p,  isBuy ? "0" : p,  isBuy ? "0" : p,  isBuy ? "0" : b
        );
        return ok({
          warnings,
          strategy_preview: { type: "limit_order", direction: params.direction, price: params.price, budget: params.budget, chain: params.chain },
          unsigned_transaction: formatTx(tx),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Create Range Order ──────────────────────────────────────────────────────

  server.tool(
    "carbon_create_range_order",
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
    async (params) => {
      if (params.price_low >= params.price_high) return err("price_low must be less than price_high");
      const warnings: string[] = [];
      if (params.market_price) {
        if (params.direction === "buy" && params.price_high > params.market_price)
          warnings.push(`Buy range top (${params.price_high}) is above market (${params.market_price}).`);
        if (params.direction === "sell" && params.price_low < params.market_price)
          warnings.push(`Sell range bottom (${params.price_low}) is below market (${params.market_price}).`);
      }
      const checkToken = params.direction === "buy" ? params.quote_token : params.base_token;
      const aw = await checkAllowance(params.chain, checkToken, params.wallet_address, params.budget);
      if (aw) warnings.push(aw);
      try {
        const sdk = await getSDK(params.chain);
        const isBuy = params.direction === "buy";
        const lo = params.price_low.toString();
        const hi = params.price_high.toString();
        const b = params.budget.toString();
        const tx = await sdk.createBuySellStrategy(
          params.base_token, params.quote_token,
          isBuy ? lo : "0", isBuy ? hi : "0", isBuy ? hi : "0", isBuy ? b : "0",
          isBuy ? "0" : lo, isBuy ? "0" : lo, isBuy ? "0" : hi, isBuy ? "0" : b
        );
        return ok({
          warnings,
          strategy_preview: { type: "range_order", direction: params.direction, price_low: params.price_low, price_high: params.price_high, budget: params.budget, chain: params.chain },
          unsigned_transaction: formatTx(tx),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Create Recurring Strategy ───────────────────────────────────────────────

  server.tool(
    "carbon_create_recurring_strategy",
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
    async (params) => {
      if (params.buy_price_low > params.buy_price_high) return err("buy_price_low must be less than buy_price_high");
      if (params.sell_price_low > params.sell_price_high) return err("sell_price_low must be less than sell_price_high");
      if (params.buy_budget === 0 && params.sell_budget === 0) return err("Both budgets are zero.");
      const warnings: string[] = [];
      if (params.buy_price_high > params.sell_price_low)
        warnings.push("Buy and sell ranges overlap - both orders active simultaneously in overlapping zone. Risk of circular execution. Confirm this is intentional.");
      if (params.market_price) {
        if (params.buy_price_high > params.market_price)
          warnings.push(`Buy range top (${params.buy_price_high}) is above market (${params.market_price}).`);
        if (params.sell_price_low < params.market_price)
          warnings.push(`Sell range bottom (${params.sell_price_low}) is below market (${params.market_price}).`);
      }
      if (params.buy_budget > 0) {
        const aw = await checkAllowance(params.chain, params.quote_token, params.wallet_address, params.buy_budget);
        if (aw) warnings.push(aw);
      }
      if (params.sell_budget > 0) {
        const aw = await checkAllowance(params.chain, params.base_token, params.wallet_address, params.sell_budget);
        if (aw) warnings.push(aw);
      }
      try {
        const sdk = await getSDK(params.chain);
        const tx = await sdk.createBuySellStrategy(
          params.base_token, params.quote_token,
          params.buy_price_low.toString(),
          (params.buy_price_marginal ?? params.buy_price_high).toString(),
          params.buy_price_high.toString(),
          params.buy_budget.toString(),
          params.sell_price_low.toString(),
          params.sell_price_low.toString(),
          params.sell_price_high.toString(),
          params.sell_budget.toString()
        );
        return ok({
          warnings,
          strategy_preview: {
            type: "recurring",
            chain: params.chain,
            base_token: params.base_token,
            quote_token: params.quote_token,
            buy_order: { price_low: params.buy_price_low, price_high: params.buy_price_high, budget: params.buy_budget },
            sell_order: { price_low: params.sell_price_low, price_high: params.sell_price_high, budget: params.sell_budget },
          },
          unsigned_transaction: formatTx(tx),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Create Concentrated Strategy ────────────────────────────────────────────

  server.tool(
    "carbon_create_concentrated_strategy",
    "Create a two-sided concentrated liquidity strategy on Carbon DeFi with a defined spread. Earn fees on both sides. User provides a budget for one anchor side — the other is auto-calculated. anchor='buy' means user provides quote token budget (e.g. USDC); anchor='sell' means user provides base token budget (e.g. ETH).",
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
    async (params) => {
      if (params.price_low >= params.price_high) return err("price_low must be less than price_high");
      if (params.market_price < params.price_low || params.market_price > params.price_high)
        return err(`Market price (${params.market_price}) must be within range [${params.price_low}, ${params.price_high}].`);
      const warnings: string[] = [];
      const checkToken = params.anchor === "buy" ? params.quote_token : params.base_token;
      const aw = await checkAllowance(params.chain, checkToken, params.wallet_address, params.budget);
      if (aw) warnings.push(aw);
      try {
        const sdk = await getSDK(params.chain);
        const config = CHAIN_CONFIG[params.chain];
        const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);

        // Fetch token decimals
        const baseDecimals: number = params.base_token === ETH_ADDRESS ? 18 :
          Number(await new Contract(params.base_token, ERC20_ABI, provider).decimals());
        const quoteDecimals: number = params.quote_token === ETH_ADDRESS ? 18 :
          Number(await new Contract(params.quote_token, ERC20_ABI, provider).decimals());

        const min = params.price_low.toString();
        const max = params.price_high.toString();
        const market = params.market_price.toString();
        const spread = params.spread_percentage.toString();

        let buyBudget: string;
        let sellBudget: string;
        if (params.anchor === "buy") {
          buyBudget = params.budget.toString();
          sellBudget = calculateOverlappingSellBudget(baseDecimals, quoteDecimals, min, max, market, spread, buyBudget);
        } else {
          sellBudget = params.budget.toString();
          buyBudget = calculateOverlappingBuyBudget(baseDecimals, quoteDecimals, min, max, market, spread, sellBudget);
        }

        const overlappingPrices = calculateOverlappingPrices(min, max, market, spread);
        const tx = await sdk.createBuySellStrategy(
          params.base_token, params.quote_token,
          overlappingPrices.buyPriceLow, overlappingPrices.buyPriceMarginal, overlappingPrices.buyPriceHigh, buyBudget,
          overlappingPrices.sellPriceLow, overlappingPrices.sellPriceMarginal, overlappingPrices.sellPriceHigh, sellBudget
        );
        return ok({
          warnings,
          strategy_preview: {
            type: "concentrated",
            chain: params.chain,
            price_low: params.price_low,
            price_high: params.price_high,
            spread_percentage: params.spread_percentage,
            anchor: params.anchor,
            buy_budget: buyBudget,
            sell_budget: sellBudget,
            market_price: params.market_price,
          },
          unsigned_transaction: formatTx(tx),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Create Full Range Strategy ─────────────────────────────────────────────

  server.tool(
    "carbon_create_full_range_strategy",
    "Create a two-sided full range concentrated liquidity strategy on Carbon DeFi. Automatically sets the widest possible price range (capped at 1000x from market price). User provides an anchor budget on one side — the other side is calculated automatically. anchor='buy' means user provides quote token budget; anchor='sell' means user provides base token budget.",
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
    async (params) => {
      const warnings: string[] = [];
      const checkToken = params.anchor === "buy" ? params.quote_token : params.base_token;
      const aw = await checkAllowance(params.chain, checkToken, params.wallet_address, params.budget);
      if (aw) warnings.push(aw);
      try {
        const sdk = await getSDK(params.chain);
        const config = CHAIN_CONFIG[params.chain];
        const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);

        // Fetch token decimals
        const baseTokenContract = new Contract(
          params.base_token === ETH_ADDRESS ? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" : params.base_token,
          ERC20_ABI, provider
        );
        const quoteTokenContract = new Contract(
          params.quote_token === ETH_ADDRESS ? "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" : params.quote_token,
          ERC20_ABI, provider
        );
        const baseDecimals: number = params.base_token === ETH_ADDRESS ? 18 :
          Number(await baseTokenContract.decimals());
        const quoteDecimals: number = params.quote_token === ETH_ADDRESS ? 18 :
          Number(await quoteTokenContract.decimals());

        // Calculate full range prices using app logic: factor = min(market/minBuy, maxSell/market, 1000)
        const { minBuyPrice, maxSellPrice } = getMinMaxPricesByDecimals(baseDecimals, quoteDecimals);
        const price = params.market_price;
        const factor = Math.min(
          price / parseFloat(minBuyPrice),
          parseFloat(maxSellPrice) / price,
          1000
        );
        const min = (price / factor).toString();
        const max = (price * factor).toString();

        // Calculate overlapping prices (marginals)
        const prices = calculateOverlappingPrices(
          min, max,
          params.market_price.toString(),
          params.spread_percentage.toString()
        );

        // Calculate the non-anchor budget using standalone SDK functions
        let buyBudget: string;
        let sellBudget: string;
        if (params.anchor === "buy") {
          buyBudget = params.budget.toString();
          sellBudget = calculateOverlappingSellBudget(
            baseDecimals, quoteDecimals,
            min, max,
            params.market_price.toString(),
            params.spread_percentage.toString(),
            buyBudget
          );
        } else {
          sellBudget = params.budget.toString();
          buyBudget = calculateOverlappingBuyBudget(
            baseDecimals, quoteDecimals,
            min, max,
            params.market_price.toString(),
            params.spread_percentage.toString(),
            sellBudget
          );
        }

        const tx = await sdk.createBuySellStrategy(
          params.base_token, params.quote_token,
          prices.buyPriceLow, prices.buyPriceMarginal, prices.buyPriceHigh, buyBudget,
          prices.sellPriceLow, prices.sellPriceMarginal, prices.sellPriceHigh, sellBudget
        );

        return ok({
          warnings,
          strategy_preview: {
            type: "full_range",
            chain: params.chain,
            price_low: min,
            price_high: max,
            factor: factor.toFixed(2),
            spread_percentage: params.spread_percentage,
            buy_budget: buyBudget,
            sell_budget: sellBudget,
            market_price: params.market_price,
          },
          unsigned_transaction: formatTx(tx),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Reprice Strategy ────────────────────────────────────────────────────────

  server.tool(
    "carbon_reprice_strategy",
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
    async (params) => {
      try {
        const sdk = await getSDK(params.chain);
        const strategy = await sdk.getStrategyById(params.strategy_id);
        const noChange =
          (params.buy_price_low === undefined  || params.buy_price_low  === parseFloat(strategy.buyPriceLow  || "0")) &&
          (params.buy_price_high === undefined || params.buy_price_high === parseFloat(strategy.buyPriceHigh || "0")) &&
          (params.sell_price_low === undefined || params.sell_price_low === parseFloat(strategy.sellPriceLow || "0")) &&
          (params.sell_price_high === undefined|| params.sell_price_high=== parseFloat(strategy.sellPriceHigh|| "0"));
        if (noChange) return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "no_change",
            message: "The new prices are identical to the current strategy prices. No transaction needed.",
            current: { buyPriceLow: strategy.buyPriceLow, buyPriceHigh: strategy.buyPriceHigh, sellPriceLow: strategy.sellPriceLow, sellPriceHigh: strategy.sellPriceHigh },
          }, null, 2) }],
        };
        const tx = await sdk.updateStrategy(
          params.strategy_id, strategy.encoded,
          {
            buyPriceLow: params.buy_price_low?.toString(),
            buyPriceHigh: params.buy_price_high?.toString(),
            sellPriceLow: params.sell_price_low?.toString(),
            sellPriceHigh: params.sell_price_high?.toString(),
          },
          MarginalPriceOptions.maintain,
          MarginalPriceOptions.maintain
        );
        return ok({ message: "Strategy repriced. Sign and submit to apply.", unsigned_transaction: formatTx(tx) });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Edit Strategy ───────────────────────────────────────────────────────────

  server.tool(
    "carbon_edit_strategy",
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
    async (params) => {
      const warnings: string[] = [];
      if (params.market_price) {
        if (params.buy_price_high && params.buy_price_high > params.market_price)
          warnings.push(`Buy range top (${params.buy_price_high}) is above market (${params.market_price}).`);
        if (params.sell_price_low && params.sell_price_low < params.market_price)
          warnings.push(`Sell range bottom (${params.sell_price_low}) is below market (${params.market_price}).`);
      }
      try {
        const sdk = await getSDK(params.chain);
        const strategy = await sdk.getStrategyById(params.strategy_id);
        if (params.buy_budget !== undefined) {
          const aw = await checkAllowance(params.chain, strategy.quoteToken, params.wallet_address, params.buy_budget);
          if (aw) warnings.push(aw);
        }
        if (params.sell_budget !== undefined) {
          const aw = await checkAllowance(params.chain, strategy.baseToken, params.wallet_address, params.sell_budget);
          if (aw) warnings.push(aw);
        }
        const tx = await sdk.updateStrategy(
          params.strategy_id, strategy.encoded,
          {
            buyPriceLow: params.buy_price_low?.toString(),
            buyPriceHigh: params.buy_price_high?.toString(),
            buyBudget: params.buy_budget?.toString(),
            sellPriceLow: params.sell_price_low?.toString(),
            sellPriceHigh: params.sell_price_high?.toString(),
            sellBudget: params.sell_budget?.toString(),
          },
          MarginalPriceOptions.reset,
          MarginalPriceOptions.reset
        );
        return ok({ warnings, message: "Strategy edit ready. Sign and submit to apply.", unsigned_transaction: formatTx(tx) });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Deposit Budget ──────────────────────────────────────────────────────────

  server.tool(
    "carbon_deposit_budget",
    "Add funds to an existing Carbon DeFi strategy. For simple strategies: provide buy_budget_increase and/or sell_budget_increase as deltas. For concentrated or full range strategies: provide anchor ('buy' or 'sell'), budget_increase for the anchor side, market_price, and spread_percentage — the other side will be recalculated automatically to maintain correct ratio.",
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
    async (params) => {
      const isOverlapping = params.anchor && params.budget_increase !== undefined && params.market_price && params.spread_percentage !== undefined;
      if (!isOverlapping && !params.buy_budget_increase && !params.sell_budget_increase)
        return err("Provide at least one of buy_budget_increase or sell_budget_increase, or use anchor+budget_increase+market_price+spread_percentage for concentrated strategies");
      try {
        const sdk = await getSDK(params.chain);
        const strategy = await sdk.getStrategyById(params.strategy_id);
        const currentBuy = parseFloat(strategy.buyBudget || "0");
        const currentSell = parseFloat(strategy.sellBudget || "0");
        const warnings: string[] = [];

        let newBuyBudget: string | undefined;
        let newSellBudget: string | undefined;

        if (isOverlapping) {
          const config = CHAIN_CONFIG[params.chain];
          const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
          const baseDecimals: number = strategy.baseToken === ETH_ADDRESS ? 18 :
            Number(await new Contract(strategy.baseToken, ERC20_ABI, provider).decimals());
          const quoteDecimals: number = strategy.quoteToken === ETH_ADDRESS ? 18 :
            Number(await new Contract(strategy.quoteToken, ERC20_ABI, provider).decimals());
          const min = strategy.buyPriceLow;
          const max = strategy.sellPriceHigh;
          const market = params.market_price!.toString();
          const spread = params.spread_percentage!.toString();

          if (params.anchor === "buy") {
            const anchorBudget = (currentBuy + params.budget_increase!).toString();
            const calcSell = calculateOverlappingSellBudget(baseDecimals, quoteDecimals, min, max, market, spread, anchorBudget);
            newBuyBudget = anchorBudget;
            newSellBudget = calcSell;
            const aw = await checkAllowance(params.chain, strategy.quoteToken, params.wallet_address, params.budget_increase!);
            if (aw) warnings.push(aw);
          } else {
            const anchorBudget = (currentSell + params.budget_increase!).toString();
            const calcBuy = calculateOverlappingBuyBudget(baseDecimals, quoteDecimals, min, max, market, spread, anchorBudget);
            newSellBudget = anchorBudget;
            newBuyBudget = calcBuy;
            const aw = await checkAllowance(params.chain, strategy.baseToken, params.wallet_address, params.budget_increase!);
            if (aw) warnings.push(aw);
          }
        } else {
          if (params.buy_budget_increase) {
            newBuyBudget = (currentBuy + params.buy_budget_increase).toString();
            const aw = await checkAllowance(params.chain, strategy.quoteToken, params.wallet_address, params.buy_budget_increase);
            if (aw) warnings.push(aw);
          }
          if (params.sell_budget_increase) {
            newSellBudget = (currentSell + params.sell_budget_increase).toString();
            const aw = await checkAllowance(params.chain, strategy.baseToken, params.wallet_address, params.sell_budget_increase);
            if (aw) warnings.push(aw);
          }
        }

        const tx = await sdk.updateStrategy(
          params.strategy_id, strategy.encoded,
          { buyBudget: newBuyBudget, sellBudget: newSellBudget },
          MarginalPriceOptions.maintain,
          MarginalPriceOptions.maintain
        );
        return ok({ warnings, message: "Deposit ready. Sign and submit to add funds.", unsigned_transaction: formatTx(tx) });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Withdraw Budget ─────────────────────────────────────────────────────────

  server.tool(
    "carbon_withdraw_budget",
    "Withdraw funds from an existing Carbon DeFi strategy without closing it. For simple strategies: provide buy_budget_decrease and/or sell_budget_decrease as deltas. For concentrated or full range strategies: provide anchor ('buy' or 'sell'), budget_decrease for the anchor side, market_price, and spread_percentage — the other side will be recalculated automatically to maintain correct ratio.",
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
    async (params) => {
      const isOverlapping = params.anchor && params.budget_decrease !== undefined && params.market_price && params.spread_percentage !== undefined;
      if (!isOverlapping && !params.buy_budget_decrease && !params.sell_budget_decrease)
        return err("Provide at least one of buy_budget_decrease or sell_budget_decrease, or use anchor+budget_decrease+market_price+spread_percentage for concentrated strategies");
      try {
        const sdk = await getSDK(params.chain);
        const strategy = await sdk.getStrategyById(params.strategy_id);
        const currentBuy = parseFloat(strategy.buyBudget || "0");
        const currentSell = parseFloat(strategy.sellBudget || "0");

        let newBuyBudget: string | undefined;
        let newSellBudget: string | undefined;

        if (isOverlapping) {
          const config = CHAIN_CONFIG[params.chain];
          const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
          const baseDecimals: number = strategy.baseToken === ETH_ADDRESS ? 18 :
            Number(await new Contract(strategy.baseToken, ERC20_ABI, provider).decimals());
          const quoteDecimals: number = strategy.quoteToken === ETH_ADDRESS ? 18 :
            Number(await new Contract(strategy.quoteToken, ERC20_ABI, provider).decimals());
          const min = strategy.buyPriceLow;
          const max = strategy.sellPriceHigh;
          const market = params.market_price!.toString();
          const spread = params.spread_percentage!.toString();

          if (params.anchor === "buy") {
            const anchorBudget = currentBuy - params.budget_decrease!;
            if (anchorBudget < 0) return err(`Cannot withdraw ${params.budget_decrease} - current buy budget is only ${currentBuy}`);
            const calcSell = calculateOverlappingSellBudget(baseDecimals, quoteDecimals, min, max, market, spread, anchorBudget.toString());
            newBuyBudget = anchorBudget.toString();
            newSellBudget = calcSell;
          } else {
            const anchorBudget = currentSell - params.budget_decrease!;
            if (anchorBudget < 0) return err(`Cannot withdraw ${params.budget_decrease} - current sell budget is only ${currentSell}`);
            const calcBuy = calculateOverlappingBuyBudget(baseDecimals, quoteDecimals, min, max, market, spread, anchorBudget.toString());
            newSellBudget = anchorBudget.toString();
            newBuyBudget = calcBuy;
          }
        } else {
          if (params.buy_budget_decrease) {
            if (params.buy_budget_decrease > currentBuy)
              return err(`Cannot withdraw ${params.buy_budget_decrease} - current buy budget is only ${currentBuy}`);
            newBuyBudget = (currentBuy - params.buy_budget_decrease).toString();
          }
          if (params.sell_budget_decrease) {
            if (params.sell_budget_decrease > currentSell)
              return err(`Cannot withdraw ${params.sell_budget_decrease} - current sell budget is only ${currentSell}`);
            newSellBudget = (currentSell - params.sell_budget_decrease).toString();
          }
        }

        const tx = await sdk.updateStrategy(
          params.strategy_id, strategy.encoded,
          { buyBudget: newBuyBudget, sellBudget: newSellBudget },
          MarginalPriceOptions.maintain,
          MarginalPriceOptions.maintain
        );
        return ok({ message: "Withdrawal ready. Sign and submit to remove funds.", unsigned_transaction: formatTx(tx) });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Pause Strategy ──────────────────────────────────────────────────────────

  server.tool(
    "carbon_pause_strategy",
    "Pause an active Carbon DeFi strategy by zeroing order prices. Funds remain in the strategy. Always call this tool - never assume current state from prior context. BEFORE calling this tool: (1) Show the user their current prices and tell them to save them - they will need these to resume. (2) Ask if they want to pause (funds stay), withdraw funds, or delete the strategy entirely. Only call this tool if they confirm pause.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string(),
    },
    async (params) => {
      try {
        const sdk = await getSDK(params.chain);
        const strategy = await sdk.getStrategyById(params.strategy_id);
        const alreadyPaused =
          parseFloat(strategy.buyPriceHigh || "0") === 0 &&
          parseFloat(strategy.sellPriceHigh || "0") === 0;
        if (alreadyPaused) return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "already_paused",
            message: "This strategy is already paused - both order prices are zero. No transaction needed.",
            options: "You can resume with carbon_resume_strategy, withdraw funds with carbon_withdraw_budget, or close entirely with carbon_delete_strategy.",
          }, null, 2) }],
        };
        const tx = await sdk.updateStrategy(
          params.strategy_id, strategy.encoded,
          { buyPriceLow: "0", buyPriceHigh: "0", sellPriceLow: "0", sellPriceHigh: "0" },
          MarginalPriceOptions.reset,
          MarginalPriceOptions.reset
        );
        return ok({
          message: "Strategy will be paused. Funds remain in strategy, orders become inactive. Sign and submit to confirm.",
          prices_to_save: {
            buyPriceLow: strategy.buyPriceLow,
            buyPriceHigh: strategy.buyPriceHigh,
            sellPriceLow: strategy.sellPriceLow,
            sellPriceHigh: strategy.sellPriceHigh,
          },
          unsigned_transaction: formatTx(tx),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Resume Strategy ─────────────────────────────────────────────────────────

  server.tool(
    "carbon_resume_strategy",
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
    async (params) => {
      try {
        const sdk = await getSDK(params.chain);
        const strategy = await sdk.getStrategyById(params.strategy_id);
        const isPaused =
          parseFloat(strategy.buyPriceHigh || "0") === 0 &&
          parseFloat(strategy.sellPriceHigh || "0") === 0;
        if (!isPaused) return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "no_change",
            message: "Strategy is already active - no transaction needed.",
            current: { buyPriceLow: strategy.buyPriceLow, buyPriceHigh: strategy.buyPriceHigh, sellPriceLow: strategy.sellPriceLow, sellPriceHigh: strategy.sellPriceHigh },
          }, null, 2) }],
        };
        const warnings: string[] = [];
        if (params.buy_price_high && params.buy_price_high > params.market_price)
          warnings.push(`Buy range top (${params.buy_price_high}) is above market (${params.market_price}) - buy order will execute immediately on resume.`);
        if (params.sell_price_low && params.sell_price_low < params.market_price)
          warnings.push(`Sell range bottom (${params.sell_price_low}) is below market (${params.market_price}) - sell order will execute immediately on resume.`);
        const tx = await sdk.updateStrategy(
          params.strategy_id, strategy.encoded,
          {
            buyPriceLow: params.buy_price_low?.toString(),
            buyPriceHigh: params.buy_price_high?.toString(),
            sellPriceLow: params.sell_price_low?.toString(),
            sellPriceHigh: params.sell_price_high?.toString(),
          },
          MarginalPriceOptions.reset,
          MarginalPriceOptions.reset
        );
        return ok({
          warnings,
          message: "Strategy resume ready. Funds already in strategy will be reactivated at the new prices. Sign and submit to confirm.",
          unsigned_transaction: formatTx(tx),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Delete Strategy ─────────────────────────────────────────────────────────

  server.tool(
    "carbon_delete_strategy",
    "Permanently close a Carbon DeFi strategy and return all funds to the wallet. This is irreversible. Always confirm with the user before calling this tool.",
    {
      wallet_address: z.string(),
      chain: z.enum(CHAIN_ENUM),
      strategy_id: z.string().describe("Strategy ID from carbon_get_strategies"),
    },
    async ({ wallet_address, strategy_id, chain }) => {
      try {
        const sdk = await getSDK(chain);
        const tx = await sdk.deleteStrategy(strategy_id);
        return ok({
          warning: "IRREVERSIBLE. This will permanently close the strategy and return all funds to the wallet.",
          strategy_id,
          chain,
          wallet_address,
          unsigned_transaction: formatTx(tx),
        });
      } catch (e: any) {
        return err(e.message);
      }
    }
  );

  // ── Prompt & Skill Resource ─────────────────────────────────────────────────

  server.prompt(
    "carbon-defi-instructions",
    "Instructions for using Carbon DeFi tools correctly",
    () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Before using any Carbon DeFi tools, read the carbon-defi-skill resource at carbon://skill. It contains critical instructions for token addresses, price conventions, allowance checks, marginal price behavior, and execution flow. Always follow those instructions when helping users create or manage Carbon DeFi strategies.",
        },
      }],
    })
  );

  server.resource(
    "carbon-defi-skill",
    "carbon://skill",
    async (uri) => {
      const skillPath = path.join(__dirname, "..", "SKILL.md");
      const text = fs.readFileSync(skillPath, "utf-8");
      return {
        contents: [{
          uri: uri.href,
          mimeType: "text/markdown",
          text,
        }],
      };
    }
  );

  return server;
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || "3000");

const INFO = {
  name: "Carbon DeFi MCP Server",
  version: "0.3.0",
  description: "MCP server for creating and managing on-chain maker trading strategies on Carbon DeFi. Returns unsigned transactions - the user signs and broadcasts. Zero gas on fills. Maker-first.",
  endpoint: "https://carbon-mcp.duckdns.org/mcp",
  supported_chains: ["ethereum", "sei", "celo", "tac"],
  claude_desktop_config: {
    mcpServers: {
      "carbon-defi": {
        command: "npx",
        args: ["mcp-remote", "https://carbon-mcp.duckdns.org/mcp"],
      },
    },
  },
  tools: [
    {
      name: "carbon_get_strategies",
      description: "Fetch all active maker strategies for a wallet. Always call first.",
    },
    {
      name: "carbon_create_limit_order",
      description: "Create a one-time buy or sell order at a single exact price.",
    },
    {
      name: "carbon_create_range_order",
      description: "Create a one-time buy or sell order that executes gradually across a price range. Good for DCA.",
    },
    {
      name: "carbon_create_recurring_strategy",
      description: "Create a linked buy+sell strategy that repeats indefinitely. Buy low, sell high, zero gas on fills.",
    },
    {
      name: "carbon_create_concentrated_strategy",
      description: "Create a two-sided concentrated liquidity strategy with a defined spread. Earns fees on both sides.",
    },
    {
      name: "carbon_create_full_range_strategy",
      description: "Create a two-sided full range concentrated liquidity strategy covering the entire possible price range.",
    },
    {
      name: "carbon_reprice_strategy",
      description: "Adjust the price ranges of an existing strategy in a single transaction.",
    },
    {
      name: "carbon_edit_strategy",
      description: "Edit prices and budgets of an existing strategy together in one transaction.",
    },
    {
      name: "carbon_deposit_budget",
      description: "Add funds to an existing strategy.",
    },
    {
      name: "carbon_withdraw_budget",
      description: "Withdraw funds from an existing strategy without closing it.",
    },
    {
      name: "carbon_pause_strategy",
      description: "Pause an active strategy by zeroing prices. Funds remain in the strategy.",
    },
    {
      name: "carbon_resume_strategy",
      description: "Resume a paused strategy by restoring price ranges. Funds already in strategy are reactivated.",
    },
    {
      name: "carbon_delete_strategy",
      description: "Permanently close a strategy and return all funds to the wallet. Irreversible.",
    },
  ],
};

const httpServer = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } else if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", server: "Carbon DeFi MCP Server", version: "0.3.0", tools: 13 }));
  } else if (req.url === "/info") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(INFO, null, 2));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Carbon DeFi MCP Server v0.3.0 running on port ${PORT}`);
});
