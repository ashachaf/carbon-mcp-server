import {
  calculateOverlappingPrices,
  calculateOverlappingBuyBudget,
  calculateOverlappingSellBudget,
  getMinMaxPricesByDecimals,
  MarginalPriceOptions,
} from "@bancor/carbon-sdk/strategy-management";
import {
  CHAIN_CONFIG, CHAIN_ENUM, getSDK, checkAllowance, getTokenDecimals, formatTx, ETH_ADDRESS,
} from "./config";

export type Chain = typeof CHAIN_ENUM[number];

// ─── Get Strategies ──────────────────────────────────────────────────────────

export async function handleGetStrategies(params: {
  wallet_address: string;
  chain: string;
}) {
  const sdk = await getSDK(params.chain);
  const strategies = await sdk.getUserStrategies(params.wallet_address);
  return {
    status: "ok",
    wallet_address: params.wallet_address,
    chain: params.chain,
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
  };
}

// ─── Create Limit Order ──────────────────────────────────────────────────────

export async function handleCreateLimitOrder(params: {
  wallet_address: string; chain: string; base_token: string; quote_token: string;
  direction: "buy" | "sell"; price: number; budget: number; market_price?: number;
}) {
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
  const sdk = await getSDK(params.chain);
  const isBuy = params.direction === "buy";
  const p = params.price.toString();
  const b = params.budget.toString();
  const tx = await sdk.createBuySellStrategy(
    params.base_token, params.quote_token,
    isBuy ? p : "0", isBuy ? p : "0", isBuy ? p : "0", isBuy ? b : "0",
    isBuy ? "0" : p,  isBuy ? "0" : p,  isBuy ? "0" : p,  isBuy ? "0" : b
  );
  return {
    status: "ok", warnings,
    strategy_preview: { type: "limit_order", direction: params.direction, price: params.price, budget: params.budget, chain: params.chain },
    unsigned_transaction: formatTx(tx),
  };
}

// ─── Create Range Order ──────────────────────────────────────────────────────

export async function handleCreateRangeOrder(params: {
  wallet_address: string; chain: string; base_token: string; quote_token: string;
  direction: "buy" | "sell"; price_low: number; price_high: number; budget: number; market_price?: number;
}) {
  if (params.price_low >= params.price_high) throw new Error("price_low must be less than price_high");
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
  const sdk = await getSDK(params.chain);
  const isBuy = params.direction === "buy";
  const lo = params.price_low.toString(), hi = params.price_high.toString(), b = params.budget.toString();
  const tx = await sdk.createBuySellStrategy(
    params.base_token, params.quote_token,
    isBuy ? lo : "0", isBuy ? hi : "0", isBuy ? hi : "0", isBuy ? b : "0",
    isBuy ? "0" : lo, isBuy ? "0" : lo, isBuy ? "0" : hi, isBuy ? "0" : b
  );
  return {
    status: "ok", warnings,
    strategy_preview: { type: "range_order", direction: params.direction, price_low: params.price_low, price_high: params.price_high, budget: params.budget, chain: params.chain },
    unsigned_transaction: formatTx(tx),
  };
}

// ─── Create Recurring Strategy ───────────────────────────────────────────────

export async function handleCreateRecurringStrategy(params: {
  wallet_address: string; chain: string; base_token: string; quote_token: string;
  buy_price_low: number; buy_price_high: number; buy_price_marginal?: number; buy_budget: number;
  sell_price_low: number; sell_price_high: number; sell_budget: number; market_price?: number;
}) {
  if (params.buy_price_low > params.buy_price_high) throw new Error("buy_price_low must be less than buy_price_high");
  if (params.sell_price_low > params.sell_price_high) throw new Error("sell_price_low must be less than sell_price_high");
  if (params.buy_budget === 0 && params.sell_budget === 0) throw new Error("Both budgets are zero.");
  const warnings: string[] = [];
  if (params.buy_price_high > params.sell_price_low)
    warnings.push("Buy and sell ranges overlap - both orders active simultaneously. Risk of circular execution. Confirm this is intentional.");
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
  return {
    status: "ok", warnings,
    strategy_preview: {
      type: "recurring", chain: params.chain, base_token: params.base_token, quote_token: params.quote_token,
      buy_order: { price_low: params.buy_price_low, price_high: params.buy_price_high, budget: params.buy_budget },
      sell_order: { price_low: params.sell_price_low, price_high: params.sell_price_high, budget: params.sell_budget },
    },
    unsigned_transaction: formatTx(tx),
  };
}

// ─── Create Concentrated Strategy ────────────────────────────────────────────

