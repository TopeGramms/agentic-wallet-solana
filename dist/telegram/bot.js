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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const generative_ai_1 = require("@google/generative-ai");
const web3_js_1 = require("@solana/web3.js");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
// ─── Config ───────────────────────────────────────────────────────────────
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const bot = new node_telegram_bot_api_1.default(TELEGRAM_TOKEN, { polling: true });
const genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
// ─── In-memory wallet store per user ──────────────────────────────────────
const userWallets = {};
const userSessions = {};
const connection = new web3_js_1.Connection((0, web3_js_1.clusterApiUrl)("devnet"), "confirmed");
// ─── Wallet Tools ─────────────────────────────────────────────────────────
const walletToolDeclarations = [
    {
        name: "create_wallet",
        description: "Create a new Solana wallet for the user",
        parameters: { type: generative_ai_1.SchemaType.OBJECT, properties: {}, required: [] },
    },
    {
        name: "get_balance",
        description: "Get the current SOL balance of the user's wallet",
        parameters: { type: generative_ai_1.SchemaType.OBJECT, properties: {}, required: [] },
    },
    {
        name: "get_wallet_address",
        description: "Get the user's wallet public address",
        parameters: { type: generative_ai_1.SchemaType.OBJECT, properties: {}, required: [] },
    },
    {
        name: "request_airdrop",
        description: "Request free SOL airdrop on devnet for testing",
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                amount: { type: generative_ai_1.SchemaType.NUMBER, description: "Amount of SOL to request (max 2)" },
            },
            required: [],
        },
    },
    {
        name: "send_sol",
        description: "Send SOL to another wallet address",
        parameters: {
            type: generative_ai_1.SchemaType.OBJECT,
            properties: {
                to_address: { type: generative_ai_1.SchemaType.STRING, description: "Recipient Solana address" },
                amount: { type: generative_ai_1.SchemaType.NUMBER, description: "Amount of SOL to send" },
            },
            required: ["to_address", "amount"],
        },
    },
];
const walletTools = [{ functionDeclarations: walletToolDeclarations }];
// ─── Execute Tools ────────────────────────────────────────────────────────
async function executeTool(toolName, toolInput, userId) {
    try {
        switch (toolName) {
            case "create_wallet": {
                const keypair = web3_js_1.Keypair.generate();
                userWallets[userId] = keypair;
                return `Wallet created! Public Key: ${keypair.publicKey.toBase58()}`;
            }
            case "get_balance": {
                const keypair = userWallets[userId];
                if (!keypair)
                    return "No wallet found. Please create a wallet first.";
                const balance = await connection.getBalance(keypair.publicKey);
                return `Balance: ${balance / web3_js_1.LAMPORTS_PER_SOL} SOL`;
            }
            case "get_wallet_address": {
                const keypair = userWallets[userId];
                if (!keypair)
                    return "No wallet found. Please create a wallet first.";
                return `Your wallet address: ${keypair.publicKey.toBase58()}`;
            }
            case "request_airdrop": {
                const keypair = userWallets[userId];
                if (!keypair)
                    return "No wallet found. Please create a wallet first.";
                const amount = toolInput.amount || 1;
                const sig = await connection.requestAirdrop(keypair.publicKey, amount * web3_js_1.LAMPORTS_PER_SOL);
                await connection.confirmTransaction(sig);
                return `Airdrop of ${amount} SOL successful! Tx: ${sig}`;
            }
            case "send_sol": {
                const keypair = userWallets[userId];
                if (!keypair)
                    return "No wallet found. Please create a wallet first.";
                const tx = new web3_js_1.Transaction().add(web3_js_1.SystemProgram.transfer({
                    fromPubkey: keypair.publicKey,
                    toPubkey: new web3_js_1.PublicKey(toolInput.to_address),
                    lamports: toolInput.amount * web3_js_1.LAMPORTS_PER_SOL,
                }));
                const sig = await (0, web3_js_1.sendAndConfirmTransaction)(connection, tx, [keypair]);
                return `Sent ${toolInput.amount} SOL! Tx: ${sig}`;
            }
            default:
                return `Unknown tool: ${toolName}`;
        }
    }
    catch (e) {
        return `Error: ${e.message}`;
    }
}
// ─── Run Agent ────────────────────────────────────────────────────────────
async function runAgent(userId, userMessage) {
    if (!userSessions[userId])
        userSessions[userId] = [];
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
            if (!finalResponse)
                finalResponse = "I couldn't generate a response right now.";
            break;
        }
        const textParts = modelContent.parts
            .filter((part) => "text" in part && typeof part.text === "string")
            .map((part) => part.text.trim())
            .filter(Boolean);
        if (textParts.length > 0)
            finalResponse = textParts.join("\n");
        userSessions[userId].push({ role: "model", parts: modelContent.parts });
        const functionCalls = response.functionCalls() ?? [];
        if (functionCalls.length === 0) {
            break;
        }
        const functionResponses = [];
        for (const call of functionCalls) {
            const result = await executeTool(call.name, (call.args ?? {}), userId);
            functionResponses.push({
                functionResponse: {
                    name: call.name,
                    response: { result },
                },
            });
        }
        userSessions[userId].push({ role: "function", parts: functionResponses });
    }
    return finalResponse;
}
// ─── Bot Commands ─────────────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from?.first_name || "there";
    await bot.sendMessage(chatId, `👋 Hey ${name}! I'm your *Agentic Wallet Bot* on Solana Devnet!\n\n` +
        `Here's what I can do:\n` +
        `💼 Create your wallet\n` +
        `💰 Check your balance\n` +
        `🪂 Get free devnet SOL\n` +
        `💸 Send SOL to any address\n\n` +
        `Just talk to me naturally! Try saying:\n` +
        `_"Create me a wallet"_\n` +
        `_"What's my balance?"_\n` +
        `_"Send 0.1 SOL to [address]"_\n\n` +
        `Or type /help for commands 🚀`, { parse_mode: "Markdown" });
});
bot.onText(/\/help/, async (msg) => {
    await bot.sendMessage(msg.chat.id, `🤖 *Agentic Wallet Bot Commands*\n\n` +
        `/start - Welcome message\n` +
        `/wallet - Create or view your wallet\n` +
        `/balance - Check your SOL balance\n` +
        `/airdrop - Get 1 free devnet SOL\n` +
        `/reset - Reset your session\n\n` +
        `Or just *chat naturally* with me! 💬`, { parse_mode: "Markdown" });
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
    if (!msg.text || msg.text.startsWith("/"))
        return;
    await bot.sendMessage(chatId, "⏳ Thinking...");
    try {
        const response = await runAgent(chatId, msg.text);
        await bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
    }
    catch (e) {
        await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
});
console.log("🤖 Agentic Wallet Telegram Bot is running...");
//# sourceMappingURL=bot.js.map