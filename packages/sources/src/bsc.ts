import { createPublicClient, http, parseAbi, parseAbiItem, type PublicClient } from "viem";
import { bsc } from "viem/chains";

/** BEP-677 (EIP-8056 Scaled UI Amount on BSC). Multipliers are 18-decimal fixed point (1e18 = 1.0). */
export const SCALED_UI_ABI = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  "function supportsInterface(bytes4) view returns (bool)",
]);
export const UI_MULTIPLIER_UPDATED = parseAbiItem("event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)");
export const UI_MULTIPLIER_OVERWRITTEN = parseAbiItem("event UIMultiplierChangeOverwritten(uint256 overwrittenMultiplier, uint256 overwrittenEffectiveAt, uint256 newMultiplier, uint256 newEffectiveAt)");

const E18 = 10n ** 18n;
export const fromE18 = (x: bigint) => Number(x / 10n ** 6n) / 1e12;

export interface MultiplierState { contract: `0x${string}`; current: number; pending?: { multiplier: number; effectiveAt: number } }
export interface MultiplierEvent { contract: `0x${string}`; block: bigint; tx: `0x${string}`; oldMultiplier: number; newMultiplier: number; effectiveAt: number; overwritten?: boolean }

export class BscScaledUi {
  private client: PublicClient;
  constructor(rpcUrl = process.env.BSC_RPC_URL ?? "https://bsc-dataseed.bnbchain.org", client?: PublicClient) {
    this.client = client ?? (createPublicClient({ chain: bsc, transport: http(rpcUrl, { batch: true, retryCount: 2 }) }) as PublicClient);
  }

  /** Current multiplier and any genuinely pending change. Returns null for tokens without BEP-677. */
  async state(contract: `0x${string}`, nowSec = Math.floor(Date.now() / 1000)): Promise<MultiplierState | null> {
    try {
      const [cur, next, eff] = await Promise.all([
        this.client.readContract({ address: contract, abi: SCALED_UI_ABI, functionName: "uiMultiplier" }),
        this.client.readContract({ address: contract, abi: SCALED_UI_ABI, functionName: "newUIMultiplier" }).catch(() => undefined),
        this.client.readContract({ address: contract, abi: SCALED_UI_ABI, functionName: "effectiveAt" }).catch(() => 0n),
      ]);
      const s: MultiplierState = { contract, current: fromE18(cur as bigint) };
      // Per BEP-677: a pending change exists only when effectiveAt > now.
      if (next !== undefined && (eff as bigint) > BigInt(nowSec)) s.pending = { multiplier: fromE18(next as bigint), effectiveAt: Number(eff) * 1000 };
      return s;
    } catch {
      return null;
    }
  }

  /** Every scheduled multiplier change, for the adjustment audit. */
  async history(contract: `0x${string}`, fromBlock: bigint, toBlock: bigint | "latest" = "latest", chunk = 50_000n): Promise<MultiplierEvent[]> {
    const end = toBlock === "latest" ? await this.client.getBlockNumber() : toBlock;
    const out: MultiplierEvent[] = [];
    for (let a = fromBlock; a <= end; a += chunk) {
      const b = a + chunk - 1n > end ? end : a + chunk - 1n;
      const [upd, ovr] = await Promise.all([
        this.client.getLogs({ address: contract, event: UI_MULTIPLIER_UPDATED, fromBlock: a, toBlock: b }),
        this.client.getLogs({ address: contract, event: UI_MULTIPLIER_OVERWRITTEN, fromBlock: a, toBlock: b }),
      ]);
      for (const l of upd) out.push({ contract, block: l.blockNumber!, tx: l.transactionHash!, oldMultiplier: fromE18(l.args.oldMultiplier!), newMultiplier: fromE18(l.args.newMultiplier!), effectiveAt: Number(l.args.effectiveAtTimestamp!) * 1000 });
      for (const l of ovr) out.push({ contract, block: l.blockNumber!, tx: l.transactionHash!, oldMultiplier: fromE18(l.args.overwrittenMultiplier!), newMultiplier: fromE18(l.args.newMultiplier!), effectiveAt: Number(l.args.newEffectiveAt!) * 1000, overwritten: true });
    }
    return out.sort((x, y) => (x.block < y.block ? -1 : 1));
  }
}

export { E18 };
