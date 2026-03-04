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
exports.AgenticWallet = void 0;
const web3_js_1 = require("@solana/web3.js");
const spl_token_1 = require("@solana/spl-token");
const bs58 = __importStar(require("bs58"));
const fs = __importStar(require("fs"));
class AgenticWallet {
    constructor(keypair) {
        this.connection = new web3_js_1.Connection((0, web3_js_1.clusterApiUrl)("devnet"), "confirmed");
        this.keypair = keypair || web3_js_1.Keypair.generate();
    }
    // ─── Create wallet programmatically ───────────────────────────────────────
    static create() {
        const keypair = web3_js_1.Keypair.generate();
        console.log(`✅ Wallet created: ${keypair.publicKey.toBase58()}`);
        return new AgenticWallet(keypair);
    }
    // ─── Load wallet from private key ─────────────────────────────────────────
    static fromPrivateKey(privateKey) {
        const decoded = bs58.decode(privateKey);
        const keypair = web3_js_1.Keypair.fromSecretKey(decoded);
        return new AgenticWallet(keypair);
    }
    // ─── Save wallet to file ───────────────────────────────────────────────────
    saveToFile(filePath) {
        const walletData = {
            publicKey: this.publicKey,
            privateKey: bs58.encode(this.keypair.secretKey),
        };
        fs.writeFileSync(filePath, JSON.stringify(walletData, null, 2));
        console.log(`💾 Wallet saved to ${filePath}`);
    }
    // ─── Load wallet from file ─────────────────────────────────────────────────
    static loadFromFile(filePath) {
        const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        return AgenticWallet.fromPrivateKey(data.privateKey);
    }
    // ─── Get public key ────────────────────────────────────────────────────────
    get publicKey() {
        return this.keypair.publicKey.toBase58();
    }
    get keypairInstance() {
        return this.keypair;
    }
    get connectionInstance() {
        return this.connection;
    }
    // ─── Get SOL balance ───────────────────────────────────────────────────────
    async getBalance() {
        const balance = await this.connection.getBalance(this.keypair.publicKey);
        return balance / web3_js_1.LAMPORTS_PER_SOL;
    }
    // ─── Request airdrop (devnet only) ────────────────────────────────────────
    async requestAirdrop(solAmount = 1) {
        console.log(`🪂 Requesting ${solAmount} SOL airdrop...`);
        const signature = await this.connection.requestAirdrop(this.keypair.publicKey, solAmount * web3_js_1.LAMPORTS_PER_SOL);
        await this.connection.confirmTransaction(signature);
        console.log(`✅ Airdrop confirmed! Tx: ${signature}`);
        return signature;
    }
    // ─── Sign and send SOL transfer ───────────────────────────────────────────
    async sendSOL(toAddress, amount) {
        console.log(`💸 Sending ${amount} SOL to ${toAddress}...`);
        const transaction = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.transfer({
            fromPubkey: this.keypair.publicKey,
            toPubkey: new web3_js_1.PublicKey(toAddress),
            lamports: amount * web3_js_1.LAMPORTS_PER_SOL,
        }));
        const signature = await (0, web3_js_1.sendAndConfirmTransaction)(this.connection, transaction, [this.keypair]);
        console.log(`✅ SOL sent! Tx: ${signature}`);
        return signature;
    }
    // ─── Get SPL token balance ────────────────────────────────────────────────
    async getSPLTokenBalance(mintAddress) {
        try {
            const mintPubkey = new web3_js_1.PublicKey(mintAddress);
            const tokenAccount = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(this.connection, this.keypair, mintPubkey, this.keypair.publicKey);
            const accountInfo = await (0, spl_token_1.getAccount)(this.connection, tokenAccount.address);
            return Number(accountInfo.amount);
        }
        catch {
            return 0;
        }
    }
    // ─── Transfer SPL tokens ──────────────────────────────────────────────────
    async sendSPLToken(mintAddress, toAddress, amount) {
        console.log(`🪙 Sending ${amount} tokens to ${toAddress}...`);
        const mintPubkey = new web3_js_1.PublicKey(mintAddress);
        const toPubkey = new web3_js_1.PublicKey(toAddress);
        const fromTokenAccount = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(this.connection, this.keypair, mintPubkey, this.keypair.publicKey);
        const toTokenAccount = await (0, spl_token_1.getOrCreateAssociatedTokenAccount)(this.connection, this.keypair, mintPubkey, toPubkey);
        const signature = await (0, spl_token_1.transfer)(this.connection, this.keypair, fromTokenAccount.address, toTokenAccount.address, this.keypair, amount);
        console.log(`✅ Tokens sent! Tx: ${signature}`);
        return signature;
    }
    // ─── Get full wallet info ─────────────────────────────────────────────────
    async getWalletInfo() {
        const balance = await this.getBalance();
        return {
            publicKey: this.publicKey,
            privateKey: bs58.encode(this.keypair.secretKey),
            balance,
        };
    }
}
exports.AgenticWallet = AgenticWallet;
//# sourceMappingURL=AgenticWallet.js.map