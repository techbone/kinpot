// End-to-end smoke test of the whole family flow through the real API and relayer.
//
//   node scripts/e2e.mjs <baseUrl> <network> <walletsEnvFile>
//   node scripts/e2e.mjs http://localhost:3000 local ../.secrets/testnet-wallets.env
//
// Tobi starts a pot for the bursary, Tobi, Kemi and Femi each pay gaslessly, the bursary
// confirms, and the pot pays out. On `local` it fast-forwards anvil; elsewhere it uses
// "pay as soon as covered" timing and waits.
import { readFileSync } from "node:fs";
import { createPublicClient, encodeAbiParameters, encodeFunctionData, erc20Abi, http, keccak256, stringToBytes, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const [base = "http://localhost:3000", network = "local", envFile = "../.secrets/testnet-wallets.env"] = process.argv.slice(2);
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("=")),
);
const [tobi, kemi, femi, bursary] = ["TOBI", "KEMI", "FEMI", "BURSARY"].map((n) => privateKeyToAccount(env[`${n}_PRIVATE_KEY`]));

const chainId = { local: 31337, testnet: 10143, mainnet: 143 }[network];
const rpc = { local: "http://127.0.0.1:8545", testnet: "https://testnet-rpc.monad.xyz", mainnet: "https://rpc.monad.xyz" }[network];
const d = JSON.parse(readFileSync(new URL(`../../contracts/deployments/${chainId}.json`, import.meta.url), "utf8"));
const client = createPublicClient({ transport: http(rpc) });

const kinpotAbi = JSON.parse(readFileSync(new URL("../../contracts/out/Kinpot.sol/Kinpot.json", import.meta.url))).abi;
const forwarderAbi = JSON.parse(readFileSync(new URL("../../contracts/out/ERC2771Forwarder.sol/ERC2771Forwarder.json", import.meta.url))).abi;

// Deadlines follow chain time, which runs ahead of the wall clock after an anvil time jump.
const chainNow = async () => Number((await client.getBlock()).timestamp);

async function api(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(path.startsWith("/api/admin") ? { authorization: `Bearer ${process.env.ADMIN_TOKEN}` } : {}) },
    body: body ? JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${json.error}`);
  return json;
}

async function forward(account, functionName, args) {
  const data = encodeFunctionData({ abi: kinpotAbi, functionName, args });
  const nonce = await client.readContract({ address: d.forwarder, abi: forwarderAbi, functionName: "nonces", args: [account.address] });
  const message = { from: account.address, to: d.kinpot, value: 0n, gas: 250_000n, nonce, deadline: (await chainNow()) + 1800, data };
  const signature = await account.signTypedData({
    domain: { name: "Kinpot", version: "1", chainId, verifyingContract: d.forwarder },
    types: {
      ForwardRequest: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "gas", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint48" },
        { name: "data", type: "bytes" },
      ],
    },
    primaryType: "ForwardRequest",
    message,
  });
  return api("/api/relay", { network, action: "forward", request: { ...message, signature } });
}

async function contribute(account, potId, amount) {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const nonce = keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [potId, salt]));
  const validBefore = BigInt((await chainNow()) + 1800);
  const signature = await account.signTypedData({
    domain: { name: "Agora Dollar", version: "1", chainId, verifyingContract: d.ausd },
    types: {
      ReceiveWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "ReceiveWithAuthorization",
    message: { from: account.address, to: d.kinpot, value: amount, validAfter: 0n, validBefore, nonce },
  });
  return api("/api/relay", { network, action: "contribute", potId, from: account.address, amount, validAfter: 0n, validBefore, salt, signature });
}

const balance = (a) => client.readContract({ address: d.ausd, abi: erc20Abi, functionName: "balanceOf", args: [a] });
const step = (s) => console.log(`\n→ ${s}`);

step("Register the bursary as a verified payee");
await api("/api/admin/payees", { address: bursary.address, name: "Grace Model College Bursary", kind: "school", city: "Ibadan" });

step("Give Tobi, Kemi and Femi test AUSD (faucet)");
for (const a of [tobi, kemi, femi]) {
  if ((await balance(a.address)) < 300_000_000n) await api("/api/relay", { network, action: "faucet", to: a.address });
}

const bill = {
  v: 1,
  title: "Dayo's school fees, 2nd term",
  category: "school",
  payeeName: "Grace Model College Bursary",
  reference: "INV-2291 · Dayo Adeyemi · JSS2",
  note: "Bursary needs it before resumption.",
  shares: [
    { name: "Tobi", amount: "2000000" },
    { name: "Kemi", amount: "1500000" },
    { name: "Femi", amount: "1300000" },
  ],
};
const canonical = JSON.stringify(bill);
const now = Number((await client.getBlock()).timestamp);

step("Tobi starts a $4.80 pot (signature only, relayer pays gas)");
const created = await forward(tobi, "createPot", [bursary.address, 4_800_000n, now + 120, now + 3600, keccak256(stringToBytes(canonical))]);
const potId = BigInt(created.potId);
console.log(`  pot #${potId}  tx ${created.hash}`);
const { slug } = await api("/api/pots", { network, potId: potId.toString(), bill });
console.log(`  share link ${base}/p/${slug}`);

async function setName(account, name) {
  const signature = await account.signTypedData({
    domain: { name: "Kinpot", version: "1", chainId },
    types: { Profile: [{ name: "account", type: "address" }, { name: "name", type: "string" }] },
    primaryType: "Profile",
    message: { account: account.address, name },
  });
  await api("/api/profile", { network, address: account.address, name, signature });
}

async function claimShare(account, shareIndex) {
  const signature = await account.signTypedData({
    domain: { name: "Kinpot", version: "1", chainId },
    types: {
      ShareClaim: [
        { name: "account", type: "address" },
        { name: "potId", type: "uint256" },
        { name: "shareIndex", type: "uint256" },
      ],
    },
    primaryType: "ShareClaim",
    message: { account: account.address, potId, shareIndex: BigInt(shareIndex) },
  });
  await api("/api/claims", { network, potId: potId.toString(), shareIndex, address: account.address, signature });
}

step("Kemi, Femi and Tobi pay their shares with one signature each");
for (const [account, name, index, amount] of [
  [kemi, "Kemi", 1, 1_500_000n],
  [femi, "Femi", 2, 1_300_000n],
  [tobi, "Tobi", 0, 2_000_000n],
]) {
  await setName(account, name);
  console.log(`  ${name.toLowerCase()}`, (await contribute(account, potId, amount)).hash);
  await claimShare(account, index);
  // STOP_AFTER=kemi leaves a half-funded pot, handy for looking at the UI mid-flow.
  if (process.env.STOP_AFTER === name.toLowerCase()) {
    console.log(`\nStopped after ${name}. Pot: ${base}/p/${slug}`);
    process.exit(0);
  }
}

step("The bursary confirms the bill");
console.log("  ", (await forward(bursary, "confirmBill", [potId])).hash);

step("Wait for the due date");
if (network === "local") {
  await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [180] }) });
  await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "evm_mine", params: [] }) });
} else {
  while (!(await client.readContract({ address: d.kinpot, abi: kinpotAbi, functionName: "canRelease", args: [potId] }))) {
    await new Promise((r) => setTimeout(r, 5000));
  }
}

step("Anyone triggers the payment");
const before = await balance(bursary.address);
console.log("  ", (await api("/api/relay", { network, action: "release", potId })).hash);
const received = (await balance(bursary.address)) - before;
console.log(`\n✓ The bursary received ${Number(received) / 1e6} AUSD. Pot: ${base}/p/${slug}`);
if (received !== 4_800_000n) process.exit(1);
