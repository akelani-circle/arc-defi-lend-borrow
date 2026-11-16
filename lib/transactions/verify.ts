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

import {
  formatUnits,
  isAddress,
  isAddressEqual,
  parseAbi,
  parseEventLogs,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { TxAction, TxToken } from "@/lib/supabase/transactions";

const EVENTS = parseAbi([
  "event CollateralDeposited(address indexed user, uint256 amount)",
  "event CollateralWithdrawn(address indexed user, uint256 amount)",
  "event LoanTaken(address indexed user, uint256 amount)",
  "event LoanRepaid(address indexed user, uint256 amount)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/** Which token each lending action moves, and how to display it. */
const LENDING_EVENTS = {
  CollateralDeposited: { action: "deposit", token: "cirBTC" },
  CollateralWithdrawn: { action: "withdraw", token: "cirBTC" },
  LoanTaken: { action: "borrow", token: "USDC" },
  LoanRepaid: { action: "repay", token: "USDC" },
} as const satisfies Record<string, { action: TxAction; token: TxToken }>;

export interface VerifiedRow {
  tx_hash: string;
  wallet_address: string;
  action: TxAction;
  token: TxToken;
  amount: string;
  amount_formatted: string;
  status: "confirmed";
}

export type Verification =
  | { status: "verified"; rows: VerifiedRow[] }
  /** The receipt is not visible yet. The caller should retry shortly. */
  | { status: "pending" }
  | { status: "invalid"; reason: "unconfigured" | "reverted" | "no_matching_event" };

export interface VerifyParams {
  txHash: Hex;
  /** The wallet the caller says this transaction belongs to. */
  wallet: Address;
  lendingAddress: string;
  usdcAddress: string;
  collateralDecimals: number;
  loanDecimals: number;
  client: Pick<PublicClient, "getTransactionReceipt">;
}

/**
 * Derives the history rows for `wallet` from the transaction's own receipt.
 *
 * The browser used to send the action, token and amount, and the table accepted any of
 * it from anyone: fabricated history for any wallet, or a wrong row squatting on a real
 * tx hash. Now the caller supplies only a hash and a wallet, and everything else comes
 * from events emitted by OUR contracts. The wallet claim can only select events that
 * really belong to that wallet, so it cannot invent anything.
 *
 * A single mined transaction can carry several users' operations (account-abstraction
 * bundles), which is why rows are picked by wallet rather than by hash alone.
 */
export async function verifyTransaction({
  txHash,
  wallet,
  lendingAddress,
  usdcAddress,
  collateralDecimals,
  loanDecimals,
  client,
}: VerifyParams): Promise<Verification> {
  if (!isAddress(lendingAddress, { strict: false }) || !isAddress(usdcAddress, { strict: false })) {
    return { status: "invalid", reason: "unconfigured" };
  }

  let receipt;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (error) {
    if (error instanceof TransactionReceiptNotFoundError) return { status: "pending" };
    throw error;
  }

  if (receipt.status !== "success") return { status: "invalid", reason: "reverted" };

  const rows: VerifiedRow[] = [];
  const seen = new Set<string>();
  const add = (action: TxAction, token: TxToken, amount: bigint, decimals: number) => {
    // One row per (tx, wallet, action), matching the table's unique constraint.
    if (seen.has(action)) return;
    seen.add(action);
    rows.push({
      tx_hash: txHash.toLowerCase(),
      wallet_address: wallet.toLowerCase(),
      action,
      token,
      amount: amount.toString(),
      amount_formatted: formatUnits(amount, decimals),
      status: "confirmed",
    });
  };

  for (const log of parseEventLogs({ abi: EVENTS, logs: receipt.logs })) {
    if (log.eventName === "Transfer") {
      // The mock USDC faucet: allocateTo mints, so the transfer comes from address zero.
      if (
        isAddressEqual(log.address, usdcAddress) &&
        isAddressEqual(log.args.from, zeroAddress) &&
        isAddressEqual(log.args.to, wallet)
      ) {
        add("mint_usdc", "USDC", log.args.value, loanDecimals);
      }
      continue;
    }

    if (!isAddressEqual(log.address, lendingAddress) || !isAddressEqual(log.args.user, wallet)) {
      continue;
    }
    const { action, token } = LENDING_EVENTS[log.eventName];
    add(action, token, log.args.amount, token === "cirBTC" ? collateralDecimals : loanDecimals);
  }

  if (rows.length === 0) return { status: "invalid", reason: "no_matching_event" };
  return { status: "verified", rows };
}
