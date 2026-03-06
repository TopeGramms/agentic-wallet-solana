import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type FunctionResponsePart,
  type Tool,
} from "@google/generative-ai";
import { AgenticWallet } from "../wallet/AgenticWallet";

// ----- Tool Definitions -----
const walletToolDeclarations: FunctionDeclaration[] = [
  {
    name: "get_balance",
    description: "Get the current SOL balance of the wallet",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: "send_sol",
    description: "Send SOL to another wallet address",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        to_address: {
          type: SchemaType.STRING,
          description: "The recipient's Solana wallet address",
        },
        amount: {
          type: SchemaType.NUMBER,
          description: "Amount of SOL to send",
        },
      },
      required: ["to_address", "amount"],
    },
  },
  {
    name: "request_airdrop",
    description: "Request a SOL airdrop on devnet for testing",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        amount: {
          type: SchemaType.NUMBER,
          description: "Amount of SOL to request (max 2 SOL on devnet)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_wallet_info",
    description: "Get full wallet information including public key and balance",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: "get_spl_token_balance",
    description: "Get the balance of a specific SPL token",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        mint_address: {
          type: SchemaType.STRING,
          description: "The mint address of the SPL token",
        },
      },
      required: ["mint_address"],
    },
  },
  {
    name: "send_spl_token",
    description: "Send SPL tokens to another wallet address",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        mint_address: {
          type: SchemaType.STRING,
          description: "The mint address of the SPL token",
        },
        to_address: {
          type: SchemaType.STRING,
          description: "The recipient's Solana wallet address",
        },
        amount: {
          type: SchemaType.NUMBER,
          description: "Amount of tokens to send",
        },
      },
      required: ["mint_address", "to_address", "amount"],
    },
  },
];

const walletTools: Tool[] = [{ functionDeclarations: walletToolDeclarations }];

// ----- Wallet Tool Executor -----
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

// ----- Gemini Wallet Agent Loop -----
export async function runWalletAgent(
  userInstruction: string,
  wallet: AgenticWallet
): Promise<string> {
  console.log(`\nAgent received instruction: "${userInstruction}"\n`);

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const model = new GoogleGenerativeAI(geminiApiKey).getGenerativeModel({
    model: geminiModel,
  });

  const messages: Content[] = [{ role: "user", parts: [{ text: userInstruction }] }];

  const systemPrompt = `You are an autonomous AI agent that controls a Solana wallet on devnet.
You can perform wallet operations like checking balances, sending SOL, requesting airdrops, and managing SPL tokens.
Always confirm actions before executing them and provide clear feedback about what you're doing.
You are operating on Solana DEVNET - this is for testing purposes only with no real funds.
Wallet public key: ${wallet.publicKey}`;

  let finalResponse = "";

  while (true) {
    const result = await model.generateContent({
      contents: messages,
      systemInstruction: systemPrompt,
      tools: walletTools,
      generationConfig: { maxOutputTokens: 1024 },
    });

    const response = result.response;
    const modelContent = response.candidates?.[0]?.content;

    if (!modelContent?.parts?.length) {
      if (!finalResponse) finalResponse = "No response generated.";
      break;
    }

    const textParts = modelContent.parts
      .filter(
        (part): part is { text: string } => "text" in part && typeof part.text === "string"
      )
      .map((part) => part.text.trim())
      .filter(Boolean);

    if (textParts.length > 0) {
      finalResponse = textParts.join("\n");
      console.log(`Agent: ${finalResponse}`);
    }

    messages.push({ role: "model", parts: modelContent.parts });

    const functionCalls = response.functionCalls() ?? [];
    if (functionCalls.length === 0) {
      break;
    }

    const functionResponses: FunctionResponsePart[] = [];
    for (const call of functionCalls) {
      console.log(`Using tool: ${call.name} with input:`, call.args);
      const toolResult = await executeTool(
        call.name,
        (call.args ?? {}) as Record<string, unknown>,
        wallet
      );
      console.log(`Tool result: ${toolResult}`);

      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: { result: toolResult },
        },
      });
    }

    messages.push({ role: "user", parts: functionResponses });
  }

  return finalResponse;
}
