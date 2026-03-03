import Anthropic from "@anthropic/sdk";
import { AgenticWallet } from "../wallet/AgenticWallet";

const client = new Anthropic();

// ─── Tool definitions for the AI agent ────────────────────────────────────
const walletTools: Anthropic.Tool[] = [
  {
    name: "get_balance",
    description: "Get the current SOL balance of the wallet",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "send_sol",
    description: "Send SOL to another wallet address",
    input_schema: {
      type: "object" as const,
      properties: {
        to_address: {
          type: "string",
          description: "The recipient's Solana wallet address",
        },
        amount: {
          type: "number",
          description: "Amount of SOL to send",
        },
      },
      required: ["to_address", "amount"],
    },
  },
  {
    name: "request_airdrop",
    description: "Request a SOL airdrop on devnet for testing",
    input_schema: {
      type: "object" as const,
      properties: {
        amount: {
          type: "number",
          description: "Amount of SOL to request (max 2 SOL on devnet)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_wallet_info",
    description: "Get full wallet information including public key and balance",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_spl_token_balance",
    description: "Get the balance of a specific SPL token",
    input_schema: {
      type: "object" as const,
      properties: {
        mint_address: {
          type: "string",
          description: "The mint address of the SPL token",
        },
      },
      required: ["mint_address"],
    },
  },
  {
    name: "send_spl_token",
    description: "Send SPL tokens to another wallet address",
    input_schema: {
      type: "object" as const,
      properties: {
        mint_address: {
          type: "string",
          description: "The mint address of the SPL token",
        },
        to_address: {
          type: "string",
          description: "The recipient's Solana wallet address",
        },
        amount: {
          type: "number",
          description: "Amount of tokens to send",
        },
      },
      required: ["mint_address", "to_address", "amount"],
    },
  },
];

// ─── Execute wallet tools ──────────────────────────────────────────────────
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  wallet: AgenticWallet
): Promise<string> {
  try {
    switch (toolName) {
      case "get_balance": {
        const balance = await wallet.getBalance();
        return `Current SOL balance: ${balance} SOL`;
      }
      case "send_sol": {
        const sig = await wallet.sendSOL(
          toolInput.to_address as string,
          toolInput.amount as number
        );
        return `Successfully sent ${toolInput.amount} SOL. Transaction: ${sig}`;
      }
      case "request_airdrop": {
        const amount = (toolInput.amount as number) || 1;
        const sig = await wallet.requestAirdrop(amount);
        return `Airdrop of ${amount} SOL successful. Transaction: ${sig}`;
      }
      case "get_wallet_info": {
        const info = await wallet.getWalletInfo();
        return `Wallet Info:\n- Public Key: ${info.publicKey}\n- Balance: ${info.balance} SOL`;
      }
      case "get_spl_token_balance": {
        const balance = await wallet.getSPLTokenBalance(
          toolInput.mint_address as string
        );
        return `SPL Token balance: ${balance}`;
      }
      case "send_spl_token": {
        const sig = await wallet.sendSPLToken(
          toolInput.mint_address as string,
          toolInput.to_address as string,
          toolInput.amount as number
        );
        return `Successfully sent ${toolInput.amount} tokens. Transaction: ${sig}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (error) {
    return `Error executing ${toolName}: ${(error as Error).message}`;
  }
}

// ─── Main AI Agent loop ────────────────────────────────────────────────────
export async function runWalletAgent(
  userInstruction: string,
  wallet: AgenticWallet
): Promise<string> {
  console.log(`\n🤖 Agent received instruction: "${userInstruction}"\n`);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: userInstruction,
    },
  ];

  const systemPrompt = `You are an autonomous AI agent that controls a Solana wallet on devnet.
You can perform wallet operations like checking balances, sending SOL, requesting airdrops, and managing SPL tokens.
Always confirm actions before executing them and provide clear feedback about what you're doing.
You are operating on Solana DEVNET - this is for testing purposes only with no real funds.
Wallet public key: ${wallet.publicKey}`;

  let finalResponse = "";

  // Agentic loop
  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      tools: walletTools,
      messages,
    });

    console.log(`🔄 Agent thinking... (stop_reason: ${response.stop_reason})`);

    // Collect text from response
    for (const block of response.content) {
      if (block.type === "text") {
        finalResponse = block.text;
        console.log(`💬 Agent: ${block.text}`);
      }
    }

    // If done, break
    if (response.stop_reason === "end_turn") {
      break;
    }

    // Handle tool use
    if (response.stop_reason === "tool_use") {
      const toolResults: Anthropic.MessageParam = {
        role: "user",
        content: [],
      };

      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`🔧 Using tool: ${block.name} with input:`, block.input);
          const result = await executeTool(
            block.name,
            block.input as Record<string, unknown>,
            wallet
          );
          console.log(`✅ Tool result: ${result}`);

          (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
            type: "tool_result",
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      // Add assistant response and tool results to message history
      messages.push({ role: "assistant", content: response.content });
      messages.push(toolResults);
    }
  }

  return finalResponse;
}
