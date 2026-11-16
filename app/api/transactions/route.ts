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

import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address, type Hex } from "viem";
import { arcTestnet } from "@/lib/wagmi";
import {
  COLLATERAL_DECIMALS,
  LENDING_ADDRESS,
  LOAN_DECIMALS,
  USDC_ADDRESS,
} from "@/lib/contracts/addresses";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyTransaction } from "@/lib/transactions/verify";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

const client = createPublicClient({ chain: arcTestnet, transport: http() });

/**
 * POST /api/transactions  { txHash, walletAddress }
 *
 * Records a confirmed on-chain action in the history table. The table accepts no writes
 * from browsers; this route is the only writer, and it takes nothing from the request
 * but the hash and the wallet. The action, token and amount are read from the receipt,
 * so a caller can only ever record what really happened, and only for a wallet it
 * really happened to.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const txHash = body?.txHash;
  const walletAddress = body?.walletAddress;

  if (
    typeof txHash !== "string" ||
    !TX_HASH.test(txHash) ||
    typeof walletAddress !== "string" ||
    !isAddress(walletAddress, { strict: false })
  ) {
    return NextResponse.json({ error: "txHash and walletAddress are required" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "History is not configured" }, { status: 503 });
  }

  let result;
  try {
    result = await verifyTransaction({
      txHash: txHash as Hex,
      wallet: walletAddress as Address,
      lendingAddress: LENDING_ADDRESS,
      usdcAddress: USDC_ADDRESS,
      collateralDecimals: COLLATERAL_DECIMALS,
      loanDecimals: LOAN_DECIMALS,
      client,
    });
  } catch (error) {
    console.error("[transactions] RPC error:", error);
    return NextResponse.json({ error: "Could not reach the RPC. Try again shortly." }, { status: 502 });
  }

  if (result.status === "pending") {
    return NextResponse.json(
      { error: "Transaction not visible yet", retryable: true },
      { status: 409 }
    );
  }
  if (result.status === "invalid") {
    return NextResponse.json({ error: "Not a lending action", reason: result.reason }, { status: 422 });
  }

  const { error } = await supabase
    .from("transactions")
    .upsert(result.rows, { onConflict: "tx_hash,wallet_address,action", ignoreDuplicates: true });

  if (error) {
    console.error("[transactions] insert error:", error);
    return NextResponse.json({ error: "Could not record the transaction" }, { status: 500 });
  }

  return NextResponse.json({ logged: result.rows.length }, { status: 200 });
}
