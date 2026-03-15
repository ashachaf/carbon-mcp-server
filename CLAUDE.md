# Carbon DeFi — Claude Integration

Claude-specific instructions for connecting to the Carbon DeFi MCP server. For general agent behavior and trading rules, see `AGENTS.md`.

## Connection

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

## MCP Tools (13 total)

| Tool | Description |
|---|---|
| `carbon_get_strategies` | Fetch all active strategies. Always call first. |
| `carbon_create_limit_order` | One-time buy or sell at exact price |
| `carbon_create_range_order` | One-time buy or sell across a price range. Good for DCA. |
| `carbon_create_recurring_strategy` | Looping buy+sell strategy, zero gas on fills |
| `carbon_create_concentrated_strategy` | Two-sided liquidity with a defined spread |
| `carbon_create_full_range_strategy` | Two-sided liquidity across the widest possible range (up to 1000x from market price) |
| `carbon_reprice_strategy` | Update price ranges of an existing strategy |
| `carbon_edit_strategy` | Update prices and budgets together in one transaction |
| `carbon_deposit_budget` | Add funds to an existing strategy |
| `carbon_withdraw_budget` | Remove funds without closing the strategy |
| `carbon_pause_strategy` | Pause a strategy — prices zeroed, funds stay |
| `carbon_resume_strategy` | Restore prices to reactivate a paused strategy |
| `carbon_delete_strategy` | Permanently close a strategy and return all funds |

## Agent Skill Resource

The MCP server exposes a skill resource at `carbon://skill` containing full agent instructions. Claude reads this automatically when the server is connected.

## Server Endpoints

| Endpoint | Description |
|---|---|
| `https://carbon-mcp.duckdns.org/mcp` | MCP Streamable HTTP transport |
| `https://carbon-mcp.duckdns.org/health` | Health check |
| `https://carbon-mcp.duckdns.org/info` | Server metadata and full tool list |
