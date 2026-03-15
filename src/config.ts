import * as dotenv from "dotenv";
dotenv.config();
import { Toolkit, MarginalPriceOptions } from "@bancor/carbon-sdk/strategy-management";
import { ChainCache, initSyncedCache } from "@bancor/carbon-sdk/chain-cache";
import { ContractsApi } from "@bancor/carbon-sdk/contracts-api";
import { JsonRpcProvider, Contract, parseUnits } from "ethers";

// ─── Chain Configuration ────────────────────────────────────────────────────

export const CHAIN_CONFIG: Record<string, {
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

export const CHAIN_ENUM = ["ethereum", "sei", "celo", "tac"] as const;
export type Chain = typeof CHAIN_ENUM[number];

// ─── SDK Cache ───────────────────────────────────────────────────────────────

const sdkCache: Record<string, Toolkit> = {};

export async function getSDK(chain: string): Promise<Toolkit> {
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

// ─── Constants ───────────────────────────────────────────────────────────────

export const ETH_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function checkAllowance(chain: string, tokenAddress: string, walletAddress: string, budget: number): Promise<string | null> {
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

export async function getTokenDecimals(chain: string, tokenAddress: string): Promise<number> {
  if (tokenAddress.toLowerCase() === ETH_ADDRESS.toLowerCase()) return 18;
  const config = CHAIN_CONFIG[chain];
  const provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
  return Number(await new Contract(tokenAddress, ERC20_ABI, provider).decimals());
}

export function formatTx(tx: any) {
  return { to: tx.to, data: tx.data, value: tx.value?.toString() || "0" };
}

export { MarginalPriceOptions };
