import { Connection, Keypair } from "@solana/web3.js";
export interface WalletInfo {
    publicKey: string;
    privateKey: string;
    balance: number;
}
export declare class AgenticWallet {
    private keypair;
    private connection;
    constructor(keypair?: Keypair);
    static create(): AgenticWallet;
    static fromPrivateKey(privateKey: string): AgenticWallet;
    saveToFile(filePath: string): void;
    static loadFromFile(filePath: string): AgenticWallet;
    get publicKey(): string;
    get keypairInstance(): Keypair;
    get connectionInstance(): Connection;
    getBalance(): Promise<number>;
    requestAirdrop(solAmount?: number): Promise<string>;
    sendSOL(toAddress: string, amount: number): Promise<string>;
    getSPLTokenBalance(mintAddress: string): Promise<number>;
    sendSPLToken(mintAddress: string, toAddress: string, amount: number): Promise<string>;
    getWalletInfo(): Promise<WalletInfo>;
}
//# sourceMappingURL=AgenticWallet.d.ts.map