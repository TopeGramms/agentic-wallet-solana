import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  transfer,
  getAccount,
} from "@solana/spl-token";
import * as bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";

export interface WalletInfo {
  publicKey: string;
  privateKey: string;
  balance: number;
}

export class AgenticWallet {
  private keypair: Keypair;
  private connection: Connection;

  constructor(keypair?: Keypair) {
    this.connection = new Connection(clusterApiUrl("devnet"), "confirmed");
    this.keypair = keypair || Keypair.generate();
  }

  // ─── Create wallet programmatically ───────────────────────────────────────
  static create(): AgenticWallet {
    const keypair = Keypair.generate();
    console.log(`✅ Wallet created: ${keypair.publicKey.toBase58()}`);
    return new AgenticWallet(keypair);
  }

  // ─── Load wallet from private key ─────────────────────────────────────────
  static fromPrivateKey(privateKey: string): AgenticWallet {
    const decoded = bs58.decode(privateKey);
    const keypair = Keypair.fromSecretKey(decoded);
    return new AgenticWallet(keypair);
  }

  // ─── Save wallet to file ───────────────────────────────────────────────────
  saveToFile(filePath: string): void {
    const walletData = {
      publicKey: this.publicKey,
      privateKey: bs58.encode(this.keypair.secretKey),
    };
    fs.writeFileSync(filePath, JSON.stringify(walletData, null, 2));
    console.log(`💾 Wallet saved to ${filePath}`);
  }

  // ─── Load wallet from file ─────────────────────────────────────────────────
  static loadFromFile(filePath: string): AgenticWallet {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return AgenticWallet.fromPrivateKey(data.privateKey);
  }

  // ─── Get public key ────────────────────────────────────────────────────────
  get publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  get keypairInstance(): Keypair {
    return this.keypair;
  }

  get connectionInstance(): Connection {
    return this.connection;
  }

  // ─── Get SOL balance ───────────────────────────────────────────────────────
  async getBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.keypair.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  // ─── Request airdrop (devnet only) ────────────────────────────────────────
  async requestAirdrop(solAmount: number = 1): Promise<string> {
    console.log(`🪂 Requesting ${solAmount} SOL airdrop...`);
    const signature = await this.connection.requestAirdrop(
      this.keypair.publicKey,
      solAmount * LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(signature);
    console.log(`✅ Airdrop confirmed! Tx: ${signature}`);
    return signature;
  }

  // ─── Sign and send SOL transfer ───────────────────────────────────────────
  async sendSOL(toAddress: string, amount: number): Promise<string> {
    console.log(`💸 Sending ${amount} SOL to ${toAddress}...`);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: new PublicKey(toAddress),
        lamports: amount * LAMPORTS_PER_SOL,
      })
    );

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.keypair]
    );
    console.log(`✅ SOL sent! Tx: ${signature}`);
    return signature;
  }

  // ─── Get SPL token balance ────────────────────────────────────────────────
  async getSPLTokenBalance(mintAddress: string): Promise<number> {
    try {
      const mintPubkey = new PublicKey(mintAddress);
      const tokenAccount = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.keypair,
        mintPubkey,
        this.keypair.publicKey
      );
      const accountInfo = await getAccount(this.connection, tokenAccount.address);
      return Number(accountInfo.amount);
    } catch {
      return 0;
    }
  }

  // ─── Transfer SPL tokens ──────────────────────────────────────────────────
  async sendSPLToken(
    mintAddress: string,
    toAddress: string,
    amount: number
  ): Promise<string> {
    console.log(`🪙 Sending ${amount} tokens to ${toAddress}...`);
    const mintPubkey = new PublicKey(mintAddress);
    const toPubkey = new PublicKey(toAddress);

    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.keypair,
      mintPubkey,
      this.keypair.publicKey
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.keypair,
      mintPubkey,
      toPubkey
    );

    const signature = await transfer(
      this.connection,
      this.keypair,
      fromTokenAccount.address,
      toTokenAccount.address,
      this.keypair,
      amount
    );

    console.log(`✅ Tokens sent! Tx: ${signature}`);
    return signature;
  }

  // ─── Get full wallet info ─────────────────────────────────────────────────
  async getWalletInfo(): Promise<WalletInfo> {
    const balance = await this.getBalance();
    return {
      publicKey: this.publicKey,
      privateKey: bs58.encode(this.keypair.secretKey),
      balance,
    };
  }
}
