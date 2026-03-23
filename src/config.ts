import * as dotenv from "dotenv";
dotenv.config();
import { Toolkit, MarginalPriceOptions } from "@bancor/carbon-sdk/strategy-management";
import { ChainCache, initSyncedCache } from "@bancor/carbon-sdk/chain-cache";
import { ContractsApi } from "@bancor/carbon-sdk/contracts-api";
import { JsonRpcProvider, Contract, parseUnits } from "ethers";

const CARBON_API = "https://api.carbondefi.xyz/v1";

// ─── Chain Configuration ──────────────────────────────────────────────────────

// Multiple RPCs per chain — round-robin with fallback (used for writes + allowance only)
const RPC_POOLS: Record<string, string[]> = {
  ethereum: [
    process.env.RPC_URL_ETHEREUM || "https://eth.llamarpc.com",
    "https://rpc.ankr.com/eth",
    "https://ethereum.publicnode.com",
    "https://1rpc.io/eth",
  ],
  sei: [
    process.env.RPC_URL_SEI || "https://evm-rpc.sei-apis.com",
    "https://sei-evm-rpc.publicnode.com",
  ],
  celo: [
    process.env.RPC_URL_CELO || "https://forno.celo.org",
    "https://rpc.ankr.com/celo",
    "https://celo.publicnode.com",
  ],
  tac: [
    process.env.RPC_URL_TAC || "https://rpc.tac.build",
  ],
};

const rpcIndex: Record<string, number> = { ethereum: 0, sei: 0, celo: 0, tac: 0 };

function nextRpc(chain: string): string {
  const pool = RPC_POOLS[chain];
  const idx = rpcIndex[chain] % pool.length;
  rpcIndex[chain] = (idx + 1) % pool.length;
  return pool[idx];
}

export const CHAIN_CONFIG: Record<string, {
  carbonControllerAddress: string;
  voucherAddress: string;
  chainId: number;
}> = {
  ethereum: {
    carbonControllerAddress: "0xC537e898CD774e2dCBa3B14Ea6f34C93d5eA45e1",
    voucherAddress: "0x3660F04B79751e31128f6378eAC70807e38f554E",
    chainId: parseInt(process.env.CHAIN_ID_ETHEREUM || "1"),
  },
  sei: {
    carbonControllerAddress: "0xe4816658ad10bF215053C533cceAe3f59e1f1087",
    voucherAddress: "0xA4682A2A5Fe02feFF8Bd200240A41AD0E6EaF8d5",
    chainId: 1329,
  },
  celo: {
    carbonControllerAddress: "0x6619871118D144c1c28eC3b23036FC1f0829ed3a",
    voucherAddress: "0x5E994Ac7d65d81f51a76e0bB5a236C6fDA8dBF9A",
    chainId: 42220,
  },
  tac: {
    carbonControllerAddress: "0xA4682A2A5Fe02feFF8Bd200240A41AD0E6EaF8d5",
    voucherAddress: "0xb0d39990E1C38B50D0b7f6911525535Fbacb4C26",
    chainId: 239,
  },
};

export const CHAIN_ENUM = ["ethereum", "sei", "celo", "tac"] as const;
export type Chain = typeof CHAIN_ENUM[number];

// ─── Agent-provided RPC validation ───────────────────────────────────────────

const PRIVATE_IP = /^https?:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;

export function validateRpcUrl(url: string): string {
  if (!url.startsWith("https://")) throw new Error("Custom RPC URL must use HTTPS.");
  if (PRIVATE_IP.test(url)) throw new Error("Custom RPC URL must not point to a private or local address.");
  return url;
}

function getRpcUrl(chain: string, customRpc?: string): string {
  if (customRpc) return validateRpcUrl(customRpc);
  return nextRpc(chain);
}

// ─── Strategies Cache (api.carbondefi.xyz) ────────────────────────────────────

// Full strategy list cached per chain for 30 seconds
const strategiesCache = new Map<string, { data: any[]; expires: number }>();

async function fetchAllStrategies(chain: string): Promise<any[]> {
  const cached = strategiesCache.get(chain);
  if (cached && Date.now() < cached.expires) return cached.data;
  const res = await fetch(`${CARBON_API}/${chain}/strategies?pageSize=10000`);
  if (!res.ok) throw new Error(`Failed to fetch strategies for ${chain}: ${res.status}`);
  const json = await res.json() as any;
  const data = json.strategies || [];
  strategiesCache.set(chain, { data, expires: Date.now() + 30_000 });
  return data;
}