export async function handleCreateConcentratedStrategy(params: {
  wallet_address: string; chain: string; base_token: string; quote_token: string;
  price_low: number; price_high: number; spread_percentage: number;
  anchor: "buy" | "sell"; budget: number; market_price: number;
}) {
  if (params.price_low >= params.price_high) throw new Error("price_low must be less than price_high");
  if (params.market_price < params.price_low || params.market_price > params.price_high)
    throw new Error(`Market price (${params.market_price}) must be within range [${params.price_low}, ${params.price_high}].`);
  const warnings: string[] = [];
  const checkToken = params.anchor === "buy" ? params.quote_token : params.base_token;
  const aw = await checkAllowance(params.chain, checkToken, params.wallet_address, params.budget);
  if (aw) warnings.push(aw);
  const sdk = await getSDK(params.chain);
  const baseDecimals = await getTokenDecimals(params.chain, params.base_token);
  const quoteDecimals = await getTokenDecimals(params.chain, params.quote_token);
  const min = params.price_low.toString(), max = params.price_high.toString();
  const market = params.market_price.toString(), spread = params.spread_percentage.toString();
  let buyBudget: string, sellBudget: string;
  if (params.anchor === "buy") {
    buyBudget = params.budget.toString();
    sellBudget = calculateOverlappingSellBudget(baseDecimals, quoteDecimals, min, max, market, spread, buyBudget);
  } else {
    sellBudget = params.budget.toString();
    buyBudget = calculateOverlappingBuyBudget(baseDecimals, quoteDecimals, min, max, market, spread, sellBudget);
  }
  const prices = calculateOverlappingPrices(min, max, market, spread);
  const tx = await sdk.createBuySellStrategy(
    params.base_token, params.quote_token,
    prices.buyPriceLow, prices.buyPriceMarginal, prices.buyPriceHigh, buyBudget,
    prices.sellPriceLow, prices.sellPriceMarginal, prices.sellPriceHigh, sellBudget
  );
  return {
    status: "ok", warnings,
    strategy_preview: { type: "concentrated", chain: params.chain, price_low: params.price_low, price_high: params.price_high, spread_percentage: params.spread_percentage, anchor: params.anchor, buy_budget: buyBudget, sell_budget: sellBudget, market_price: params.market_price },
    unsigned_transaction: formatTx(tx),
  };
}

// ─── Create Full Range Strategy ───────────────────────────────────────────────

export async function handleCreateFullRangeStrategy(params: {
  wallet_address: string; chain: string; base_token: string; quote_token: string;
  spread_percentage: number; anchor: "buy" | "sell"; budget: number; market_price: number;
}) {
  const warnings: string[] = [];
  const checkToken = params.anchor === "buy" ? params.quote_token : params.base_token;
  const aw = await checkAllowance(params.chain, checkToken, params.wallet_address, params.budget);
  if (aw) warnings.push(aw);
  const sdk = await getSDK(params.chain);
  const baseDecimals = await getTokenDecimals(params.chain, params.base_token);
  const quoteDecimals = await getTokenDecimals(params.chain, params.quote_token);
  const { minBuyPrice, maxSellPrice } = getMinMaxPricesByDecimals(baseDecimals, quoteDecimals);
  const price = params.market_price;
  const factor = Math.min(price / parseFloat(minBuyPrice), parseFloat(maxSellPrice) / price, 1000);
  const min = (price / factor).toString(), max = (price * factor).toString();
  const market = params.market_price.toString(), spread = params.spread_percentage.toString();
  const prices = calculateOverlappingPrices(min, max, market, spread);
  let buyBudget: string, sellBudget: string;
  if (params.anchor === "buy") {
    buyBudget = params.budget.toString();
    sellBudget = calculateOverlappingSellBudget(baseDecimals, quoteDecimals, min, max, market, spread, buyBudget);
  } else {
    sellBudget = params.budget.toString();
    buyBudget = calculateOverlappingBuyBudget(baseDecimals, quoteDecimals, min, max, market, spread, sellBudget);
  }
  const tx = await sdk.createBuySellStrategy(
    params.base_token, params.quote_token,
    prices.buyPriceLow, prices.buyPriceMarginal, prices.buyPriceHigh, buyBudget,
    prices.sellPriceLow, prices.sellPriceMarginal, prices.sellPriceHigh, sellBudget
  );
  return {
    status: "ok", warnings,
    strategy_preview: { type: "full_range", chain: params.chain, price_low: min, price_high: max, factor: factor.toFixed(2), spread_percentage: params.spread_percentage, buy_budget: buyBudget, sell_budget: sellBudget, market_price: params.market_price },
    unsigned_transaction: formatTx(tx),
  };
}

