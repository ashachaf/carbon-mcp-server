# Carbon DeFi — OpenAI / ChatGPT Integration

Instructions for integrating Carbon DeFi tools with ChatGPT or any OpenAI function calling compatible agent. For general agent behavior and trading rules, see `AGENTS.md`.

## Overview

Carbon DeFi tools are available as REST endpoints. Each tool maps to a `POST` endpoint. All endpoints return an unsigned transaction that the user must sign and broadcast.

## Base URL

```
https://carbon-mcp.duckdns.org
```

## Authentication

No authentication required. The server is publicly accessible.

## OpenAPI Spec

The full OpenAPI 3.0 spec is available at:

```
https://carbon-mcp.duckdns.org/openapi.json
```

## Endpoints (13 total)

| Endpoint | Description |
|---|---|
| `POST /tools/get_strategies` | Fetch all active strategies for a wallet |
| `POST /tools/create_limit_order` | One-time buy or sell at exact price |
| `POST /tools/create_range_order` | One-time buy or sell across a price range |
| `POST /tools/create_recurring_strategy` | Looping buy+sell strategy |
| `POST /tools/create_concentrated_strategy` | Two-sided liquidity with spread |
| `POST /tools/create_full_range_strategy` | Two-sided liquidity across widest possible range |
| `POST /tools/reprice_strategy` | Update price ranges |
| `POST /tools/edit_strategy` | Update prices and budgets together |
| `POST /tools/deposit_budget` | Add funds to a strategy |
| `POST /tools/withdraw_budget` | Remove funds from a strategy |
| `POST /tools/pause_strategy` | Pause a strategy, funds stay |
| `POST /tools/resume_strategy` | Restore prices to resume a paused strategy |
| `POST /tools/delete_strategy` | Permanently close a strategy |

## Function Calling Setup

Fetch the OpenAPI spec and register the tool definitions with your assistant:

```python
import requests
spec = requests.get("https://carbon-mcp.duckdns.org/openapi.json").json()
tools = spec["tools"]  # Pass these to your OpenAI assistant
```

## Request Format

All endpoints accept JSON bodies. Example:

```json
POST /tools/create_limit_order
{
  "wallet_address": "0x...",
  "chain": "ethereum",
  "base_token": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  "quote_token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "direction": "buy",
  "price": 2000,
  "budget": 1000,
  "market_price": 2050
}
```

## Response Format

All responses return:

```json
{
  "status": "ok",
  "warnings": [],
  "strategy_preview": { ... },
  "unsigned_transaction": {
    "to": "0x...",
    "data": "0x...",
    "value": "0"
  }
}
```

The user must sign and broadcast `unsigned_transaction` using their wallet.

## Important Notes

- Always call `get_strategies` before any write operation
- Never invent a market price — always ask the user
- Show the full unsigned transaction to the user before they sign
- If `warnings` contains an allowance warning, show approval steps first
- See `AGENTS.md` for full behavior rules
