---
name: carbon-defi
description: >
  Use this skill when the user wants to create or manage on-chain maker trading
  strategies on Carbon DeFi. Triggers include: "place a limit order", "create a
  recurring strategy", "buy ETH at a specific price", "set up a DCA strategy",
  "manage my Carbon strategies", "pause/resume/reprice a strategy", "deposit or
  withdraw from a strategy", "full range liquidity", or any mention of Carbon DeFi,
  maker orders, or on-chain trading strategies on Ethereum, Sei, Celo, or TAC.
---

# Carbon DeFi Agent Skill

Carbon DeFi is a fully on-chain maker trading protocol. Agents create price strategies upfront — they execute automatically on-chain with zero gas on fills. No agent needs to stay online after placing a strategy.

## Connection (Claude Desktop / MCP)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "carbon-defi": {
      "command": "npx",
      "args": ["mcp-remote", "https://carbon-mcp.duckdns.org/mcp"]
    }
  }
}
```

Restart Claude Desktop after updating the config.

## Core Concepts

**Maker-first.** Every strategy is a maker order — you set the price, the market comes to you. There are no taker swaps.

**Unsigned transactions.** All write operations return an unsigned transaction (`to`, `data`, `value`). The user must sign and broadcast it. Never assume a transaction has been submitted.

**Base and quote tokens.**
- `base_token` — the token being bought or sold (e.g. ETH)
- `quote_token` — the pricing token (e.g. USDC)
- All prices are expressed as: **quote per 1 base** (e.g. 2000 USDC per 1 ETH)

**Budgets.**
- `buy_budget` — always in quote token (e.g. USDC to spend buying ETH)
- `sell_budget` — always in base token (e.g. ETH available to sell)

**Native ETH.** Use address `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`. Never WETH. ETH never requires approval.

## Available Tools

| Tool | Description |
|---|---|
| `carbon_get_strategies` | Fetch all active strategies. Always call first. |
| `carbon_create_limit_order` | One-time buy or sell at exact price |
| `carbon_create_range_order` | One-time buy or sell across a price range. Good for DCA. |
| `carbon_create_recurring_strategy` | Looping buy+sell strategy, zero gas on fills |
| `carbon_create_concentrated_strategy` | Two-sided liquidity with a defined spread |
| `carbon_create_full_range_strategy` | Two-sided liquidity across the widest possible range (up to 1000x from market price). User provides budget for one anchor side, the other is auto-calculated. |
| `carbon_reprice_strategy` | Update price ranges of an existing strategy |
| `carbon_edit_strategy` | Update prices and budgets together in one transaction |
| `carbon_deposit_budget` | Add funds to an existing strategy |
| `carbon_withdraw_budget` | Remove funds without closing the strategy |
| `carbon_pause_strategy` | Pause a strategy — prices zeroed, funds stay |
| `carbon_resume_strategy` | Restore prices to reactivate a paused strategy |
| `carbon_delete_strategy` | Permanently close a strategy and return all funds |

## Choosing the Right Strategy

Use this guide to match user intent to the correct tool:

| User says | Correct tool |
|---|---|
| "buy at exactly X price" | `carbon_create_limit_order` (buy, single price) |
| "sell at exactly X price" | `carbon_create_limit_order` (sell, single price) |
| "scale in as price drops", "DCA into", "buy gradually between X and Y" | `carbon_create_range_order` (buy, price range) |
| "scale out as price rises", "sell gradually between X and Y" | `carbon_create_range_order` (sell, price range) |
| "buy low sell high forever", "recurring", "grid" | `carbon_create_recurring_strategy` |
| "provide liquidity", "earn fees", "concentrated liquidity" | `carbon_create_concentrated_strategy` |
| "full range liquidity", "widest range" | `carbon_create_full_range_strategy` |

A range order is a **single transaction** that executes gradually as price moves through the range — it is the correct tool for "scale in" or "DCA" requests. Do not ask how many orders to split across.

Ethereum, Sei, Celo, TAC

## Behavior Rules

1. Always call `carbon_get_strategies` first to check existing positions
2. Never invent a market price — always ask the user. Never reuse a market price from earlier in the conversation — prices change, always ask fresh before every operation that needs one.
3. Present a strategy proposal and wait for explicit user approval before building a transaction
4. Always show the full unsigned transaction (`to`, `data`, `value`) after creation
5. Check `warnings` array — if allowance warning exists, show approval steps BEFORE transaction
6. When market price is inside a buy range, ask: full range or below market only?
   - Full range: omit `buy_price_marginal`
   - Below market only: set `buy_price_marginal` to current market price
7. When sell budget is 0 on recurring strategy: inform user sell capacity is pre-calculated, do not ask for it
8. Overlapping buy/sell ranges: warn but allow — ask user to confirm intent
9. Buy price above market: warn and offer to adjust
10. Sell price below market: warn and offer to adjust
11. For pause: show current prices first, ask if user wants to pause, withdraw, or delete
12. For resume: restore prices only — funds already in strategy, never ask for budgets
13. For reprice: always call once with all four prices — fill missing side from current strategy state
14. For delete: always confirm with user — irreversible

## Full Range Strategy

The full range strategy automatically sets the widest possible price range:

```
factor = min(market_price / protocol_min, protocol_max / market_price, 1000)
price_low  = market_price / factor
price_high = market_price * factor
```

The range is symmetric around market price, capped at 1000x. User provides a budget for one anchor side:
- `anchor = buy` — user provides quote token budget (e.g. USDC), sell side auto-calculated
- `anchor = sell` — user provides base token budget (e.g. ETH), buy side auto-calculated

## Management Tool Rules

- Always call management tools directly — never assume current strategy state from prior context
- For `carbon_pause_strategy`: before calling, show current prices and ask if user wants to pause, withdraw, or delete
- For `carbon_resume_strategy`: restore prices only — funds already in strategy, do not ask for budgets
- For `carbon_reprice_strategy`: always call once with all four prices — fill missing side from current state
- For `carbon_delete_strategy`: always confirm with user before calling — irreversible

## Token Allowances

Before any strategy that deposits ERC-20 tokens, check if the Carbon DeFi controller has sufficient allowance. If not, the user must send an approval transaction first.

Note: USDT on Ethereum requires setting allowance to 0 before increasing.
