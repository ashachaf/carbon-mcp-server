import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import * as http from "http";
import * as dotenv from "dotenv";
import { HANDLERS } from "./handlers";
import { createMcpServer } from "./mcp";
import { OPENAPI_SPEC } from "./openapi";

dotenv.config();

const PORT = parseInt(process.env.PORT || "3000");
const VERSION = "0.3.0";
const TOOL_COUNT = Object.keys(HANDLERS).length;

// ─── Info Endpoint ────────────────────────────────────────────────────────────

const INFO = {
  name: "Carbon DeFi MCP Server",
  version: VERSION,
  description: "MCP server for creating and managing on-chain maker trading strategies on Carbon DeFi. Returns unsigned transactions - the user signs and broadcasts. Zero gas on fills. Maker-first.",
  mcp_endpoint: "https://carbon-mcp.duckdns.org/mcp",
  rest_endpoint: "https://carbon-mcp.duckdns.org/tools",
  openapi: "https://carbon-mcp.duckdns.org/openapi.json",
  supported_chains: ["ethereum", "sei", "celo", "tac"],
  claude_desktop_config: {
    mcpServers: { "carbon-defi": { command: "npx", args: ["mcp-remote", "https://carbon-mcp.duckdns.org/mcp"] } },
  },
  tools: Object.entries(OPENAPI_SPEC.paths).map(([path, spec]: [string, any]) => ({
    name: `carbon_${path.replace("/tools/", "")}`,
    rest_endpoint: path,
    summary: spec.post?.summary || "",
  })),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, data: object) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const httpServer = http.createServer(async (req, res) => {

  // MCP endpoint
  if (req.method === "POST" && req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  // REST tool endpoints: POST /tools/:toolName
  const toolMatch = req.url?.match(/^\/tools\/([a-z_]+)$/);
  if (req.method === "POST" && toolMatch) {
    const toolName = toolMatch[1];
    const handler = HANDLERS[toolName];
    if (!handler) {
      json(res, 404, { error: `Unknown tool: ${toolName}. See /openapi.json for available tools.` });
      return;
    }
    try {
      const params = await readBody(req);
      const result = await handler(params);
      json(res, 200, result);
    } catch (e: any) {
      json(res, 400, { error: e.message });
    }
    return;
  }

  // Info / health / openapi
  if (req.url === "/health") {
    json(res, 200, { status: "ok", server: "Carbon DeFi MCP Server", version: VERSION, tools: TOOL_COUNT });
    return;
  }
  if (req.url === "/info") {
    json(res, 200, INFO);
    return;
  }
  if (req.url === "/openapi.json") {
    json(res, 200, OPENAPI_SPEC);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Carbon DeFi MCP Server v${VERSION} running on port ${PORT}`);
  console.log(`  MCP:  http://localhost:${PORT}/mcp`);
  console.log(`  REST: http://localhost:${PORT}/tools/:toolName`);
  console.log(`  Docs: http://localhost:${PORT}/openapi.json`);
});
