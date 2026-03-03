import * as dotenv from "dotenv";
import { AgenticWallet } from "./wallet/AgenticWallet";
import { runWalletAgent } from "./agent/WalletAgent";
import { TestDApp } from "./dapp/TestDApp";

dotenv.config();

async function main() {
  console.log("🚀 Agentic Wallet for AI Agents - Solana Devnet");
  console.log("================================================\n");

  // ─── Step 1: Create a new wallet programmatically ─────────────────────────
  console.log("📌 Step 1: Creating wallet...");
  const wallet = AgenticWallet.create();
  console.log(`   Public Key: ${wallet.publicKey}\n`);

  // ─── Step 2: Request devnet airdrop ───────────────────────────────────────
  console.log("📌 Step 2: Funding wallet via airdrop...");
  await wallet.requestAirdrop(1);
  const balance = await wallet.getBalance();
  console.log(`   Balance: ${balance} SOL\n`);

  // ─── Step 3: Run AI agent with wallet instructions ────────────────────────
  console.log("📌 Step 3: Running AI Agent...");
  const agentResult = await runWalletAgent(
    "Check my wallet balance and then tell me how much SOL I have.",
    wallet
  );
  console.log(`\n   Agent Response: ${agentResult}\n`);

  // ─── Step 4: Interact with a test dApp ────────────────────────────────────
  console.log("📌 Step 4: Interacting with test dApp...");
  const dapp = new TestDApp("SuperSwap Devnet");
  const swapResult = await dapp.simulateSwap(wallet, "SOL", "USDC", 0.1);
  console.log(`   ${swapResult.message}\n`);

  // ─── Step 5: AI agent performs a complex task ─────────────────────────────
  console.log("📌 Step 5: Agent performing complex DeFi task...");
  const complexResult = await runWalletAgent(
    "Get my wallet info and current SOL balance. Then tell me if I have enough to make a transaction.",
    wallet
  );
  console.log(`\n   Final Agent Response: ${complexResult}\n`);

  console.log("✅ Demo complete! Agentic wallet working on Solana Devnet.");
  console.log(`\n🔍 View transactions at: https://explorer.solana.com/address/${wallet.publicKey}?cluster=devnet`);
}

main().catch(console.error);