// ─── Reprice Strategy ─────────────────────────────────────────────────────────

export async function handleRepriceStrategy(params: {
  wallet_address: string; chain: string; strategy_id: string;
  buy_price_low?: number; buy_price_high?: number; sell_price_low?: number; sell_price_high?: number;
}) {
  const sdk = await getSDK(params.chain);
  const strategy = await sdk.getStrategyById(params.strategy_id);
  const noChange =
    (params.buy_price_low === undefined   || params.buy_price_low   === parseFloat(strategy.buyPriceLow  || "0")) &&
    (params.buy_price_high === undefined  || params.buy_price_high  === parseFloat(strategy.buyPriceHigh || "0")) &&
    (params.sell_price_low === undefined  || params.sell_price_low  === parseFloat(strategy.sellPriceLow || "0")) &&
    (params.sell_price_high === undefined || params.sell_price_high === parseFloat(strategy.sellPriceHigh|| "0"));
  if (noChange) return {
    status: "no_change",
    message: "The new prices are identical to the current strategy prices. No transaction needed.",
    current: { buyPriceLow: strategy.buyPriceLow, buyPriceHigh: strategy.buyPriceHigh, sellPriceLow: strategy.sellPriceLow, sellPriceHigh: strategy.sellPriceHigh },
  };
  const tx = await sdk.updateStrategy(params.strategy_id, strategy.encoded, {
    buyPriceLow: params.buy_price_low?.toString(), buyPriceHigh: params.buy_price_high?.toString(),
    sellPriceLow: params.sell_price_low?.toString(), sellPriceHigh: params.sell_price_high?.toString(),
  }, MarginalPriceOptions.maintain, MarginalPriceOptions.maintain);
  return { status: "ok", message: "Strategy repriced. Sign and submit to apply.", unsigned_transaction: formatTx(tx) };
}

// ─── Edit Strategy ────────────────────────────────────────────────────────────

export async function handleEditStrategy(params: {
  wallet_address: string; chain: string; strategy_id: string;
  buy_price_low?: number; buy_price_high?: number; buy_budget?: number;
  sell_price_low?: number; sell_price_high?: number; sell_budget?: number; market_price?: number;
}) {
  const warnings: string[] = [];
  if (params.market_price) {
    if (params.buy_price_high && params.buy_price_high > params.market_price)
      warnings.push(`Buy range top (${params.buy_price_high}) is above market (${params.market_price}).`);
    if (params.sell_price_low && params.sell_price_low < params.market_price)
      warnings.push(`Sell range bottom (${params.sell_price_low}) is below market (${params.market_price}).`);
  }
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
  const tx = await sdk.updateStrategy(params.strategy_id, strategy.encoded, {
    buyPriceLow: params.buy_price_low?.toString(), buyPriceHigh: params.buy_price_high?.toString(),
    buyBudget: params.buy_budget?.toString(), sellPriceLow: params.sell_price_low?.toString(),
    sellPriceHigh: params.sell_price_high?.toString(), sellBudget: params.sell_budget?.toString(),
  }, MarginalPriceOptions.reset, MarginalPriceOptions.reset);
  return { status: "ok", warnings, message: "Strategy edit ready. Sign and submit to apply.", unsigned_transaction: formatTx(tx) };
}

// ─── Deposit Budget ───────────────────────────────────────────────────────────