export async function getStrategiesByOwner(chain: string, owner: string): Promise<any[]> {
  const all = await fetchAllStrategies(chain);
  return all.filter(s => s.owner?.toLowerCase() === owner.toLowerCase());
}

// ─── Token Decimals Cache (api.carbondefi.xyz) ───────────────────────────────

// Token list fetched once per chain, cached forever (decimals never change)
const tokensCache = new Map<string, Map<string, number>>();

async function fetchTokenDecimals(chain: string): Promise<Map<string, number>> {
  const cached = tokensCache.get(chain);
  if (cached) return cached;
  const res = await fetch(`${CARBON_API}/${chain}/tokens`);
  if (!res.ok) throw new Error(`Failed to fetch tokens for ${chain}: ${res.status}`);
  const tokens: { address: string; decimals: number }[] = await res.json() as any;
  const map = new Map<string, number>();
  for (const t of tokens) map.set(t.address.toLowerCase(), t.decimals);
  tokensCache.set(chain, map);
  return map;
}

export async function getTokenDecimals(chain: string, tokenAddress: string, customRpc?: string): Promise<number> {
  if (tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase()) return 18;
  // Try API first
  try {
    const map = await fetchTokenDecimals(chain);
    const decimals = map.get(tokenAddress.toLowerCase());
    if (decimals !== undefined) return decimals;
  } catch {}
  // Fallback to RPC if token not in API (unlisted tokens)
  const config = CHAIN_CONFIG[chain];
  const rpcUrl = getRpcUrl(chain, customRpc);
  const provider = new JsonRpcProvider(rpcUrl, config.chainId);
  const decimals = Number(await new Contract(tokenAddress, ERC20_ABI, provider).decimals());
  // Cache for future calls
  const map = tokensCache.get(chain) || new Map();
  map.set(tokenAddress.toLowerCase(), decimals);
  tokensCache.set(chain, map);
  return decimals;
}

// ─── IP Rate Limiter ──────────────────────────────────────────────────────────

// 60 requests per minute per IP
const ipRequests = new Map<string, { count: number; reset: number }>();

export function checkRateLimit(ip: string): { limited: boolean; retryAfter?: number } {
  const now = Date.now();
  const window = 60_000;
  const limit = 60;
  const entry = ipRequests.get(ip);
  if (!entry || now > entry.reset) {
    ipRequests.set(ip, { count: 1, reset: now + window });
    return { limited: false };
  }
  if (entry.count >= limit) {
    return { limited: true, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }
  entry.count++;
  return { limited: false };
}

// ─── SDK (for writes + allowance checks only) ────────────────────────────────

const sdkCache: Record<string, Toolkit> = {};

export async function getSDK(chain: string, customRpc?: string): Promise<Toolkit> {
  if (customRpc) return createSDK(chain, validateRpcUrl(customRpc));
  if (sdkCache[chain]) return sdkCache[chain];
  const pool = RPC_POOLS[chain];
  for (const rpcUrl of pool) {
    try {
      const sdk = await createSDK(chain, rpcUrl);
      sdkCache[chain] = sdk;
      return sdk;
    } catch {}
  }
  throw new Error(`All RPC endpoints failed for chain: ${chain}`);
}

async function createSDK(chain: string, rpcUrl: string): Promise<Toolkit> {
  const config = CHAIN_CONFIG[chain];
  if (!config) throw new Error(`Unsupported chain: ${chain}`);
  const provider = new JsonRpcProvider(rpcUrl, config.chainId);
  const api = new ContractsApi(provider as any, {
    carbonControllerAddress: config.carbonControllerAddress,
    voucherAddress: config.voucherAddress,
  });
  const { cache, startDataSync } = initSyncedCache(api.reader, undefined, 2000);
  const toolkit = new Toolkit(api, cache as ChainCache);
  startDataSync();
  return toolkit;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// ─── Allowance check (RPC only — no API equivalent) ──────────────────────────

export async function checkAllowance(chain: string, tokenAddress: string, walletAddress: string, budget: number, customRpc?: string): Promise<string | null> {
  if (tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase()) return null;
  try {
    const config = CHAIN_CONFIG[chain];
    const rpcUrl = getRpcUrl(chain, customRpc);
    const provider = new JsonRpcProvider(rpcUrl, config.chainId);
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatTx(tx: any) {
  return { to: tx.to, data: tx.data, value: tx.value?.toString() || "0" };
}

export { MarginalPriceOptions };

