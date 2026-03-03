import {
  Connection,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { AgenticWallet } from "../wallet/AgenticWallet";

/**
 * TestDApp simulates interaction with a decentralized application.
 * This mimics how a real DeFi protocol would interact with an agentic wallet.
 */
export class TestDApp {
  private connection: Connection;
  private name: string;

  constructor(name: string = "SuperSwap Devnet") {
    this.connection = new Connection("https://api.devnet.solana.com", "confirmed");
    this.name = name;
  }

  // ─── Simulate a deposit into a dApp vault ─────────────────────────────────
  async deposit(wallet: AgenticWallet, amount: number): Promise<string> {
    console.log(`\n📲 Interacting with dApp: ${this.name}`);
    console.log(`💰 Depositing ${amount} SOL...`);

    // In a real dApp, this would call the program's deposit instruction
    // For testing, we simulate by sending SOL to a devnet address
    const dappVault = "11111111111111111111111111111111"; // System program as mock vault

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: wallet.keypairInstance.publicKey,
        toPubkey: new PublicKey(dappVault),
        lamports: Math.floor(amount * LAMPORTS_PER_SOL * 0.001), // tiny amount for test
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [wallet.keypairInstance]
    );

    console.log(`✅ dApp interaction successful! Tx: ${signature}`);
    return signature;
  }

  // ─── Simulate a swap ──────────────────────────────────────────────────────
  async simulateSwap(
    wallet: AgenticWallet,
    fromToken: string,
    toToken: string,
    amount: number
  ): Promise<{ success: boolean; message: string; txId?: string }> {
    console.log(`\n🔄 Simulating swap: ${amount} ${fromToken} → ${toToken}`);
    console.log(`📲 dApp: ${this.name}`);

    // Simulate swap logic (in production this would call a DEX like Jupiter)
    const mockRate = 1.0; // 1:1 for simulation
    const outputAmount = amount * mockRate;

    console.log(`✅ Swap simulation complete!`);
    console.log(`   Input: ${amount} ${fromToken}`);
    console.log(`   Output: ${outputAmount} ${toToken}`);
    console.log(`   Rate: ${mockRate}`);

    return {
      success: true,
      message: `Simulated swap: ${amount} ${fromToken} → ${outputAmount} ${toToken} at rate ${mockRate}`,
    };
  }

  // ─── Get dApp info ────────────────────────────────────────────────────────
  getInfo(): object {
    return {
      name: this.name,
      network: "devnet",
      supportedTokens: ["SOL", "USDC", "USDT"],
      features: ["swap", "deposit", "withdraw"],
    };
  }
}
