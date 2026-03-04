"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestDApp = void 0;
const web3_js_1 = require("@solana/web3.js");
/**
 * TestDApp simulates interaction with a decentralized application.
 * This mimics how a real DeFi protocol would interact with an agentic wallet.
 */
class TestDApp {
    constructor(name = "SuperSwap Devnet") {
        this.connection = new web3_js_1.Connection("https://api.devnet.solana.com", "confirmed");
        this.name = name;
    }
    // ─── Simulate a deposit into a dApp vault ─────────────────────────────────
    async deposit(wallet, amount) {
        console.log(`\n📲 Interacting with dApp: ${this.name}`);
        console.log(`💰 Depositing ${amount} SOL...`);
        // In a real dApp, this would call the program's deposit instruction
        // For testing, we simulate by sending SOL to a devnet address
        const dappVault = "11111111111111111111111111111111"; // System program as mock vault
        const transaction = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.transfer({
            fromPubkey: wallet.keypairInstance.publicKey,
            toPubkey: new web3_js_1.PublicKey(dappVault),
            lamports: Math.floor(amount * web3_js_1.LAMPORTS_PER_SOL * 0.001), // tiny amount for test
        }));
        const signature = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, transaction, [wallet.keypairInstance]);
        console.log(`✅ dApp interaction successful! Tx: ${signature}`);
        return signature;
    }
    // ─── Simulate a swap ──────────────────────────────────────────────────────
    async simulateSwap(wallet, fromToken, toToken, amount) {
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
    getInfo() {
        return {
            name: this.name,
            network: "devnet",
            supportedTokens: ["SOL", "USDC", "USDT"],
            features: ["swap", "deposit", "withdraw"],
        };
    }
}
exports.TestDApp = TestDApp;
//# sourceMappingURL=TestDApp.js.map