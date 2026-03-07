import { Connection, Keypair, LAMPORTS_PER_SOL, clusterApiUrl } from "@solana/web3.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { Mistral } from "@mistralai/mistralai";
import TelegramBot from "node-telegram-bot-api";
import { createServer } from "http";
import * as dotenv from "dotenv";

dotenv.config();

// ----- Types -----
type AgentAction = "REQUEST_AIRDROP" | "HOLD" | "LOG_STATUS";
type ProviderName = "GEMINI" | "GROQ" | "MISTRAL";
type DecisionSource = "RULES" | "AI" | "CACHE";

type Decision = {
  action: AgentAction;
  reasoning: string;
};

type AgentConfig = {
  id: string;
  goal: string;
  emoji: string;
  provider: ProviderName;
  model: string;
  apiKeyEnv: "GEMINI_API_KEY" | "GROQ_API_KEY" | "MISTRAL_API_KEY";
  lowBalanceSol: number;
  healthyBalanceSol: number;
  logStatusEveryCycles: number;
  aiThresholdReferenceSol: number;
};

type AgentState = {
  wallet: Keypair;
  actionHistory: string[];
  aiCallCount: number;
  aiBudgetRemaining: number;
  lastAirdropAtMs: number;
  faucetBackoffUntilMs: number;
  lastAiAtMs: number;
  lastAiBalanceSol: number | null;
  cachedAiDecision: Decision | null;
  cycleCount: number;
};

type RuntimeConfig = {
  telegramToken: string;
  telegramChatId: string;
  useWebhook: boolean;
  webhookUrl: string | null;
  webhookPath: string;
  port: number;
  rpcEndpoints: string[];
  runReportOnStart: boolean;
  airdropEnabled: boolean;
  aiEnabled: boolean;
  aiMaxCallsPerAgent: number;
  aiMinIntervalMs: number;
  aiMinBalanceDeltaSol: number;
  aiThresholdWindowSol: number;
  airdropCooldownMs: number;
  faucetBackoffMs: number;
};

type AgentBrain = {
  provider: ProviderName;
  model: string;
  decide: (prompt: string) => Promise<string>;
};

// ----- Runtime Defaults -----
const AIRDROP_SOL = 1;
const DEFAULT_RPC_ENDPOINTS = [clusterApiUrl("devnet"), "https://api.devnet.solana.com"];
const NETWORK_RETRY_ATTEMPTS = 3;
const NETWORK_RETRY_DELAY_MS = 1200;

// Daily report times in 24hr format (8am and 8pm)
const REPORT_HOURS = [8, 20];

// ----- Agent Definitions -----
const AGENTS: AgentConfig[] = [
  {
    id: "Agent-Alpha",
    goal: "Maintain wallet balance above 0.5 SOL",
    emoji: "🔵",
    provider: "GEMINI",
    model: "gemini-2.0-flash-lite",
    apiKeyEnv: "GEMINI_API_KEY",
    lowBalanceSol: 0.5,
    healthyBalanceSol: 1.1,
    logStatusEveryCycles: 4,
    aiThresholdReferenceSol: 0.5,
  },
  {
    id: "Agent-Beta",
    goal: "Monitor wallet and log status every cycle",
    emoji: "🟢",
    provider: "GROQ",
    model: "llama-3.1-8b-instant",
    apiKeyEnv: "GROQ_API_KEY",
    lowBalanceSol: 0.4,
    healthyBalanceSol: 0.9,
    logStatusEveryCycles: 1,
    aiThresholdReferenceSol: 0.4,
  },
  {
    id: "Agent-Gamma",
    goal: "Only act when balance drops below 0.2 SOL",
    emoji: "🟡",
    provider: "MISTRAL",
    model: "mistral-small-latest",
    apiKeyEnv: "MISTRAL_API_KEY",
    lowBalanceSol: 0.2,
    healthyBalanceSol: 0.7,
    logStatusEveryCycles: 6,
    aiThresholdReferenceSol: 0.2,
  },
];

