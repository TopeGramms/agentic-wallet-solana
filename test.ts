import { AgenticWallet } from "../src/wallet/AgenticWallet";
import { TestDApp } from "../src/dapp/TestDApp";

async function runTests() {
  console.log("🧪 Running Agentic Wallet Tests...\n");
  let passed = 0;
  let failed = 0;

  // Test 1: Wallet creation
  try {
    console.log("Test 1: Wallet creation");
    const wallet = AgenticWallet.create();
    const pubKey = wallet.publicKey;
    if (pubKey && pubKey.length === 44) {
      console.log(`  ✅ PASS — Public key: ${pubKey}`);
      passed++;
    } else {
      throw new Error("Invalid public key length");
    }
  } catch (e) {
    console.log(`  ❌ FAIL — ${(e as Error).message}`);
    failed++;
  }

  // Test 2: Wallet info structure
  try {
    console.log("\nTest 2: Wallet info structure");
    const wallet = AgenticWallet.create();
    const info = await wallet.getWalletInfo();
    if (info.publicKey && typeof info.balance === "number") {
      console.log(`  ✅ PASS — Info retrieved: balance=${info.balance} SOL`);
      passed++;
    } else {
      throw new Error("Missing wallet info fields");
    }
  } catch (e) {
    console.log(`  ❌ FAIL — ${(e as Error).message}`);
    failed++;
  }

  // Test 3: dApp info
  try {
    console.log("\nTest 3: dApp initialization");
    const dapp = new TestDApp("TestSwap");
    const info = dapp.getInfo() as Record<string, unknown>;
    if (info.name === "TestSwap" && info.network === "devnet") {
      console.log(`  ✅ PASS — dApp initialized: ${info.name}`);
      passed++;
    } else {
      throw new Error("Invalid dApp info");
    }
  } catch (e) {
    console.log(`  ❌ FAIL — ${(e as Error).message}`);
    failed++;
  }

  // Test 4: Swap simulation (no network needed)
  try {
    console.log("\nTest 4: Swap simulation");
    const wallet = AgenticWallet.create();
    const dapp = new TestDApp();
    const result = await dapp.simulateSwap(wallet, "SOL", "USDC", 0.5);
    if (result.success) {
      console.log(`  ✅ PASS — ${result.message}`);
      passed++;
    } else {
      throw new Error("Swap simulation failed");
    }
  } catch (e) {
    console.log(`  ❌ FAIL — ${(e as Error).message}`);
    failed++;
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  if (failed === 0) {
    console.log("🎉 All tests passed!");
  }
}

runTests().catch(console.error);
