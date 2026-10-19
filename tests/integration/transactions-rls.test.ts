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

import { randomUUID } from "crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishableKey || !secretKey) {
  throw new Error(
    "Integration tests need the local Supabase stack. Run `npm run db:start` and make sure .env.local has NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY (see `npm run db:status`)."
  );
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const service = createClient(url, secretKey, options);
const anon = createClient(url, publishableKey, options);

const hash = () => `0x${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}`;
const wallet = () => `0x${randomUUID().replace(/-/g, "")}00000000`;
const created: string[] = [];

const row = (over: Record<string, unknown> = {}) => {
  const tx_hash = hash();
  created.push(tx_hash);
  return {
    tx_hash,
    wallet_address: wallet(),
    action: "borrow",
    token: "USDC",
    amount: "100000000",
    amount_formatted: "1",
    status: "confirmed",
    ...over,
  };
};

afterAll(async () => {
  await service.from("transactions").delete().in("tx_hash", created);
});

const PERMISSION_DENIED = "42501";

describe("transactions: browsers cannot write", () => {
  it("does not let the publishable key insert a row (history used to be forgeable)", async () => {
    const { error } = await anon.from("transactions").insert(row({ amount: "999999999999999", amount_formatted: "9999999" }));
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("does not let it squat on a real hash with a wrong row", async () => {
    const real = row();
    await service.from("transactions").insert(real);
    // The old unique(tx_hash) let a pre-inserted wrong row block the genuine one.
    const { error } = await anon.from("transactions").insert({ ...real, wallet_address: wallet(), amount: "1" });
    expect(error?.code).toBe(PERMISSION_DENIED);
  });

  it("does not let it edit or delete existing rows", async () => {
    const real = row();
    await service.from("transactions").insert(real);

    const update = await anon.from("transactions").update({ amount: "0" }).eq("tx_hash", real.tx_hash).select();
    const remove = await anon.from("transactions").delete().eq("tx_hash", real.tx_hash).select();
    expect(update.error?.code === PERMISSION_DENIED || (update.data ?? []).length === 0).toBe(true);
    expect(remove.error?.code === PERMISSION_DENIED || (remove.data ?? []).length === 0).toBe(true);

    const { data } = await service.from("transactions").select("amount").eq("tx_hash", real.tx_hash).single();
    expect(String(data!.amount)).toBe(real.amount);
  });
});

describe("transactions: public reads still work", () => {
  it("lets anyone read a wallet's history (it is public on-chain data)", async () => {
    const real = row();
    await service.from("transactions").insert(real);
    const { data, error } = await anon.from("transactions").select("tx_hash").eq("wallet_address", real.wallet_address);
    expect(error).toBeNull();
    expect(data).toEqual([{ tx_hash: real.tx_hash }]);
  });
});

describe("transactions: server-side writes", () => {
  it("is idempotent per (hash, wallet, action), which is what the API upserts on", async () => {
    const real = row();
    const write = () =>
      service
        .from("transactions")
        .upsert(real, { onConflict: "tx_hash,wallet_address,action", ignoreDuplicates: true });
    expect((await write()).error).toBeNull();
    expect((await write()).error).toBeNull();

    const { data } = await service.from("transactions").select("id").eq("tx_hash", real.tx_hash);
    expect(data).toHaveLength(1);
  });

  it("allows two wallets to have a row for the same bundled transaction", async () => {
    const shared = hash();
    created.push(shared);
    const base = row({ tx_hash: shared });
    const a = await service.from("transactions").insert(base);
    const b = await service.from("transactions").insert({ ...base, wallet_address: wallet() });
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
  });

  it("still rejects the same wallet and action twice", async () => {
    const real = row();
    await service.from("transactions").insert(real);
    const { error } = await service.from("transactions").insert(real);
    expect(error?.code).toBe("23505");
  });

  it("rejects malformed values: upper-case wallet, bad hash, unknown action", async () => {
    const upper = await service.from("transactions").insert(row({ wallet_address: wallet().toUpperCase().replace("0X", "0x") }));
    expect(upper.error?.code).toBe("23514");

    const badHash = await service.from("transactions").insert(row({ tx_hash: "0x1234" }));
    expect(badHash.error?.code).toBe("23514");

    const badAction = await service.from("transactions").insert(row({ action: "drain" }));
    expect(badAction.error?.code).toBe("23514");
  });
});
