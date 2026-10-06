"use client";

import { encodeFunctionData, toHex, type Address, type Hex, type TypedDataDefinition } from "viem";

import { forwarderAbi, kinpotAbi } from "./abi";
import { authorizationNonce } from "./kinpot";
import { networks, publicClient, type NetworkKey } from "./networks";

export type RelayResult = { hash: Hex; potId?: string };

type Signer = { address: Address; signTypedData: (data: TypedDataDefinition) => Promise<Hex> };

async function post(body: Record<string, unknown>): Promise<RelayResult> {
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  });
  const json = (await res.json()) as RelayResult & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "The request failed.");
  return json;
}

function deployment(network: NetworkKey) {
  const d = networks[network].deployment;
  if (!d) throw new Error(`Kinpot isn't deployed on ${networks[network].label} yet.`);
  return d;
}

/** Signs an ERC-2771 ForwardRequest for a Kinpot call and has the relayer submit it. */
async function forward(network: NetworkKey, signer: Signer, data: Hex, gas: bigint): Promise<RelayResult> {
  const d = deployment(network);
  const client = publicClient(network);
  const nonce = await client.readContract({
    address: d.forwarder,
    abi: forwarderAbi,
    functionName: "nonces",
    args: [signer.address],
  });
  const deadline = Math.floor(Date.now() / 1000) + 30 * 60;
  const message = { from: signer.address, to: d.kinpot, value: 0n, gas, nonce, deadline, data };
  const signature = await signer.signTypedData({
    domain: { name: "Kinpot", version: "1", chainId: networks[network].chain.id, verifyingContract: d.forwarder },
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
  return post({ network, action: "forward", request: { ...message, signature } });
}

export function createPot(
  network: NetworkKey,
  signer: Signer,
  args: { payee: Address; target: bigint; dueAt: number; expiresAt: number; billHash: Hex },
) {
  const data = encodeFunctionData({
    abi: kinpotAbi,
    functionName: "createPot",
    args: [args.payee, args.target, args.dueAt, args.expiresAt, args.billHash],
  });
  return forward(network, signer, data, 250_000n);
}

export function confirmBill(network: NetworkKey, signer: Signer, potId: bigint) {
  return forward(network, signer, encodeFunctionData({ abi: kinpotAbi, functionName: "confirmBill", args: [potId] }), 100_000n);
}

export function declineBill(network: NetworkKey, signer: Signer, potId: bigint) {
  return forward(network, signer, encodeFunctionData({ abi: kinpotAbi, functionName: "declineBill", args: [potId] }), 100_000n);
}

export function cancelPot(network: NetworkKey, signer: Signer, potId: bigint) {
  return forward(network, signer, encodeFunctionData({ abi: kinpotAbi, functionName: "cancel", args: [potId] }), 100_000n);
}

export function claimRefund(network: NetworkKey, signer: Signer, potId: bigint) {
  return forward(network, signer, encodeFunctionData({ abi: kinpotAbi, functionName: "claimRefund", args: [potId] }), 150_000n);
}

/** One EIP-3009 signature on AUSD, bound to this pot through the nonce. No gas, no approval. */
export async function contribute(network: NetworkKey, signer: Signer, potId: bigint, amount: bigint): Promise<RelayResult> {
  const d = deployment(network);
  const client = publicClient(network);
  const [, name, version, chainId, verifyingContract] = await client.readContract({
    address: d.ausd,
    abi: [
      {
        type: "function",
        name: "eip712Domain",
        stateMutability: "view",
        inputs: [],
        outputs: [
          { type: "bytes1" },
          { type: "string" },
          { type: "string" },
          { type: "uint256" },
          { type: "address" },
          { type: "bytes32" },
          { type: "uint256[]" },
        ],
      },
    ] as const,
    functionName: "eip712Domain",
  });
  const salt = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const validAfter = 0n;
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const signature = await signer.signTypedData({
    domain: { name, version, chainId, verifyingContract },
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
    message: {
      from: signer.address,
      to: d.kinpot,
      value: amount,
      validAfter,
      validBefore,
      nonce: authorizationNonce(potId, salt),
    },
  });
  return post({ network, action: "contribute", potId, from: signer.address, amount, validAfter, validBefore, salt, signature });
}

/** Permissionless: anyone can trigger these, so no signature is needed. */
export function triggerRelease(network: NetworkKey, potId: bigint) {
  return post({ network, action: "release", potId });
}

export function triggerRefund(network: NetworkKey, potId: bigint) {
  return post({ network, action: "refund", potId });
}

/** Testnet only: mints mock AUSD. */
export function faucet(network: NetworkKey, to: Address) {
  return post({ network, action: "faucet", to });
}
