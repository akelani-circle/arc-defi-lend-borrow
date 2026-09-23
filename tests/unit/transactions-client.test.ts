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

const supabase = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ getSupabaseClient: () => supabase }));

import {
  ReceiptNotVisibleError,
  escapeLike,
  insertTransaction,
  listTransactions,
} from "@/lib/supabase/transactions";

const TX = `0x${"ab".repeat(32)}`;
const WALLET = "0x" + "a1".repeat(20);

const respond = (status: number, body: unknown = {}) =>
  vi.mocked(fetch).mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  supabase.from.mockReset();
});

describe("insertTransaction", () => {
  it("sends only the hash and wallet: the server reads the rest from the chain", async () => {
    respond(200, { logged: 1 });
    await insertTransaction({ tx_hash: TX, wallet_address: WALLET });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/transactions");
    expect(JSON.parse(init!.body as string)).toEqual({ txHash: TX, walletAddress: WALLET });
  });

  it("raises a retryable error while the server cannot see the receipt", async () => {
    respond(409, { retryable: true });
    await expect(insertTransaction({ tx_hash: TX, wallet_address: WALLET })).rejects.toBeInstanceOf(
      ReceiptNotVisibleError
    );
  });

  it("stays quiet when history is not configured (503)", async () => {
    respond(503);
    await expect(insertTransaction({ tx_hash: TX, wallet_address: WALLET })).resolves.toBeUndefined();
  });

  it.each([400, 422, 500, 502])("surfaces a %i", async (status) => {
    respond(status, { error: "nope" });
    const failure = insertTransaction({ tx_hash: TX, wallet_address: WALLET });
    await expect(failure).rejects.toThrow("nope");
    await expect(failure).rejects.not.toBeInstanceOf(ReceiptNotVisibleError);
  });
});

describe("escapeLike / listTransactions", () => {
  it("escapes LIKE wildcards so a search matches literally", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLike("0xabc")).toBe("0xabc");
  });

  it("filters by the lower-cased wallet and escapes the search", async () => {
    const builder: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const name of ["select", "eq", "ilike", "order", "range"]) builder[name] = vi.fn(() => builder);
    (builder as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) =>
      resolve({ data: [], count: 0, error: null });
    supabase.from.mockReturnValue(builder);

    await listTransactions({
      wallet: "0xABC",
      search: "a%b",
      sortColumn: "created_at",
      sortDirection: "desc",
      page: 0,
      pageSize: 10,
    });

    expect(builder.eq).toHaveBeenCalledWith("wallet_address", "0xabc");
    expect(builder.ilike).toHaveBeenCalledWith("tx_hash", "%a\\%b%");
  });
});
