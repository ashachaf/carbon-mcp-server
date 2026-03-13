# Carbon DeFi MCP Server

An MCP server that lets AI agents create and manage on-chain maker trading strategies on [Carbon DeFi](https://carbon.defi.org). The server translates agent intent into unsigned transactions — the user signs and broadcasts.

**Maker-first.** Agents set prices upfront. Strategies execute on-chain automatically with zero gas on fills. No agent needs to stay online.

---

## Quick Start

Add to your `claude_desktop_config.json`:

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

Config file location on Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`

---

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/mcp` | POST | MCP Streamable HTTP transport |
| `/health` | GET | Server health check |
| `/info` | GET | Server metadata, tool list, and connection config |

---

## Supported Chains

| Chain | Status |
|---|---|
| Ethereum | ✅ |
| Sei | ✅ |
| Celo | ✅ |
| TAC | ✅ |

---

## Tools

### Read

| Tool | Description |
|---|---|
| `carbon_get_strategies` | Fetch all active maker strategies for a wallet. Always call first. |

### Create

| Tool | Description |
|---|---|
| `carbon_create_limit_order` | One-time buy or sell at a single exact price. |
| `carbon_create_range_order` | One-time buy or sell that executes gradually across a price range. Good for DCA. |
| `carbon_create_recurring_strategy` | Linked buy+sell strategy that repeats indefinitely. Buy low, sell high, zero gas on fills. |
| `carbon_create_concentrated_strategy` | Two-sided concentrated liquidity with a defined spread. Earns fees on both sides. |

### Manage

| Tool | Description |
|---|---|
| `carbon_reprice_strategy` | Adjust price ranges of an existing strategy in a single transaction. |
| `carbon_edit_strategy` | Edit prices and budgets together in one transaction. |
| `carbon_deposit_budget` | Add funds to an existing strategy. |
| `carbon_withdraw_budget` | Withdraw funds without closing the strategy. |
| `carbon_pause_strategy` | Pause an active strategy. Funds remain in the strategy. |
| `carbon_resume_strategy` | Resume a paused strategy by restoring price ranges. |
| `carbon_delete_strategy` | Permanently close a strategy and return all funds. Irreversible. |

---

## How It Works

1. Agent calls a create or management tool
2. Server validates inputs, checks token allowances, and builds the transaction
3. Server returns an **unsigned transaction** (`to`, `data`, `value`)
4. User reviews and signs in their wallet
5. Strategy executes on-chain — no agent needs to stay online

### Price Convention

All prices are expressed as **quote token per 1 base token**.

- `base_token` — the token being bought or sold (e.g. ETH)
- `quote_token` — the pricing token (e.g. USDC)
- A price of `2000` means 2000 USDC per 1 ETH

### Budget Convention

- `buy_budget` — always in **quote token** (e.g. USDC to spend buying ETH)
- `sell_budget` — always in **base token** (e.g. ETH to sell)

### Native ETH

Use `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` for native ETH — never WETH. ETH never requires an approval.

---

## Contract Addresses

| Chain | CarbonController | Voucher |
|---|---|---|
| Ethereum | `0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1` | `0x3660F04B79751e31128f6378eAC70807e38f554E` |
| Sei | `0xe4816658ad10bF215053C533cceAe3f59e1f1087` | `0xA4682A2A5Fe02feFF8Bd200240A41AD0E6EaF8d5` |
| Celo | `0x6619871118D144c1c28eC3b23036FC1f0829ed3a` | `0x5E994Ac7d65d81f51a76e0bB5a236C6fDA8dBF9A` |
| TAC | `0xA4682A2A5Fe02feFF8Bd200240A41AD0E6EaF8d5` | `0xb0d39990E1C38B50D0b7f6911525535Fbacb4C26` |

---

## Self-Hosting

### Requirements

- Node.js v20+
- An EVM RPC URL for each chain you want to support (e.g. from [Alchemy](https://www.alchemy.com), [Infura](https://infura.io), or [Tenderly](https://tenderly.co))

### Setup

```bash
git clone https://github.com/ashachaf/carbon-mcp-server.git
cd carbon-mcp-server
npm install
```

Create a `.env` file — **never commit this file**:

```
PORT=3000
RPC_URL_ETHEREUM=
CHAIN_ID_ETHEREUM=1
RPC_URL_SEI=
RPC_URL_CELO=
RPC_URL_TAC=
```

Run the server:

```bash
npx ts-node src/index.ts
```

Or with PM2 for production:

```bash
pm2 start src/index.ts --name carbon-mcp-server --interpreter ts-node
```

Update your Claude Desktop config to point to your local server:

```json
{
  "mcpServers": {
    "carbon-defi": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp"]
    }
  }
}
```

---

## Stack

- Node.js v20, TypeScript, ts-node
- [@bancor/carbon-sdk](https://github.com/bancorprotocol/carbon-sdk)
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- PM2, Nginx, Let's Encrypt SSL
