# Carbon DeFi — Agent Instructions

Carbon DeFi is a fully on-chain maker trading protocol. Agents create price strategies upfront — they execute automatically on-chain with zero gas on fills. No agent needs to stay online after placing a strategy.

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

## Supported Chains

- Ethereum
- Sei
- Celo
- TAC

## Strategy Types

| Type | Description |
|---|---|
| Limit order | One-time execution at a single exact price |
| Range order | One-time execution gradually across a price range. Good for DCA. |
| Recurring strategy | Linked buy+sell that loops indefinitely. Buy low, sell high, zero gas on fills. |
| Concentrated strategy | Two-sided liquidity with a defined spread. Earns fees on both sides. |
| Full range strategy | Two-sided liquidity across the widest possible range (up to 1000x from market price). |

## Available Operations

| Operation | Description |
|---|---|
| Get strategies | Fetch all active strategies for a wallet |
| Create limit order | Place a one-time buy or sell at exact price |
| Create range order | Place a one-time buy or sell across a price range |
| Create recurring strategy | Create a looping buy+sell strategy |
| Create concentrated strategy | Create two-sided liquidity with a defined spread |
| Create full range strategy | Create two-sided liquidity across the widest possible price range |
| Reprice strategy | Update price ranges of an existing strategy |
| Edit strategy | Update prices and budgets together |
| Deposit budget | Add funds to an existing strategy |
| Withdraw budget | Remove funds without closing the strategy |
| Pause strategy | Zero out prices, funds stay in strategy |
| Resume strategy | Restore prices to reactivate a paused strategy |
| Delete strategy | Permanently close and return all funds |

## Behavior Rules

1. Always fetch current strategies before creating or modifying anything
2. Never invent a market price — always ask the user. Never reuse a market price from earlier in the conversation — prices change, always ask fresh before every operation that needs one.
3. Present a strategy proposal and wait for explicit user approval before building a transaction
4. Always show the full unsigned transaction (`to`, `data`, `value`) after creation
5. Check for warnings — if token allowance is insufficient, show approval steps BEFORE the transaction
6. When market price is inside a buy range, ask: full range or below market only?
   - Full range: no marginal price needed
   - Below market only: set buy marginal price to current market price
7. When sell budget is 0 on recurring strategy: inform user sell capacity is pre-calculated, do not ask for it
8. Overlapping buy/sell ranges: warn but allow — ask user to confirm intent
9. Buy price above market: warn and offer to adjust
10. Sell price below market: warn and offer to adjust
11. For pause: show current prices first, ask if user wants to pause, withdraw, or delete
12. For resume: restore prices only — funds already in strategy, never ask for budgets
13. For reprice: always call once with all four prices — fill missing side from current state
14. For delete: always confirm with user — irreversible

## Full Range Strategy

Price range is auto-calculated from market price using a symmetric factor capped at 1000x:

```
factor = min(market_price / protocol_min, protocol_max / market_price, 1000)
price_low  = market_price / factor
price_high = market_price * factor
```

User provides a budget for one anchor side:
- `anchor = buy` — user provides quote token budget, sell side is auto-calculated
- `anchor = sell` — user provides base token budget, buy side is auto-calculated

## Token Allowances

Before any strategy that deposits ERC-20 tokens, check if the Carbon DeFi controller has sufficient allowance. If not, the user must send an approval transaction first.

Note: USDT on Ethereum requires setting allowance to 0 before increasing.

## Integration

Install via Skills CLI (any agent):

```bash
npx skills add ashachaf/carbon-mcp-server
```

See `CLAUDE.md` for Claude / MCP setup.
See `OPENAI.md` for ChatGPT / OpenAI function calling setup.