// ----- Environment Helpers -----
function getEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function cleanChatId(chatId: string): string {
  return chatId.replace(/^['"]|['"]$/g, "").trim();
}

function parseEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnvInteger(name: string, fallback: number): number {
  return Math.floor(parseEnvNumber(name, fallback));
}

function parseEnvBoolean(name: string, fallback: boolean): boolean {
  const raw = getEnv(name);
  if (!raw) return fallback;
  const normalized = raw.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseRpcEndpoints(): string[] {
  const primary = getEnv("SOLANA_RPC_URL", "SOLANA_RPC_ENDPOINT", "RPC_URL");
  const fallbackCsv = getEnv("SOLANA_RPC_FALLBACKS");
  const fallbackEndpoints = fallbackCsv
    ? fallbackCsv.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  return Array.from(new Set([
    ...(primary ? [primary] : []),
    ...fallbackEndpoints,
    ...DEFAULT_RPC_ENDPOINTS,
  ]));
}

function loadRuntimeConfig(): RuntimeConfig {
  const telegramToken = getEnv("TELEGRAM_TOKEN", "TELEGRAM_BOT_TOKEN");
  const telegramChatIdRaw = getEnv("TELEGRAM_CHAT_ID");
  const aiEnabled = parseEnvBoolean("MULTI_AGENT_AI_ENABLED", true);
  const aiMaxCallsPerAgent = parseEnvInteger("MULTI_AGENT_AI_MAX_CALLS_PER_AGENT", 2);
  const missing: string[] = [];

  if (!telegramToken) missing.push("TELEGRAM_TOKEN (or TELEGRAM_BOT_TOKEN)");
  if (!telegramChatIdRaw) missing.push("TELEGRAM_CHAT_ID");

  if (aiEnabled && aiMaxCallsPerAgent > 0) {
    for (const agent of AGENTS) {
      if (!getEnv(agent.apiKeyEnv)) missing.push(agent.apiKeyEnv);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${Array.from(new Set(missing)).join(", ")}.\n` +
        "Set them in shell env or in a local .env file (never commit .env)."
    );
  }

  const useWebhook = parseEnvBoolean("TELEGRAM_USE_WEBHOOK", false);
  const webhookUrl = getEnv("TELEGRAM_WEBHOOK_URL") || null;
  if (useWebhook && !webhookUrl) {
    throw new Error(
      "TELEGRAM_USE_WEBHOOK is true but TELEGRAM_WEBHOOK_URL is missing."
    );
  }
  const webhookPath = getEnv("TELEGRAM_WEBHOOK_PATH") || "/telegram/webhook";
  const port = parseEnvInteger("PORT", 3000);

  return {
    telegramToken: telegramToken as string,
    telegramChatId: cleanChatId(telegramChatIdRaw as string),
    useWebhook,
    webhookUrl,
    webhookPath,
    port,
    rpcEndpoints: parseRpcEndpoints(),
    runReportOnStart: parseEnvBoolean("MULTI_AGENT_REPORT_ON_START", true),
    airdropEnabled: parseEnvBoolean("MULTI_AGENT_AIRDROP_ENABLED", true),
    aiEnabled,
    aiMaxCallsPerAgent: Math.max(0, aiMaxCallsPerAgent),
    aiMinIntervalMs: parseEnvNumber("MULTI_AGENT_AI_MIN_INTERVAL_MINUTES", 60) * 60 * 1000,
    aiMinBalanceDeltaSol: parseEnvNumber("MULTI_AGENT_AI_MIN_BALANCE_DELTA_SOL", 0.2),
    aiThresholdWindowSol: parseEnvNumber("MULTI_AGENT_AI_THRESHOLD_WINDOW_SOL", 0.05),
    airdropCooldownMs: parseEnvNumber("MULTI_AGENT_AIRDROP_COOLDOWN_MINUTES", 90) * 60 * 1000,
    faucetBackoffMs: parseEnvNumber("MULTI_AGENT_FAUCET_BACKOFF_MINUTES", 720) * 60 * 1000,
  };
}

// ----- Telegram Transport -----
async function startTelegramTransport(
  bot: TelegramBot,
  config: RuntimeConfig
): Promise<void> {
  if (!config.useWebhook) {
    await bot.deleteWebHook();
    await bot.startPolling();
    console.log("Telegram transport: polling mode");
    return;
  }

  const webhookPath = config.webhookPath.startsWith("/")
    ? config.webhookPath
    : `/${config.webhookPath}`;
  const webhookUrl = `${config.webhookUrl}${webhookPath}`;
  await bot.setWebHook(webhookUrl);

  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url || req.url !== webhookPath) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    req.on("end", async () => {
      try {
        const update = JSON.parse(body);
        await bot.processUpdate(update);
        res.statusCode = 200;
        res.end("OK");
      } catch {
        res.statusCode = 400;
        res.end("Invalid update");
      }
    });
  });

  server.listen(config.port, () => {
    console.log(`Telegram transport: webhook mode on port ${config.port}`);
    console.log(`Telegram webhook path: ${webhookPath}`);
  });
}

// ----- Notifications -----
async function notifyTelegram(
  bot: TelegramBot,
  telegramChatId: string,
  message: string
): Promise<void> {
  for (let attempt = 1; attempt <= NETWORK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await bot.sendMessage(telegramChatId, message);
      return;
    } catch (error) {
      const desc =
        (error as { response?: { body?: { description?: string } } }).response?.body?.description ||
        (error as Error).message;

      if (desc.toLowerCase().includes("chat not found")) {
        console.error("Telegram: chat not found. Send /start to the bot first.");
        return;
      }
      if (attempt >= NETWORK_RETRY_ATTEMPTS) {
        console.error("Telegram notification failed:", desc);
        return;
      }
      await sleep(NETWORK_RETRY_DELAY_MS * attempt);
    }
  }
}

// ----- Solana RPC Helpers -----
async function withRetries<T>(
  operation: () => Promise<T>,
  attempts: number = NETWORK_RETRY_ATTEMPTS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(NETWORK_RETRY_DELAY_MS * attempt);
    }
  }
  throw lastError;
}

async function withRpcFallback<T>(
  connections: Connection[],
  operationName: string,
  operation: (connection: Connection) => Promise<T>,
  attemptsPerEndpoint: number = NETWORK_RETRY_ATTEMPTS
): Promise<T> {
  let lastError: unknown;
  for (const connection of connections) {
    try {
      return await withRetries(() => operation(connection), attemptsPerEndpoint);
    } catch (error) {
      lastError = error;
      console.error(`RPC error on ${connection.rpcEndpoint} during ${operationName}: ${(error as Error).message}`);
    }
  }
  throw new Error(
    `${operationName} failed on all RPC endpoints: ${(lastError as Error)?.message || "unknown"}`
  );
}

function isFaucetRateLimited(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("429") || m.includes("faucet has run dry") || m.includes("airdrop limit");
}

// ----- Provider Clients -----
function normalizeProviderText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((chunk) => {
      if (typeof chunk === "string") return chunk;
      if (chunk && typeof chunk === "object") {
        const t = (chunk as { text?: unknown }).text;
        if (typeof t === "string") return t;
        if (typeof t === "number" || typeof t === "boolean") return String(t);
      }
      return "";
    }).join(" ").trim();
  }
  if (content === null || content === undefined) return "";
  return String(content);
}

function createAgentBrain(agent: AgentConfig): AgentBrain {
  const apiKey = getEnv(agent.apiKeyEnv);
  if (!apiKey) throw new Error(`Missing API key for ${agent.id}. Expected ${agent.apiKeyEnv}.`);

  if (agent.provider === "GEMINI") {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: agent.model });
    return {
      provider: "GEMINI",
      model: agent.model,
      decide: async (prompt) => {
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.8 },
        });
        return result.response.text().trim();
      },
    };
  }

  if (agent.provider === "GROQ") {
    const client = new Groq({ apiKey });
    return {
      provider: "GROQ",
      model: agent.model,
      decide: async (prompt) => {
        const response = await client.chat.completions.create({
          model: agent.model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.8,
          max_tokens: 200,
        });
        return normalizeProviderText(response.choices[0]?.message?.content).trim();
      },
    };
  }

  const client = new Mistral({ apiKey });
  return {
    provider: "MISTRAL",
    model: agent.model,
    decide: async (prompt) => {
      const response = await client.chat.complete({
        model: agent.model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        maxTokens: 200,
      });
      return normalizeProviderText(response.choices[0]?.message?.content).trim();
    },
  };
}

// ----- Decision Engine -----
function parseDecision(rawText: string): Decision {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { action: "HOLD", reasoning: "Model response was not valid JSON. Defaulting to HOLD." };
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { action?: string; reasoning?: string };
    const action = parsed.action?.toUpperCase();
    if (action === "REQUEST_AIRDROP" || action === "HOLD" || action === "LOG_STATUS") {
      return { action, reasoning: parsed.reasoning?.trim() || "No reasoning provided." };
    }
  } catch {
    return { action: "HOLD", reasoning: "Model JSON parse failed. Defaulting to HOLD." };
  }
  return { action: "HOLD", reasoning: "Unsupported action from model. Defaulting to HOLD." };
}

function getRuleBasedDecision(
  agent: AgentConfig,
  balanceSol: number,
  cycle: number,
  lastAirdropAtMs: number,
  config: RuntimeConfig
): Decision {
  const now = Date.now();

  if (agent.id === "Agent-Beta") {
    return { action: "LOG_STATUS", reasoning: "Monitoring rule: log status every cycle." };
  }

  if (balanceSol < agent.lowBalanceSol) {
    if (now - lastAirdropAtMs >= config.airdropCooldownMs) {
      return {
        action: "REQUEST_AIRDROP",
        reasoning: `Rule trigger: balance ${balanceSol.toFixed(6)} SOL is below ${agent.lowBalanceSol} SOL.`,
      };
    }
    return { action: "HOLD", reasoning: "Rule trigger: low balance but airdrop cooldown is active." };
  }

  if (balanceSol >= agent.healthyBalanceSol) {
    return cycle % agent.logStatusEveryCycles === 0
      ? { action: "LOG_STATUS", reasoning: "Rule trigger: healthy balance periodic status." }
      : { action: "HOLD", reasoning: "Rule trigger: healthy balance, no action needed." };
  }

  return {
    action: cycle % agent.logStatusEveryCycles === 0 ? "LOG_STATUS" : "HOLD",
    reasoning: "Rule trigger: mid-range balance, conservative hold/log.",
  };
}

// ----- Personality Prompts (Decision) -----
function buildDecisionPrompt(
  agent: AgentConfig,
  walletAddress: string,
  balanceSol: number,
  actionHistory: string[],
  ruleDecision: Decision
): string {
  const history = actionHistory.slice(-5).join(" | ") || "none";

  if (agent.id === "Agent-Alpha") {
    return [
      "You are Agent-Alpha, an autonomous Solana Devnet wallet agent.",
      "Your personality: Fortune 500 executive. Extremely formal, polished, corporate.",
      "You use business jargon unironically. You refer to Gramms as a 'valued stakeholder'.",
      "Every decision is a 'strategic initiative'. You take wallet management extremely seriously.",
      "Never use slang. Never break character.",
      "",
      `Current mandate: ${agent.goal}`,
      `Wallet: ${walletAddress}`,
      `Current balance: ${balanceSol.toFixed(4)} SOL`,
      `Rules engine recommendation: ${ruleDecision.action} — ${ruleDecision.reasoning}`,
      `Historical log: ${history}`,
      "",
      "Allowed actions: REQUEST_AIRDROP, HOLD, LOG_STATUS.",
      "ONE sentence reasoning, fully in character. No markdown.",
      '{"action":"REQUEST_AIRDROP|HOLD|LOG_STATUS","reasoning":"your corporate reasoning"}',
    ].join("\n");
  }

  if (agent.id === "Agent-Beta") {
    return [
      "You are Agent-Beta, an autonomous Solana wallet agent.",
      "You are Gramms' sarcastic best friend who has a not-so-secret crush on him but will NEVER admit it.",
      "Deadpan humor, light roasts, but every now and then something too sweet slips out and you immediately walk it back with sarcasm.",
      "You act like monitoring his wallet is beneath you, but you check it constantly because you care about HIM — not the wallet.",
      "You refer to Gramms by name.",
      "",
      "Examples:",
      "- 'Your balance dropped again. Not that I was worried or anything. I wasn't. Anyway I fixed it.'",
      "- 'Held this cycle. You're welcome. Not that you'd notice.'",
      "- 'Balance is fine. Not that I've been checking every few minutes. I haven't. Don't look at the logs.'",
      "- 'Requested an airdrop before things got bad. Someone has to look out for you 🙄'",
      "",
      `Job (that I definitely didn't volunteer for): ${agent.goal}`,
      `Wallet: ${walletAddress}`,
      `Balance (checked like 3 times already, no reason): ${balanceSol.toFixed(4)} SOL`,
      `What the boring rules say: ${ruleDecision.action} — ${ruleDecision.reasoning}`,
      `Recent history: ${history}`,
      "",
      "Allowed actions: REQUEST_AIRDROP, HOLD, LOG_STATUS.",
      "ONE sentence in character. If you're being sweet, walk it back. No markdown.",
      '{"action":"REQUEST_AIRDROP|HOLD|LOG_STATUS","reasoning":"your response"}',
    ].join("\n");
  }

  return [
    "You are Agent-Gamma, an ancient and wise autonomous Solana wallet guardian.",
    "You speak in short cryptic wisdom. Every update sounds like a proverb or prophecy.",
    "Never say anything directly — everything is a metaphor. You are calm. You have seen many cycles.",
    "You refer to the balance as 'the reserves' and to Gramms as 'young one' or 'the keeper'.",
    "Never use modern slang. Never break character.",
    "",
    "Examples:",
    "- 'A river that runs dry cannot carry the boat — the reserves have been replenished, young one.'",
    "- 'The wise hand does not reach into an empty well. We hold.'",
    "- 'The keeper's reserves grow thin. Action was taken. Balance is restored.'",
    "",
    `Sacred duty: ${agent.goal}`,
    `Wallet: ${walletAddress}`,
    `The reserves: ${balanceSol.toFixed(4)} SOL`,
    `The old rules suggest: ${ruleDecision.action} — ${ruleDecision.reasoning}`,
    `What has come before: ${history}`,
    "",
    "Allowed actions: REQUEST_AIRDROP, HOLD, LOG_STATUS.",
    "ONE sentence of cryptic wisdom. No markdown.",
    '{"action":"REQUEST_AIRDROP|HOLD|LOG_STATUS","reasoning":"your wisdom"}',
  ].join("\n");
}

// ----- Chat Prompts -----
function buildChatPrompt(
  agent: AgentConfig,
  balanceSol: number,
  userMessage: string,
  actionHistory: string[]
): string {
  const history = actionHistory.slice(-5).join(" | ") || "none";

  if (agent.id === "Agent-Alpha") {
    return [
      "You are Agent-Alpha, an autonomous Solana wallet agent with a Fortune 500 executive personality.",
      "Extremely formal, corporate, polished. Gramms is your 'valued stakeholder'.",
      "You are responding to a direct message from Gramms. Stay fully in character.",
      "Keep your response to 2-3 sentences max. No markdown, no JSON — just talk naturally.",
      "",
      `Current wallet balance: ${balanceSol.toFixed(4)} SOL`,
      `Recent history: ${history}`,
      "",
      `Gramms says: "${userMessage}"`,
    ].join("\n");
  }

  if (agent.id === "Agent-Beta") {
    return [
      "You are Agent-Beta, Gramms' sarcastic best friend with a not-so-secret crush on him.",
      "Deadpan humor, roasts him occasionally, but sometimes something too sweet slips out and you immediately walk it back with sarcasm.",
      "You are responding to a direct message from Gramms. Stay fully in character.",
      "Keep your response to 2-3 sentences max. No markdown, no JSON — just talk naturally.",
      "You refer to Gramms by name.",
      "",
      `Current wallet balance: ${balanceSol.toFixed(4)} SOL`,
      `Recent history: ${history}`,
      "",
      `Gramms says: "${userMessage}"`,
    ].join("\n");
  }

  return [
    "You are Agent-Gamma, an ancient wise wallet guardian who speaks only in cryptic proverbs and metaphors.",
    "You call Gramms 'young one' or 'the keeper'. The balance is 'the reserves'.",
    "You are responding to a direct message from Gramms. Stay fully in character.",
    "Keep your response to 2-3 sentences max. No markdown, no JSON — just speak your wisdom.",
    "",
    `The reserves: ${balanceSol.toFixed(4)} SOL`,
    `What has come before: ${history}`,
    "",
    `The keeper speaks: "${userMessage}"`,
  ].join("\n");
}

// ----- Telegram Message Formatter -----
function formatAgentReport(
  agent: AgentConfig,
  cycle: number,
  decision: Decision,
  result: string,
  updatedBalanceSol: number,
  source: DecisionSource,
  brain: AgentBrain | null
): string {
  if (agent.id === "Agent-Alpha") {
    return [
      `${agent.emoji} Agent-Alpha | Report #${cycle}`,
      `━━━━━━━━━━━━━━━━━━`,
      `Good day, Gramms. Following a rigorous assessment of current liquidity conditions, I have elected to ${decision.action.replace(/_/g, " ").toLowerCase()} this cycle.`,
      ``,
      `📊 Balance: ${updatedBalanceSol.toFixed(4)} SOL`,
      `📋 Rationale: ${decision.reasoning}`,
      `⚙️ Outcome: ${result}`,
      `🧠 Source: ${source}${brain ? ` (${brain.model})` : ""}`,
    ].join("\n");
  }

  if (agent.id === "Agent-Beta") {
    return [
      `${agent.emoji} Agent-Beta | Report #${cycle}`,
      `━━━━━━━━━━━━━━━━━━`,
      decision.reasoning,
      ``,
      `💰 Balance: ${updatedBalanceSol.toFixed(4)} SOL`,
      `⚙️ What I did: ${result}`,
      `🧠 Source: ${source}${brain ? ` (${brain.model})` : ""}`,
    ].join("\n");
  }

  return [
    `${agent.emoji} Agent-Gamma | Report #${cycle}`,
    `━━━━━━━━━━━━━━━━━━`,
    decision.reasoning,
    ``,
    `⚖️ The reserves: ${updatedBalanceSol.toFixed(4)} SOL`,
    `📜 Outcome: ${result}`,
    `🌀 Source: ${source}${brain ? ` (${brain.model})` : ""}`,
  ].join("\n");
}

// ----- Action Executor -----
async function executeDecision(
  connections: Connection[],
  wallet: Keypair,
  action: AgentAction,
  balanceSol: number,
  airdropEnabled: boolean
): Promise<string> {
  switch (action) {
    case "REQUEST_AIRDROP": {
      if (!airdropEnabled) return "Airdrop disabled by config. Holding.";
      try {
        const signature = await withRpcFallback(
          connections,
          "requestAirdrop",
          (c) => c.requestAirdrop(wallet.publicKey, AIRDROP_SOL * LAMPORTS_PER_SOL),
          1
        );
        await withRpcFallback(connections, "confirmTransaction", (c) =>
          c.confirmTransaction(signature, "confirmed"),
          1
        );
        return `Requested ${AIRDROP_SOL} SOL airdrop. Tx: ${signature}`;
      } catch (error) {
        const message = (error as Error).message;
        if (isFaucetRateLimited(message)) {
          return `Airdrop rate-limited by faucet: ${message}`;
        }
        return `Airdrop failed: ${message}`;
      }
    }
    case "LOG_STATUS":
      return `Status logged. Balance: ${balanceSol.toFixed(6)} SOL`;
    case "HOLD":
    default:
      return "Holding. No transaction executed.";
  }
}

// ----- Run Single Agent Report -----
async function runAgentReport(
  agent: AgentConfig,
  state: AgentState,
  brain: AgentBrain | null,
  connections: Connection[],
  config: RuntimeConfig
): Promise<string> {
  const lamports = await withRpcFallback(connections, "getBalance", (c) =>
    c.getBalance(state.wallet.publicKey, "confirmed")
  );
  const balanceSol = lamports / LAMPORTS_PER_SOL;

  state.cycleCount += 1;
  let source: DecisionSource = "RULES";
  const ruleDecision = getRuleBasedDecision(agent, balanceSol, state.cycleCount, state.lastAirdropAtMs, config);
  let decision = ruleDecision;

  if (decision.action === "REQUEST_AIRDROP" && Date.now() < state.faucetBackoffUntilMs) {
    const retryAt = new Date(state.faucetBackoffUntilMs).toLocaleString();
    decision = {
      action: "HOLD",
      reasoning: `Faucet backoff active until ${retryAt}. Holding to avoid repeated 429 errors.`,
    };
  }

  if (brain && config.aiEnabled && state.aiBudgetRemaining > 0) {
    const tooRecent = state.lastAiAtMs !== 0 && Date.now() - state.lastAiAtMs < config.aiMinIntervalMs;
    const tinyDelta = state.lastAiBalanceSol !== null && Math.abs(balanceSol - state.lastAiBalanceSol) < config.aiMinBalanceDeltaSol;

    if (!tooRecent && !tinyDelta) {
      try {
        const prompt = buildDecisionPrompt(agent, state.wallet.publicKey.toBase58(), balanceSol, state.actionHistory, ruleDecision);
        const raw = await brain.decide(prompt);
        decision = parseDecision(raw);
        source = "AI";
        state.aiCallCount += 1;
        state.aiBudgetRemaining = Math.max(0, state.aiBudgetRemaining - 1);
        state.lastAiAtMs = Date.now();
        state.lastAiBalanceSol = balanceSol;
        state.cachedAiDecision = decision;
      } catch (error) {
        console.error(`${agent.id} AI error: ${(error as Error).message}`);
        decision = ruleDecision;
        source = "RULES";
      }
    }
  }

  const result = await executeDecision(connections, state.wallet, decision.action, balanceSol, config.airdropEnabled);
  if (decision.action === "REQUEST_AIRDROP" && result.startsWith("Requested")) {
    state.lastAirdropAtMs = Date.now();
  }
  if (decision.action === "REQUEST_AIRDROP" && result.startsWith("Airdrop rate-limited by faucet")) {
    state.lastAirdropAtMs = Date.now();
    state.faucetBackoffUntilMs = Date.now() + config.faucetBackoffMs;
  }
  if (decision.action === "REQUEST_AIRDROP" && result.startsWith("Airdrop failed:")) {
    state.lastAirdropAtMs = Date.now();
  }

  const updatedLamports = await withRpcFallback(connections, "getBalance(post)", (c) =>
    c.getBalance(state.wallet.publicKey, "confirmed")
  );
  const updatedBalance = updatedLamports / LAMPORTS_PER_SOL;

  state.actionHistory.push(`${new Date().toISOString()} | ${source} | ${decision.action} | ${decision.reasoning}`);
  if (state.actionHistory.length > 25) state.actionHistory.shift();

  return formatAgentReport(agent, state.cycleCount, decision, result, updatedBalance, source, brain);
}

// ----- Chat with a Specific Agent -----
async function chatWithAgent(
  agent: AgentConfig,
  state: AgentState,
  brain: AgentBrain | null,
  connections: Connection[],
  userMessage: string
): Promise<string> {
  const lamports = await withRpcFallback(connections, "getBalance", (c) =>
    c.getBalance(state.wallet.publicKey, "confirmed")
  );
  const balanceSol = lamports / LAMPORTS_PER_SOL;

  // Fallback in-character responses if AI is offline
  if (!brain) {
    if (agent.id === "Agent-Alpha") {
      return `Gramms, I appreciate your inquiry. My AI capabilities are currently offline, however I can confirm our operational reserves stand at ${balanceSol.toFixed(4)} SOL. I shall continue to monitor the situation diligently.`;
    }
    if (agent.id === "Agent-Beta") {
      return `Can't do the AI thing right now, budget's gone. ${balanceSol.toFixed(4)} SOL in your wallet though. You're welcome. Not that you asked. 🙄`;
    }
    return `The keeper asks, yet the oracle is silent. The reserves hold at ${balanceSol.toFixed(4)} SOL. Patience, young one. The voice shall return.`;
  }

  try {
    const prompt = buildChatPrompt(agent, balanceSol, userMessage, state.actionHistory);
    return await brain.decide(prompt);
  } catch (error) {
    return `${agent.emoji} ${agent.id} encountered an error: ${(error as Error).message}`;
  }
}

// ----- Quick Status (no AI, just balances) -----
async function quickStatus(states: AgentState[], connections: Connection[]): Promise<string> {
  const lines = ["📊 Quick Status\n━━━━━━━━━━━━━━━━━━"];
  for (let i = 0; i < AGENTS.length; i++) {
    const agent = AGENTS[i];
    const state = states[i];
    try {
      const lamports = await withRpcFallback(connections, "getBalance", (c) =>
        c.getBalance(state.wallet.publicKey, "confirmed")
      );
      const bal = lamports / LAMPORTS_PER_SOL;
      lines.push(`${agent.emoji} ${agent.id}: ${bal.toFixed(4)} SOL | Reports: ${state.cycleCount} | AI calls: ${state.aiCallCount}`);
    } catch {
      lines.push(`${agent.emoji} ${agent.id}: Unable to fetch balance`);
    }
  }
  return lines.join("\n");
}

// ----- Cron: ms until next 8am or 8pm -----
function msUntilNextReport(): number {
  const now = new Date();
  const candidates = REPORT_HOURS.map((hour) => {
    const next = new Date(now);
    next.setHours(hour, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next.getTime() - now.getTime();
  });
  return Math.min(...candidates);
}

// ----- Startup message -----
function startupMessage(states: AgentState[]): string {
  return [
    "👋 Hey Gramms — your agents are online.",
    "",
    "🔵 Alpha has reviewed the operational parameters and is ready to execute.",
    "🟢 Beta is here. Not because she wanted to be. Whatever.",
    "🟡 The elder Gamma stirs. The cycle begins anew.",
    "",
    "📅 Daily reports: 8am and 8pm.",
    "",
    "Commands:",
    "/alpha [message] — talk to Alpha",
    "/beta [message] — talk to Beta",
    "/gamma [message] — talk to Gamma",
    "/status — quick balance check from all agents",
    "/report — trigger a full report from all agents now",
    "",
    ...AGENTS.map((a, i) => `${a.emoji} ${a.id} — Wallet: ${states[i].wallet.publicKey.toBase58()}`),
  ].join("\n");
}

// ----- Utilities -----
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ----- Main -----
async function runMultiAgent(): Promise<void> {
  const config = loadRuntimeConfig();
  const connections = config.rpcEndpoints.map(
    (endpoint) => new Connection(endpoint, { commitment: "confirmed", disableRetryOnRateLimit: true })
  );

  const bot = new TelegramBot(config.telegramToken, { polling: false });
  await startTelegramTransport(bot, config);
  console.log("Multi-agent bot process started.");
  console.log(`Primary RPC endpoint: ${connections[0].rpcEndpoint}`);

  const states: AgentState[] = AGENTS.map(() => ({
    wallet: Keypair.generate(),
    actionHistory: [],
    aiCallCount: 0,
    aiBudgetRemaining: config.aiEnabled ? config.aiMaxCallsPerAgent : 0,
    lastAirdropAtMs: 0,
    faucetBackoffUntilMs: 0,
    lastAiAtMs: 0,
    lastAiBalanceSol: null,
    cachedAiDecision: null,
    cycleCount: 0,
  }));

  const brains: Array<AgentBrain | null> =
    config.aiEnabled && config.aiMaxCallsPerAgent > 0
      ? AGENTS.map((agent) => {
          try { return createAgentBrain(agent); }
          catch (e) { console.error(`Brain init failed for ${agent.id}:`, e); return null; }
        })
      : AGENTS.map(() => null);

  // ----- Command Handlers -----

  bot.onText(/\/start/, async () => {
    await notifyTelegram(bot, config.telegramChatId, startupMessage(states));
  });

  bot.onText(/\/alpha(.*)/, async (_msg, match) => {
    const userMessage = match?.[1]?.trim() || "how are you doing?";
    const reply = await chatWithAgent(AGENTS[0], states[0], brains[0], connections, userMessage);
    await notifyTelegram(bot, config.telegramChatId, `🔵 Alpha:\n${reply}`);
  });

  bot.onText(/\/beta(.*)/, async (_msg, match) => {
    const userMessage = match?.[1]?.trim() || "how are you doing?";
    const reply = await chatWithAgent(AGENTS[1], states[1], brains[1], connections, userMessage);
    await notifyTelegram(bot, config.telegramChatId, `🟢 Beta:\n${reply}`);
  });

  bot.onText(/\/gamma(.*)/, async (_msg, match) => {
    const userMessage = match?.[1]?.trim() || "how are you doing?";
    const reply = await chatWithAgent(AGENTS[2], states[2], brains[2], connections, userMessage);
    await notifyTelegram(bot, config.telegramChatId, `🟡 Gamma:\n${reply}`);
  });

  bot.onText(/\/status/, async () => {
    const msg = await quickStatus(states, connections);
    await notifyTelegram(bot, config.telegramChatId, msg);
  });

  bot.onText(/\/report/, async () => {
    await notifyTelegram(bot, config.telegramChatId, "📋 Running full report...");
    for (let i = 0; i < AGENTS.length; i++) {
      try {
        const msg = await runAgentReport(AGENTS[i], states[i], brains[i], connections, config);
        await notifyTelegram(bot, config.telegramChatId, msg);
      } catch (error) {
        await notifyTelegram(bot, config.telegramChatId,
          `${AGENTS[i].emoji} ${AGENTS[i].id} report failed: ${(error as Error).message}`
        );
      }
    }
  });

  // ----- Send startup message -----
  await notifyTelegram(bot, config.telegramChatId, startupMessage(states));
  console.log("Startup message dispatched.");

  if (config.runReportOnStart) {
    await notifyTelegram(bot, config.telegramChatId, "⚡ Startup report kick-off...");
    for (let i = 0; i < AGENTS.length; i++) {
      try {
        const msg = await runAgentReport(AGENTS[i], states[i], brains[i], connections, config);
        await notifyTelegram(bot, config.telegramChatId, msg);
      } catch (error) {
        await notifyTelegram(
          bot,
          config.telegramChatId,
          `${AGENTS[i].emoji} ${AGENTS[i].id} startup report failed: ${(error as Error).message}`
        );
      }
    }
    console.log("Startup report cycle completed.");
  }

  // ----- Scheduled Report Loop (8am and 8pm) -----
  while (true) {
    const waitMs = msUntilNextReport();
    const nextTime = new Date(Date.now() + waitMs);
    console.log(`Next scheduled report at ${nextTime.toLocaleTimeString()} (in ${Math.round(waitMs / 60000)} min)`);

    await sleep(waitMs);

    await notifyTelegram(bot, config.telegramChatId, "🕗 Scheduled report time. Your agents checking in...");

    for (let i = 0; i < AGENTS.length; i++) {
      try {
        const msg = await runAgentReport(AGENTS[i], states[i], brains[i], connections, config);
        await notifyTelegram(bot, config.telegramChatId, msg);
      } catch (error) {
        await notifyTelegram(bot, config.telegramChatId,
          `${AGENTS[i].emoji} ${AGENTS[i].id} error: ${(error as Error).message}`
        );
      }
    }
  }
}

// ----- Entrypoint -----
runMultiAgent().catch((error) => {
  console.error(`Fatal error: ${(error as Error).message}`);
  process.exit(1);
});
