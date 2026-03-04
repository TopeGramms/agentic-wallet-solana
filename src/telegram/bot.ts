import TelegramBot from "node-telegram-bot-api";
import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type FunctionResponsePart,
  type Tool,
} from "@google/generative-ai";
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
import * as bs58 from "bs58";
import * as dotenv from "dotenv";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-lite";

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

// ─── In-memory wallet store per user ──────────────────────────────────────
const userWallets: Record<number, Keypair> = {};
const userSessions: Record<number, Content[]> = {};
const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

// ─── Wallet Tools ─────────────────────────────────────────────────────────
const walletToolDeclarations: FunctionDeclaration[] = [
  {
    name: "create_wallet",
    description: "Create a new Solana wallet for the user",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: "get_balance",
    description: "Get the current SOL balance of the user's wallet",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: "get_wallet_address",
    description: "Get the user's wallet public address",
    parameters: { type: SchemaType.OBJECT, properties: {}, required: [] },
  },
  {
    name: "request_airdrop",
    description: "Request free SOL airdrop on devnet for testing",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        amount: { type: SchemaType.NUMBER, description: "Amount of SOL to request (max 2)" },
      },
      required: [],
    },
  },
  {
    name: "send_sol",
    description: "Send SOL to another wallet address",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        to_address: { type: SchemaType.STRING, description: "Recipient Solana address" },
        amount: { type: SchemaType.NUMBER, description: "Amount of SOL to send" },
      },
      required: ["to_address", "amount"],
    },
  },
];
const walletTools: Tool[] = [{ functionDeclarations: walletToolDeclarations }];

// ─── Execute Tools ────────────────────────────────────────────────────────
async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: number
): Promise<string> {
  try {
    switch (toolName) {
      case "create_wallet": {
        const keypair = Keypair.generate();
        userWallets[userId] = keypair;
        return `Wallet created! Public Key: ${keypair.publicKey.toBase58()}`;
      }
      case "get_balance": {
        const keypair = userWallets[userId];
        if (!keypair) return "No wallet found. Please create a wallet first.";
        const balance = await connection.getBalance(keypair.publicKey);
        return `Balance: ${balance / LAMPORTS_PER_SOL} SOL`;
      }
      case "get_wallet_address": {
        const keypair = userWallets[userId];
        if (!keypair) return "No wallet found. Please create a wallet first.";
        return `Your wallet address: ${keypair.publicKey.toBase58()}`;
      }
      case "request_airdrop": {
        const keypair = userWallets[userId];
        if (!keypair) return "No wallet found. Please create a wallet first.";
        const amount = (toolInput.amount as number) || 1;
        const sig = await connection.requestAirdrop(
          keypair.publicKey,
          amount * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(sig);
        return `Airdrop of ${amount} SOL successful! Tx: ${sig}`;
      }
      case "send_sol": {
        const keypair = userWallets[userId];
        if (!keypair) return "No wallet found. Please create a wallet first.";
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: new PublicKey(toolInput.to_address as string),
            lamports: (toolInput.amount as number) * LAMPORTS_PER_SOL,
          })
        );
        const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
        return `Sent ${toolInput.amount} SOL! Tx: ${sig}`;
      }
      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

// ─── Run Agent ────────────────────────────────────────────────────────────
async function runAgent(userId: number, userMessage: string): Promise<string> {
  if (!userSessions[userId]) userSessions[userId] = [];

  userSessions[userId].push({ role: "user", parts: [{ text: userMessage }] });

  const systemPrompt = `You are an autonomous AI crypto wallet agent on Telegram. You help users manage their Solana wallets on devnet.
You can create wallets, check balances, request airdrops, and send SOL.
Be friendly, concise, and use emojis. Always confirm actions clearly.
This is Solana DEVNET - no real money involved, perfect for testing.
${userWallets[userId] ? `User's wallet: ${userWallets[userId].publicKey.toBase58()}` : "User has no wallet yet."}`;

  let finalResponse = "";

  while (true) {
    const result = await model.generateContent({
      contents: userSessions[userId],
      systemInstruction: systemPrompt,
      tools: walletTools,
      generationConfig: { maxOutputTokens: 1024 },
    });
    const response = result.response;
    const modelContent = response.candidates?.[0]?.content;

    if (!modelContent?.parts?.length) {
      if (!finalResponse) finalResponse = "I couldn't generate a response right now.";
      break;
    }

    const textParts = modelContent.parts
      .filter(
        (part): part is { text: string } => "text" in part && typeof part.text === "string"
      )
      .map((part) => part.text.trim())
      .filter(Boolean);
    if (textParts.length > 0) finalResponse = textParts.join("\n");

    userSessions[userId].push({ role: "model", parts: modelContent.parts });

    const functionCalls = response.functionCalls() ?? [];
    if (functionCalls.length === 0) {
      break;
    }

    const functionResponses: FunctionResponsePart[] = [];
    for (const call of functionCalls) {
      const result = await executeTool(
        call.name,
        (call.args ?? {}) as Record<string, unknown>,
        userId
      );
      functionResponses.push({
        functionResponse: {
          name: call.name,
          response: { result },
        },
      });
    }

    userSessions[userId].push({ role: "user", parts: functionResponses });
  }

  return finalResponse;
}

// ─── Bot Commands ─────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from?.first_name || "there";
  await bot.sendMessage(chatId,
    `👋 Hey ${name}! I'm your *Agentic Wallet Bot* on Solana Devnet!\n\n` +
    `Here's what I can do:\n` +
    `💼 Create your wallet\n` +
    `💰 Check your balance\n` +
    `🪂 Get free devnet SOL\n` +
    `💸 Send SOL to any address\n\n` +
    `Just talk to me naturally! Try saying:\n` +
    `_"Create me a wallet"_\n` +
    `_"What's my balance?"_\n` +
    `_"Send 0.1 SOL to [address]"_\n\n` +
    `Or type /help for commands 🚀`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `🤖 *Agentic Wallet Bot Commands*\n\n` +
    `/start - Welcome message\n` +
    `/wallet - Create or view your wallet\n` +
    `/balance - Check your SOL balance\n` +
    `/airdrop - Get 1 free devnet SOL\n` +
    `/reset - Reset your session\n\n` +
    `Or just *chat naturally* with me! 💬`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/wallet/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, "⏳ Processing...");
  const response = await runAgent(chatId, "Create me a new wallet or show my existing wallet address");
  await bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
});

bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, "⏳ Checking balance...");
  const response = await runAgent(chatId, "What is my current SOL balance?");
  await bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
});

bot.onText(/\/airdrop/, async (msg) => {
  const chatId = msg.chat.id;
  await bot.sendMessage(chatId, "⏳ Requesting airdrop...");
  const response = await runAgent(chatId, "Request an airdrop of 1 SOL for my wallet");
  await bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
});

bot.onText(/\/reset/, async (msg) => {
  const chatId = msg.chat.id;
  delete userSessions[chatId];
  await bot.sendMessage(chatId, "🔄 Session reset! Start fresh with /start");
});

// ─── Handle all other messages ────────────────────────────────────────────
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  if (!msg.text || msg.text.startsWith("/")) return;

  await bot.sendMessage(chatId, "⏳ Thinking...");

  try {
    const response = await runAgent(chatId, msg.text);
    await bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
  } catch (e) {
    await bot.sendMessage(chatId, `❌ Error: ${(e as Error).message}`);
  }
});

console.log("🤖 Agentic Wallet Telegram Bot is running...");
