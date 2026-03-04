import { AgenticWallet } from "../wallet/AgenticWallet";
/**
 * TestDApp simulates interaction with a decentralized application.
 * This mimics how a real DeFi protocol would interact with an agentic wallet.
 */
export declare class TestDApp {
    private connection;
    private name;
    constructor(name?: string);
    deposit(wallet: AgenticWallet, amount: number): Promise<string>;
    simulateSwap(wallet: AgenticWallet, fromToken: string, toToken: string, amount: number): Promise<{
        success: boolean;
        message: string;
        txId?: string;
    }>;
    getInfo(): object;
}
//# sourceMappingURL=TestDApp.d.ts.map