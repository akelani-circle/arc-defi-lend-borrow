/**
 * Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Hex,
} from "viem";
import { verifyTransaction } from "@/lib/transactions/verify";

const LENDING = "0x1111111111111111111111111111111111111111";
const USDC = "0x2222222222222222222222222222222222222222";
const ALICE = "0xa1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
const BOB = "0xb2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2";
const OTHER_CONTRACT = "0x3333333333333333333333333333333333333333";
const TX = `0x${"ab".repeat(32)}` as Hex;

const abi = parseAbi([
  "event CollateralDeposited(address indexed user, uint256 amount)",
  "event CollateralWithdrawn(address indexed user, uint256 amount)",
  "event LoanTaken(address indexed user, uint256 amount)",
  "event LoanRepaid(address indexed user, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

function log(address: string, eventName: string, args: Record<string, unknown>, value: bigint) {
  return {
    address,
    topics: encodeEventTopics({ abi, eventName, args } as never),
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
    blockNumber: 1n,
    blockHash: `0x${"cd".repeat(32)}`,
    logIndex: 0,
    transactionHash: TX,
    transactionIndex: 0,
    removed: false,
  };
}

const lendingLog = (name: string, user: string, amount: bigint, address = LENDING) =>
  log(address, name, { user }, amount);
const transferLog = (from: string, to: string, value: bigint, address = USDC) =>
  log(address, "Transfer", { from, to }, value);

const clientReturning = (receipt: { status: string; logs: unknown[] }) =>
  ({ getTransactionReceipt: vi.fn().mockResolvedValue(receipt) }) as never;

const params = (client: never, over: Record<string, unknown> = {}) => ({
  txHash: TX,
  wallet: ALICE as `0x${string}`,
  lendingAddress: LENDING,
  usdcAddress: USDC,
  collateralDecimals: 8,
  loanDecimals: 8,
  client,
  ...over,
});

describe("verifyTransaction", () => {
  it.each([
    ["CollateralDeposited", "deposit", "cirBTC"],
    ["CollateralWithdrawn", "withdraw", "cirBTC"],
    ["LoanTaken", "borrow", "USDC"],
    ["LoanRepaid", "repay", "USDC"],
  ])("derives a %s event as %s of %s, from the chain", async (event, action, token) => {
    const client = clientReturning({ status: "success", logs: [lendingLog(event, ALICE, 150_000_000n)] });

    const result = await verifyTransaction(params(client));

    expect(result).toEqual({
      status: "verified",
      rows: [
        {
          tx_hash: TX,
          wallet_address: ALICE,
          action,
          token,
          amount: "150000000",
          amount_formatted: "1.5",
          status: "confirmed",
        },
      ],
    });
  });

  it("derives a faucet mint from a Transfer out of address zero on the USDC token", async () => {
    const client = clientReturning({ status: "success", logs: [transferLog(zeroAddress, ALICE, 5_000_000_000n)] });
    const result = await verifyTransaction(params(client));
    expect(result).toMatchObject({
      status: "verified",
      rows: [{ action: "mint_usdc", token: "USDC", amount: "5000000000", amount_formatted: "50" }],
    });
  });

  it("formats each token with its own decimals", async () => {
    const client = clientReturning({ status: "success", logs: [lendingLog("LoanTaken", ALICE, 1_500_000n)] });
    const result = await verifyTransaction(params(client, { loanDecimals: 6 }));
    expect(result).toMatchObject({ rows: [{ amount_formatted: "1.5" }] });
  });

  it("lower-cases the hash and wallet it stores", async () => {
    const client = clientReturning({ status: "success", logs: [lendingLog("LoanTaken", ALICE, 1n)] });
    const result = await verifyTransaction(
      params(client, { txHash: TX.toUpperCase().replace("0X", "0x"), wallet: ALICE.toUpperCase().replace("0X", "0x") })
    );
    expect(result).toMatchObject({ rows: [{ tx_hash: TX, wallet_address: ALICE }] });
  });

  it("picks only the claimed wallet's events out of a bundle with several users", async () => {
    const client = clientReturning({
      status: "success",
      logs: [
        lendingLog("CollateralDeposited", BOB, 999n),
        lendingLog("LoanTaken", ALICE, 7n),
        lendingLog("LoanTaken", BOB, 888n),
      ],
    });
    const result = await verifyTransaction(params(client));
    expect(result).toMatchObject({ rows: [{ action: "borrow", amount: "7", wallet_address: ALICE }] });
  });

  it("cannot be used to claim someone else's transaction as yours", async () => {
    const client = clientReturning({ status: "success", logs: [lendingLog("LoanTaken", BOB, 1000n)] });
    expect(await verifyTransaction(params(client))).toEqual({
      status: "invalid",
      reason: "no_matching_event",
    });
  });

  it("ignores lookalike events emitted by a different contract", async () => {
    const client = clientReturning({
      status: "success",
      logs: [lendingLog("LoanTaken", ALICE, 1_000_000n, OTHER_CONTRACT)],
    });
    expect((await verifyTransaction(params(client))).status).toBe("invalid");
  });

  it.each([
    ["a normal transfer", transferLog(BOB, ALICE, 100n)],
    ["a mint on a different token", transferLog(zeroAddress, ALICE, 100n, OTHER_CONTRACT)],
    ["a mint to someone else", transferLog(zeroAddress, BOB, 100n)],
  ])("does not treat %s as a faucet mint", async (_name, entry) => {
    const client = clientReturning({ status: "success", logs: [entry] });
    expect((await verifyTransaction(params(client))).status).toBe("invalid");
  });

  it("records one row per action even if the event appears twice", async () => {
    const client = clientReturning({
      status: "success",
      logs: [lendingLog("LoanRepaid", ALICE, 1n), lendingLog("LoanRepaid", ALICE, 2n)],
    });
    const result = await verifyTransaction(params(client));
    expect(result).toMatchObject({ rows: [{ action: "repay", amount: "1" }] });
    expect((result as { rows: unknown[] }).rows).toHaveLength(1);
  });

  it("rejects a reverted transaction even if it carries matching logs", async () => {
    const client = clientReturning({ status: "reverted", logs: [lendingLog("LoanTaken", ALICE, 1n)] });
    expect(await verifyTransaction(params(client))).toEqual({ status: "invalid", reason: "reverted" });
  });

  it("reports pending while the receipt is not visible yet", async () => {
    const client = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new TransactionReceiptNotFoundError({ hash: TX })),
    } as never;
    expect(await verifyTransaction(params(client))).toEqual({ status: "pending" });
  });

  it("rethrows RPC failures so a real transaction is not wrongly rejected", async () => {
    const client = { getTransactionReceipt: vi.fn().mockRejectedValue(new Error("rpc down")) } as never;
    await expect(verifyTransaction(params(client))).rejects.toThrow("rpc down");
  });

  it.each([["" as string], ["not-an-address"]])(
    "refuses to verify when a contract address is not configured (%j)",
    async (bad) => {
      const client = { getTransactionReceipt: vi.fn() };
      expect(await verifyTransaction(params(client as never, { lendingAddress: bad }))).toEqual({
        status: "invalid",
        reason: "unconfigured",
      });
      expect(client.getTransactionReceipt).not.toHaveBeenCalled();
    }
  );
});
