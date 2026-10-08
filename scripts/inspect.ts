/**
 * Diagnostics for two open questions from the gate run (2026-10-08):
 *  1. Which issuer are the BSC tokens our symbol rules can't place? Are bStocks in the API at all?
 *  2. Why does BEP-677 uiMultiplier() read 0 of 30? RPC unreachable, or tokens without the interface?
 *   npx tsx scripts/inspect.ts > docs/inspect-output.txt
 */
import { createPublicClient, http, parseAbi } from "viem";
import { bsc } from "viem/chains";
import { BinanceRwa } from "../packages/sources/src/index.js";

const bin = new BinanceRwa();
const rpc = process.env.BSC_RPC_URL ?? "https://bsc-dataseed.bnbchain.org";
const client = createPublicClient({ chain: bsc, transport: http(rpc) });
const ABI = parseAbi([
  "function uiMultiplier() view returns (uint256)",
  "function supportsInterface(bytes4) view returns (bool)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
]);

async function main() {
  console.log(`RPC ${rpc}`);
  try { console.log(`  block ${await client.getBlockNumber()}`); } catch (e) { console.log(`  RPC FAILED: ${String(e).slice(0, 200)}`); }

  for (const type of [undefined, 1, 2, 3, 4, 5]) {
    let list; try { list = await bin.listTokens(type); } catch (e) { console.log(`type=${type}: ${e}`); continue; }
    const chains = new Map<string, number>(); for (const t of list) chains.set(t.chainId, (chains.get(t.chainId) ?? 0) + 1);
    const b = list.filter((t) => t.chainId === "56");
    console.log(`\ntype=${type ?? "none"}: ${list.length} tokens; by chain ${JSON.stringify(Object.fromEntries(chains))}`);
    console.log(`  BSC samples: ${b.slice(0, 8).map((t) => `${t.symbol}(${t.ticker},${t.issuer})`).join(" ")}`);
  }

  const all = new Map<string, Awaited<ReturnType<BinanceRwa["listTokens"]>>[number]>();
  for (const type of [undefined, 1, 2, 3, 4, 5]) { try { for (const t of await bin.listTokens(type)) all.set(`${t.chainId}:${t.contract}`, { ...t, type: t.type ?? type }); } catch {} }
  const unknown = [...all.values()].filter((t) => t.chainId === "56" && t.issuer === "unknown");
  console.log(`\nBSC tokens with unknown issuer (${unknown.length}):`);
  for (const t of unknown) console.log(`  ${t.symbol}\tticker=${t.ticker}\ttype=${t.type}\t${t.contract}`);

  console.log(`\nOn-chain probes (3 per issuer):`);
  const byIssuer = new Map<string, typeof unknown>();
  for (const t of [...all.values()].filter((t) => t.chainId === "56")) { const a = byIssuer.get(t.issuer) ?? []; if (a.length < 3) a.push(t); byIssuer.set(t.issuer, a); }
  for (const [issuer, toks] of byIssuer) for (const t of toks) {
    const out: string[] = [];
    try { out.push(`code=${((await client.getCode({ address: t.contract })) ?? "0x").length}`); } catch (e) { out.push(`getCode ERR ${String(e).slice(0, 80)}`); }
    for (const fn of ["name", "decimals", "uiMultiplier"] as const) {
      try { out.push(`${fn}=${await client.readContract({ address: t.contract, abi: ABI, functionName: fn })}`); } catch (e) { out.push(`${fn} ERR ${String((e as any).shortMessage ?? e).slice(0, 60)}`); }
    }
    // ERC-165's own interface id: does the token support interface detection at all?
    try { out.push(`erc165=${await client.readContract({ address: t.contract, abi: ABI, functionName: "supportsInterface", args: ["0x01ffc9a7"] })}`); } catch { out.push("erc165=n/a"); }
    console.log(`  [${issuer}] ${t.symbol} ${t.contract}: ${out.join(" ")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