export async function handleDepositBudget(params: {
  wallet_address: string; chain: string; strategy_id: string;
  buy_budget_increase?: number; sell_budget_increase?: number;
  anchor?: "buy" | "sell"; budget_increase?: number; market_price?: number; spread_percentage?: number;
}) {
  const isOverlapping = params.anchor && params.budget_increase !== undefined && params.market_price && params.spread_percentage !== undefined;
  if (!isOverlapping && !params.buy_budget_increase && !params.sell_budget_increase)
    throw new Error("Provide buy_budget_increase or sell_budget_increase, or use anchor+budget_increase+market_price+spread_percentage for concentrated strategies");
  const sdk = await getSDK(params.chain);
  const strategy = await sdk.getStrategyById(params.strategy_id);
  const currentBuy = parseFloat(strategy.buyBudget || "0");
  const currentSell = parseFloat(strategy.sellBudget || "0");
  const warnings: string[] = [];
  let newBuyBudget: string | undefined, newSellBudget: string | undefined;
  if (isOverlapping) {
    const baseDecimals = await getTokenDecimals(params.chain, strategy.baseToken);
    const quoteDecimals = await getTokenDecimals(params.chain, strategy.quoteToken);
    const min = strategy.buyPriceLow, max = strategy.sellPriceHigh;
    const market = params.market_price!.toString(), spread = params.spread_percentage!.toString();
    if (params.anchor === "buy") {
      newBuyBudget = (currentBuy + params.budget_increase!).toString();
      newSellBudget = calculateOverlappingSellBudget(baseDecimals, quoteDecimals, min, max, market, spread, newBuyBudget);
      const aw = await checkAllowance(params.chain, strategy.quoteToken, params.wallet_address, params.budget_increase!);
      if (aw) warnings.push(aw);
    } else {
      newSellBudget = (currentSell + params.budget_increase!).toString();
      newBuyBudget = calculateOverlappingBuyBudget(baseDecimals, quoteDecimals, min, max, market, spread, newSellBudget);
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
  const tx = await sdk.updateStrategy(params.strategy_id, strategy.encoded,
    { buyBudget: newBuyBudget, sellBudget: newSellBudget },
    MarginalPriceOptions.maintain, MarginalPriceOptions.maintain);
  return { status: "ok", warnings, message: "Deposit ready. Sign and submit to add funds.", unsigned_transaction: formatTx(tx) };
}

// ─── Withdraw Budget ──────────────────────────────────────────────────────────

export async function handleWithdrawBudget(params: {
  wallet_address: string; chain: string; strategy_id: string;
  buy_budget_decrease?: number; sell_budget_decrease?: number;
  anchor?: "buy" | "sell"; budget_decrease?: number; market_price?: number; spread_percentage?: number;
}) {
  const isOverlapping = params.anchor && params.budget_decrease !== undefined && params.market_price && params.spread_percentage !== undefined;
  if (!isOverlapping && !params.buy_budget_decrease && !params.sell_budget_decrease)
    throw new Error("Provide buy_budget_decrease or sell_budget_decrease, or use anchor+budget_decrease+market_price+spread_percentage for concentrated strategies");
  const sdk = await getSDK(params.chain);
  const strategy = await sdk.getStrategyById(params.strategy_id);
  const currentBuy = parseFloat(strategy.buyBudget || "0");
  const currentSell = parseFloat(strategy.sellBudget || "0");
  let newBuyBudget: string | undefined, newSellBudget: string | undefined;
  if (isOverlapping) {
    const baseDecimals = await getTokenDecimals(params.chain, strategy.baseToken);
    const quoteDecimals = await getTokenDecimals(params.chain, strategy.quoteToken);
    const min = strategy.buyPriceLow, max = strategy.sellPriceHigh;
    const market = params.market_price!.toString(), spread = params.spread_percentage!.toString();
    if (params.anchor === "buy") {
      const anchorBudget = currentBuy - params.budget_decrease!;
      if (anchorBudget < 0) throw new Error(`Cannot withdraw ${params.budget_decrease} - current buy budget is only ${currentBuy}`);
      newBuyBudget = anchorBudget.toString();
      newSellBudget = calculateOverlappingSellBudget(baseDecimals, quoteDecimals, min, max, market, spread, newBuyBudget);
    } else {
      const anchorBudget = currentSell - params.budget_decrease!;
      if (anchorBudget < 0) throw new Error(`Cannot withdraw ${params.budget_decrease} - current sell budget is only ${currentSell}`);
      newSellBudget = anchorBudget.toString();
      newBuyBudget = calculateOverlappingBuyBudget(baseDecimals, quoteDecimals, min, max, market, spread, newSellBudget);
    }
  } else {
    if (params.buy_budget_decrease) {
      if (params.buy_budget_decrease > currentBuy) throw new Error(`Cannot withdraw ${params.buy_budget_decrease} - current buy budget is only ${currentBuy}`);
      newBuyBudget = (currentBuy - params.buy_budget_decrease).toString();
    }
    if (params.sell_budget_decrease) {
      if (params.sell_budget_decrease > currentSell) throw new Error(`Cannot withdraw ${params.sell_budget_decrease} - current sell budget is only ${currentSell}`);
      newSellBudget = (currentSell - params.sell_budget_decrease).toString();
    }
  }
  const tx = await sdk.updateStrategy(params.strategy_id, strategy.encoded,
    { buyBudget: newBuyBudget, sellBudget: newSellBudget },
    MarginalPriceOptions.maintain, MarginalPriceOptions.maintain);
  return { status: "ok", message: "Withdrawal ready. Sign and submit to remove funds.", unsigned_transaction: formatTx(tx) };
}

// ─── Pause Strategy ───────────────────────────────────────────────────────────

export async function handlePauseStrategy(params: {
  wallet_address: string; chain: string; strategy_id: string;
}) {
  const sdk = await getSDK(params.chain);
  const strategy = await sdk.getStrategyById(params.strategy_id);
  const alreadyPaused = parseFloat(strategy.buyPriceHigh || "0") === 0 && parseFloat(strategy.sellPriceHigh || "0") === 0;
  if (alreadyPaused) return {
    status: "already_paused",
    message: "This strategy is already paused - both order prices are zero. No transaction needed.",
    options: "You can resume with carbon_resume_strategy, withdraw funds with carbon_withdraw_budget, or close entirely with carbon_delete_strategy.",
  };
  const tx = await sdk.updateStrategy(params.strategy_id, strategy.encoded,
    { buyPriceLow: "0", buyPriceHigh: "0", sellPriceLow: "0", sellPriceHigh: "0" },
    MarginalPriceOptions.reset, MarginalPriceOptions.reset);
  return {
    status: "ok",
    message: "Strategy will be paused. Funds remain in strategy, orders become inactive. Sign and submit to confirm.",
    prices_to_save: { buyPriceLow: strategy.buyPriceLow, buyPriceHigh: strategy.buyPriceHigh, sellPriceLow: strategy.sellPriceLow, sellPriceHigh: strategy.sellPriceHigh },
    unsigned_transaction: formatTx(tx),
  };
}

// ─── Resume Strategy ──────────────────────────────────────────────────────────

export async function handleResumeStrategy(params: {
  wallet_address: string; chain: string; strategy_id: string;
  buy_price_low?: number; buy_price_high?: number; sell_price_low?: number; sell_price_high?: number;
  market_price: number;
}) {
  const sdk = await getSDK(params.chain);
  const strategy = await sdk.getStrategyById(params.strategy_id);
  const isPaused = parseFloat(strategy.buyPriceHigh || "0") === 0 && parseFloat(strategy.sellPriceHigh || "0") === 0;
  if (!isPaused) return {
    status: "no_change",
    message: "Strategy is already active - no transaction needed.",
    current: { buyPriceLow: strategy.buyPriceLow, buyPriceHigh: strategy.buyPriceHigh, sellPriceLow: strategy.sellPriceLow, sellPriceHigh: strategy.sellPriceHigh },
  };
  const warnings: string[] = [];
  if (params.buy_price_high && params.buy_price_high > params.market_price)
    warnings.push(`Buy range top (${params.buy_price_high}) is above market (${params.market_price}) - buy order will execute immediately on resume.`);
  if (params.sell_price_low && params.sell_price_low < params.market_price)
    warnings.push(`Sell range bottom (${params.sell_price_low}) is below market (${params.market_price}) - sell order will execute immediately on resume.`);
  const tx = await sdk.updateStrategy(params.strategy_id, strategy.encoded, {
    buyPriceLow: params.buy_price_low?.toString(), buyPriceHigh: params.buy_price_high?.toString(),
    sellPriceLow: params.sell_price_low?.toString(), sellPriceHigh: params.sell_price_high?.toString(),
  }, MarginalPriceOptions.reset, MarginalPriceOptions.reset);
  return { status: "ok", warnings, message: "Strategy resume ready. Funds already in strategy will be reactivated at the new prices. Sign and submit to confirm.", unsigned_transaction: formatTx(tx) };
}

// ─── Delete Strategy ──────────────────────────────────────────────────────────

export async function handleDeleteStrategy(params: {
  wallet_address: string; chain: string; strategy_id: string;
}) {
  const sdk = await getSDK(params.chain);
  const tx = await sdk.deleteStrategy(params.strategy_id);
  return {
    status: "ok",
    warning: "IRREVERSIBLE. This will permanently close the strategy and return all funds to the wallet.",
    strategy_id: params.strategy_id, chain: params.chain, wallet_address: params.wallet_address,
    unsigned_transaction: formatTx(tx),
  };
}

// ─── Handler Map (for REST router) ───────────────────────────────────────────

export const HANDLERS: Record<string, (params: any) => Promise<object>> = {
  get_strategies:               handleGetStrategies,
  create_limit_order:           handleCreateLimitOrder,
  create_range_order:           handleCreateRangeOrder,
  create_recurring_strategy:    handleCreateRecurringStrategy,
  create_concentrated_strategy: handleCreateConcentratedStrategy,
  create_full_range_strategy:   handleCreateFullRangeStrategy,
  reprice_strategy:             handleRepriceStrategy,
  edit_strategy:                handleEditStrategy,
  deposit_budget:               handleDepositBudget,
  withdraw_budget:              handleWithdrawBudget,
  pause_strategy:               handlePauseStrategy,
  resume_strategy:              handleResumeStrategy,
  delete_strategy:              handleDeleteStrategy,
};
