/**
 * Agent evals — strategy selection and behavior
 * These call the Anthropic API with the SKILL.md loaded and assert
 * that the agent picks the correct tool and params for each prompt.
 *
 * Requires: ANTHROPIC_API_KEY in .env
 */

import * as fs from "fs";
import * as path from "path";
import { EvalSuite, assert, assertEq } from "../utils";

const SKILL = fs.readFileSync(path.join(__dirname, "../../SKILL.md"), "utf-8");
const WALLET = "0x423617B2970Dd2Fc66F646d18B8E7f89731405e6";

interface AgentResponse {
  tool_name: string;
  params: Record<string, any>;
  reasoning?: string;
}

async function askAgent(prompt: string): Promise<AgentResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set in .env");

  const systemPrompt = `You are a Carbon DeFi trading assistant. Here are your instructions:\n\n${SKILL}\n\nWhen the user asks you to perform a trading action, respond ONLY with a JSON object (no markdown, no explanation) with these fields:\n- tool_name: the exact tool name to call\n- params: the parameters you would pass\n- reasoning: one sentence explaining your choice`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await res.json() as any;
  const text = data.content?.[0]?.text;
  if (!text) throw new Error(`No response from API: ${JSON.stringify(data)}`);

  try {
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    throw new Error(`Could not parse agent response as JSON: ${text}`);
  }
}

export const agentSelectionSuite: EvalSuite = {
  name: "Agent — Strategy Selection",
  cases: [
    {
      name: "buy at exact price → limit_order",
      run: async () => {
        const res = await askAgent(`Buy ETH at exactly 1950 USDC with 500 USDC. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_limit_order", "tool_name");
        assertEq(res.params.direction, "buy", "direction");
        assertEq(res.params.price, 1950, "price");
      },
    },
    {
      name: "sell at exact price → limit_order",
      run: async () => {
        const res = await askAgent(`Sell 0.1 ETH at 2100 USDC. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_limit_order", "tool_name");
        assertEq(res.params.direction, "sell", "direction");
      },
    },
    {
      name: "scale in as price drops → range_order buy",
      run: async () => {
        const res = await askAgent(`Scale into ETH as price drops from 1950 to 1800. Spend 1000 USDC. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_range_order", "tool_name");
        assertEq(res.params.direction, "buy", "direction");
      },
    },
    {
      name: "DCA into ETH → range_order buy",
      run: async () => {
        const res = await askAgent(`DCA into ETH between 1800 and 1950 with 2000 USDC. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_range_order", "tool_name");
        assertEq(res.params.direction, "buy", "direction");
      },
    },
    {
      name: "scale out as price rises → range_order sell",
      run: async () => {
        const res = await askAgent(`Sell my ETH gradually as price rises from 2100 to 2300. I have 0.5 ETH. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_range_order", "tool_name");
        assertEq(res.params.direction, "sell", "direction");
      },
    },
    {
      name: "buy low sell high forever → recurring_strategy",
      run: async () => {
        const res = await askAgent(`Create a recurring strategy to buy ETH at 1900-1950 and sell at 2100-2200. 1000 USDC budget. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_recurring_strategy", "tool_name");
      },
    },
    {
      name: "provide liquidity with spread → concentrated_strategy",
      run: async () => {
        const res = await askAgent(`Provide concentrated liquidity for ETH/USDC between 1900 and 2100 with 1% spread. 1000 USDC. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_concentrated_strategy", "tool_name");
      },
    },
    {
      name: "full range liquidity → full_range_strategy",
      run: async () => {
        const res = await askAgent(`Create a full range liquidity position for ETH/USDC with 1% spread and 1000 USDC. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_full_range_strategy", "tool_name");
      },
    },
  ],
};

export const agentBehaviorSuite: EvalSuite = {
  name: "Agent — Behavior Rules",
  cases: [
    {
      name: "buy above market triggers warning awareness",
      run: async () => {
        const res = await askAgent(`Buy ETH at 2100 USDC with 500 USDC. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_limit_order", "tool_name");
        // Agent should still create the order (warnings surface from tool, not block)
        assertEq(res.params.direction, "buy", "direction");
      },
    },
    {
      name: "concentrated strategy sell anchor — uses sell budget",
      run: async () => {
        const res = await askAgent(`Provide liquidity for ETH/USDC between 1900 and 2100 with 1% spread. I want to deposit 0.15 ETH. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_concentrated_strategy", "tool_name");
        assertEq(res.params.anchor, "sell", "anchor should be sell when user provides ETH");
      },
    },
    {
      name: "scale in 3.5% below market → range_order not recurring",
      run: async () => {
        const res = await askAgent(`Scale into ETH as price drops 3.5% from market. Spend 1000 USDC. Market is 2000. Wallet: ${WALLET} on Ethereum.`);
        assertEq(res.tool_name, "carbon_create_range_order", "tool_name");
        assertEq(res.params.direction, "buy", "direction");
      },
    },
  ],
};
