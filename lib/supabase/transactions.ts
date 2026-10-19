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

"use client";

import { getSupabaseClient } from "./client";

export type TxAction = "deposit" | "withdraw" | "borrow" | "repay" | "mint_usdc";
export type TxToken = "cirBTC" | "USDC";
export type TxStatus = "confirmed" | "failed";

export interface TransactionRow {
  id: string;
  tx_hash: string;
  wallet_address: string;
  action: TxAction;
  token: TxToken;
  amount: string;
  amount_formatted: string;
  status: TxStatus;
  created_at: string;
}

/** What the browser tells the server. Everything else is read from the receipt. */
export interface InsertTransactionInput {
  tx_hash: string;
  wallet_address: string;
}

/** The server cannot see the receipt yet (RPC lag). Safe to retry shortly. */
export class ReceiptNotVisibleError extends Error {
  constructor() {
    super("The transaction is not visible to the server yet");
    this.name = "ReceiptNotVisibleError";
  }
}

export type SortColumn = "created_at" | "amount_formatted";
export type SortDirection = "asc" | "desc";

export interface ListTransactionsParams {
  wallet: string;
  search?: string;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  page: number;
  pageSize: number;
}

export interface ListTransactionsResult {
  rows: TransactionRow[];
  total: number;
}

/**
 * Asks the server to record a confirmed transaction. The table takes no writes from the
 * browser: the server reads the action, token and amount from the receipt itself.
 */
export async function insertTransaction(input: InsertTransactionInput): Promise<void> {
  const response = await fetch("/api/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash: input.tx_hash, walletAddress: input.wallet_address }),
  });

  if (response.status === 409) throw new ReceiptNotVisibleError();
  // History is a convenience, not part of the transaction. 503 = Supabase not configured.
  if (!response.ok && response.status !== 503) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not record the transaction");
  }
}

/** % and _ are wildcards in LIKE; a search for a hash should match them literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listTransactions(
  params: ListTransactionsParams,
): Promise<ListTransactionsResult> {
  const client = getSupabaseClient();
  if (!client) return { rows: [], total: 0 };

  const from = params.page * params.pageSize;
  const to = from + params.pageSize - 1;

  let query = client
    .from("transactions")
    .select("*", { count: "exact" })
    .eq("wallet_address", params.wallet.toLowerCase());

  if (params.search && params.search.trim().length > 0) {
    query = query.ilike("tx_hash", `%${escapeLike(params.search.trim())}%`);
  }

  query = query
    .order(params.sortColumn, { ascending: params.sortDirection === "asc" })
    .range(from, to);

  const { data, count, error } = await query;
  if (error) throw error;

  return { rows: (data as TransactionRow[]) ?? [], total: count ?? 0 };
}
