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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { queryBuilder, queueTables } from "../helpers/supabase-mock";

const rpc = vi.hoisted(() => ({ getTransactionReceipt: vi.fn() }));
const admin = vi.hoisted(() => ({ from: vi.fn() }));
const verify = vi.hoisted(() => vi.fn());

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_LENDING_ADDRESS = "0x" + "11".repeat(20);
  process.env.NEXT_PUBLIC_USDC_ADDRESS = "0x" + "22".repeat(20);
});

vi.mock("viem", async (importOriginal) => ({
  ...(await importOriginal<typeof import("viem")>()),
  createPublicClient: () => rpc,
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => admin) }));
vi.mock("@/lib/transactions/verify", () => ({ verifyTransaction: verify }));

import { POST } from "@/app/api/transactions/route";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const TX = `0x${"ab".repeat(32)}`;
const WALLET = "0x" + "a1".repeat(20);

const post = (body: unknown, raw = false) =>
  POST(
    new NextRequest("http://localhost/api/transactions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw ? (body as string) : JSON.stringify(body),
    })
  );

const row = { tx_hash: TX, wallet_address: WALLET, action: "borrow", token: "USDC", amount: "7", amount_formatted: "0.00000007", status: "confirmed" };

beforeEach(() => {
  admin.from.mockReset();
  verify.mockReset();
  vi.mocked(createSupabaseAdminClient).mockReturnValue(admin as never);
});

describe("POST /api/transactions", () => {
  it.each([
    ["a short hash", { txHash: "0x1234", walletAddress: WALLET }],
    ["a non-hex hash", { txHash: `0x${"zz".repeat(32)}`, walletAddress: WALLET }],
    ["no wallet", { txHash: TX }],
    ["a malformed wallet", { txHash: TX, walletAddress: "0xabc" }],
    ["non-string fields", { txHash: 1, walletAddress: 2 }],
  ])("rejects %s without touching the chain or the database", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    expect((await post("nope", true)).status).toBe(400);
  });

  it("answers 503 when Supabase is not configured", async () => {
    vi.mocked(createSupabaseAdminClient).mockReturnValue(null);
    expect((await post({ txHash: TX, walletAddress: WALLET })).status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });

  it("asks for a retry while the receipt is not visible yet", async () => {
    verify.mockResolvedValue({ status: "pending" });
    const res = await post({ txHash: TX, walletAddress: WALLET });
    expect(res.status).toBe(409);
    expect((await res.json()).retryable).toBe(true);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("refuses to record something that is not a lending action", async () => {
    verify.mockResolvedValue({ status: "invalid", reason: "no_matching_event" });
    const res = await post({ txHash: TX, walletAddress: WALLET });
    expect(res.status).toBe(422);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("answers 502 when the RPC is unreachable", async () => {
    verify.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await post({ txHash: TX, walletAddress: WALLET })).status).toBe(502);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("records exactly the rows the chain produced, ignoring details in the request", async () => {
    verify.mockResolvedValue({ status: "verified", rows: [row] });
    const insert = queryBuilder({});
    (insert as unknown as { upsert: unknown }).upsert = vi.fn(() => insert);
    queueTables(admin, { transactions: [insert] });

    const res = await post({
      txHash: TX,
      walletAddress: WALLET,
      // A hostile browser: none of this may reach the table.
      action: "borrow",
      amount: "999999999999",
      amount_formatted: "9999",
      token: "cirBTC",
      rows: [{ ...row, amount: "999999999999", action: "withdraw" }],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ logged: 1 });
    const upsert = (insert as unknown as { upsert: ReturnType<typeof vi.fn> }).upsert;
    expect(upsert).toHaveBeenCalledWith([row], {
      onConflict: "tx_hash,wallet_address,action",
      ignoreDuplicates: true,
    });
  });

  it("verifies against the configured contracts", async () => {
    verify.mockResolvedValue({ status: "invalid", reason: "no_matching_event" });
    await post({ txHash: TX, walletAddress: WALLET });
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        txHash: TX,
        wallet: WALLET,
        lendingAddress: "0x" + "11".repeat(20),
        usdcAddress: "0x" + "22".repeat(20),
        client: rpc,
      })
    );
  });
});
