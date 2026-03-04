"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
const AgenticWallet_1 = require("./wallet/AgenticWallet");
const WalletAgent_1 = require("./agent/WalletAgent");
const TestDApp_1 = require("./dapp/TestDApp");
dotenv.config();
async function main() {
    console.log("🚀 Agentic Wallet for AI Agents - Solana Devnet");
    console.log("================================================\n");
    // ─── Step 1: Create a new wallet programmatically ─────────────────────────
    console.log("📌 Step 1: Creating wallet...");
    const wallet = AgenticWallet_1.AgenticWallet.create();
    console.log(`   Public Key: ${wallet.publicKey}\n`);
    // ─── Step 2: Request devnet airdrop ───────────────────────────────────────
    console.log("📌 Step 2: Funding wallet via airdrop...");
    await wallet.requestAirdrop(1);
    const balance = await wallet.getBalance();
    console.log(`   Balance: ${balance} SOL\n`);
    // ─── Step 3: Run AI agent with wallet instructions ────────────────────────
    console.log("📌 Step 3: Running AI Agent...");
    const agentResult = await (0, WalletAgent_1.runWalletAgent)("Check my wallet balance and then tell me how much SOL I have.", wallet);
    console.log(`\n   Agent Response: ${agentResult}\n`);
    // ─── Step 4: Interact with a test dApp ────────────────────────────────────
    console.log("📌 Step 4: Interacting with test dApp...");
    const dapp = new TestDApp_1.TestDApp("SuperSwap Devnet");
    const swapResult = await dapp.simulateSwap(wallet, "SOL", "USDC", 0.1);
    console.log(`   ${swapResult.message}\n`);
    // ─── Step 5: AI agent performs a complex task ─────────────────────────────
    console.log("📌 Step 5: Agent performing complex DeFi task...");
    const complexResult = await (0, WalletAgent_1.runWalletAgent)("Get my wallet info and current SOL balance. Then tell me if I have enough to make a transaction.", wallet);
    console.log(`\n   Final Agent Response: ${complexResult}\n`);
    console.log("✅ Demo complete! Agentic wallet working on Solana Devnet.");
    console.log(`\n🔍 View transactions at: https://explorer.solana.com/address/${wallet.publicKey}?cluster=devnet`);
}
main().catch(console.error);
//# sourceMappingURL=index.js.map