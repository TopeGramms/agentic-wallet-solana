import { SolanaAgentKit, KeypairWallet } from "solana-agent-kit";
import TokenPlugin from "@solana-agent-kit/plugin-token";
import MiscPlugin from "@solana-agent-kit/plugin-misc";
import { Keypair, Connection, clusterApiUrl, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import TelegramBot from "node-telegram-bot-api";
import bs58 from "bs58";
import * as dotenv from "dotenv";
import * as fs from "fs";

dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN!;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID!; // Your personal chat ID
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes
const MIN_BALANCE_SOL = 0.5; // Minimum balance before agent acts
const MAX_ACTIONS_PER_SESSION = 10; // Safety limit

// ─── Initialize Gemini ────────────────────────────────────────────────────
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });

// ─── Initialize Telegram (as observer only) ───────────────────────────────
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

async function notifyTelegram(message: string): Promise<void> {
  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: "Markdown" });
  } catch (e) {
    console.error("Telegram notification failed:", e);
  }
}

// ─── Load or create wallet ─────────────────────────────────────────────────
function loadOrCreateWallet(): Keypair {
  const walletFile = "./agent-wallet.json";

  if (fs.existsSync(walletFile)) {
    const data = JSON.parse(fs.readFileSync(walletFile, "utf-8"));
    const decoded = bs58.decode(data.privateKey);
    console.log(`✅ Loaded existing wallet: ${data.publicKey}`);
    return Keypair.fromSecretKey(decoded);
  }

  // Create new wallet
  const keypair = Keypair.generate();
  fs.writeFileSync(walletFile, JSON.stringify({
    publicKey: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
  }, null, 2));
  console.log(`✅ Created new wallet: ${keypair.publicKey.toBase58()}`);
  return keypair;
}

// ─── Agent Decision Engine ────────────────────────────────────────────────
async function makeDecision(
  balance: number,
  walletAddress: string,
  actionHistory: string[]
): Promise<{ action: string; reasoning: string }> {

  const historyText = actionHistory.length > 0
    ? `Recent actions taken:\n${actionHistory.slice(-5).join("\n")}`
    : "No actions taken yet in this session.";

  const prompt = `You are an autonomous AI crypto wallet agent on Solana devnet.

Current wallet state:
- Address: ${walletAddress}
- Balance: ${balance} SOL
- Network: Solana Devnet (test environment, no real money)
- Minimum safe balance: ${MIN_BALANCE_SOL} SOL

${historyText}

Based on the current state, decide what action to take next.
You must respond with ONLY a JSON object like this:
{
  "action": "one of: REQUEST_AIRDROP, HOLD, LOG_STATUS, DONE",
  "reasoning": "brief explanation of why you chose this action"
}

Rules:
- If balance < ${MIN_BALANCE_SOL} SOL, consider REQUEST_AIRDROP
- If balance is healthy, HOLD or LOG_STATUS
- If you've already requested an airdrop recently, choose HOLD
- Be conservative and thoughtful
- DONE means you're satisfied with current state`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();

  // Parse JSON response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed;
  }

  return { action: "HOLD", reasoning: "Could not parse decision, defaulting to hold" };
}

// ─── Execute Agent Action ──────────────────────────────────────────────────
async function executeAction(
  action: string,
  agent: SolanaAgentKit,
  keypair: Keypair,
  connection: Connection
): Promise<string> {
  switch (action) {
    case "REQUEST_AIRDROP": {
      try {
        const sig = await connection.requestAirdrop(
          keypair.publicKey,
          1 * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(sig);
        return `✅ Airdrop of 1 SOL successful! Tx: ${sig}`;
      } catch (e) {
        return `❌ Airdrop failed: ${(e as Error).message}`;
      }
    }
    case "HOLD": {
      return "💤 Agent decided to hold. No action needed.";
    }
    case "LOG_STATUS": {
      const balance = await connection.getBalance(keypair.publicKey);
      return `📊 Status logged. Balance: ${balance / LAMPORTS_PER_SOL} SOL`;
    }
    case "DONE": {
      return "✅ Agent is satisfied with current wallet state.";
    }
    default:
      return `❓ Unknown action: ${action}`;
  }
}

// ─── Main Autonomous Loop ─────────────────────────────────────────────────
async function runAutonomousAgent(): Promise<void> {
  console.log("🤖 Starting Autonomous Wallet Agent...");

  // Load wallet
  const keypair = loadOrCreateWallet();
  const wallet = new KeypairWallet(keypair);
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");

  // Initialize solana-agent-kit
  const agent = new SolanaAgentKit(
    wallet,
    clusterApiUrl("devnet"),
    {}
  )
    .use(TokenPlugin)
    .use(MiscPlugin);

  const actionHistory: string[] = [];
  let actionCount = 0;

  // Notify start
  const startMessage = `🤖 *Autonomous Wallet Agent Started!*\n\n` +
    `📍 Wallet: \`${keypair.publicKey.toBase58()}\`\n` +
    `🌐 Network: Solana Devnet\n` +
    `⏱️ Check interval: Every 5 minutes\n` +
    `🎯 Goal: Maintain wallet health autonomously\n\n` +
    `_I will notify you of every action I take!_`;

  await notifyTelegram(startMessage);
  console.log("✅ Agent started and Telegram notified!");

  // Autonomous loop
  while (true) {
    try {
      console.log(`\n🔄 Agent cycle ${actionCount + 1} starting...`);

      // Get current balance
      const balanceLamports = await connection.getBalance(keypair.publicKey);
      const balance = balanceLamports / LAMPORTS_PER_SOL;
      console.log(`💰 Current balance: ${balance} SOL`);

      // Make autonomous decision
      const decision = await makeDecision(
        balance,
        keypair.publicKey.toBase58(),
        actionHistory
      );

      console.log(`🧠 Decision: ${decision.action} — ${decision.reasoning}`);

      // Execute the decision
      const result = await executeAction(
        decision.action,
        agent,
        keypair,
        connection
      );

      // Log action
      const actionLog = `[${new Date().toISOString()}] ${decision.action}: ${result}`;
      actionHistory.push(actionLog);
      actionCount++;

      // Notify Telegram of what agent did
      const notification = `🤖 *Agent Action #${actionCount}*\n\n` +
        `🧠 *Decision:* ${decision.action}\n` +
        `💭 *Reasoning:* ${decision.reasoning}\n` +
        `📋 *Result:* ${result}\n` +
        `💰 *Balance:* ${balance} SOL\n` +
        `⏰ *Time:* ${new Date().toLocaleTimeString()}\n\n` +
        `_Next check in 5 minutes..._`;

      await notifyTelegram(notification);

      // Safety limit
      if (actionCount >= MAX_ACTIONS_PER_SESSION) {
        await notifyTelegram(`⚠️ *Max actions reached (${MAX_ACTIONS_PER_SESSION}). Agent pausing for safety.*`);
        console.log("Max actions reached, pausing...");
        break;
      }

      // Wait before next cycle
      console.log(`⏳ Waiting ${CHECK_INTERVAL_MS / 1000}s until next cycle...`);
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));

    } catch (error) {
      const errMsg = `❌ *Agent Error:* ${(error as Error).message}`;
      console.error(errMsg);
      await notifyTelegram(errMsg);
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
  }
}

// ─── Start the agent ──────────────────────────────────────────────────────
runAutonomousAgent().catch(async (error) => {
  console.error("Fatal error:", error);
  await notifyTelegram(`💀 *Agent crashed:* ${error.message}`);
});
