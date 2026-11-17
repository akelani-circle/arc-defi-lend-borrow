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

import { describe, expect, it } from "vitest";
import { encodeErrorResult, parseAbi } from "viem";
import { parseTxError } from "@/lib/errors";
import { TransactionRevertedError, decodeRevertReason } from "@/lib/transactions/revert";

const TX = `0x${"ab".repeat(32)}` as const;
const SOLIDITY_ERRORS = parseAbi(["error Error(string)", "error Panic(uint256)"]);
const revertData = (reason: string) =>
  encodeErrorResult({ abi: SOLIDITY_ERRORS, errorName: "Error", args: [reason] });

describe("reverted transactions", () => {
  it("decodes the Solidity revert reason a reverted UserOp reports", () => {
    expect(decodeRevertReason(revertData("Exceeds borrow limit"))).toBe("Exceeds borrow limit");
    expect(
      decodeRevertReason(encodeErrorResult({ abi: SOLIDITY_ERRORS, errorName: "Panic", args: [0x11n] })),
    ).toBe("panic code 0x11");
  });

  it("ignores missing or undecodable revert data", () => {
    expect(decodeRevertReason(undefined)).toBeUndefined();
    expect(decodeRevertReason("0x")).toBeUndefined();
    expect(decodeRevertReason("0xdeadbeef")).toBeUndefined();
  });

  it("is shown as a failure with the reason, and keeps the hash for the explorer link", () => {
    const error = new TransactionRevertedError(TX, revertData("Insufficient available collateral"));
    expect(error.hash).toBe(TX);
    expect(parseTxError(error)).toEqual({
      title: "Transaction failed",
      detail: "Insufficient available collateral",
    });
    expect(parseTxError(new TransactionRevertedError(TX))).toEqual({
      title: "Transaction failed",
      detail: "The contract rejected this transaction.",
    });
  });
});

describe("parseTxError", () => {
  it("names USDC, Arc's gas token, when the wallet cannot pay for gas", () => {
    const { detail } = parseTxError(new Error("insufficient funds for gas * price + value"));
    expect(detail).toContain("USDC");
    expect(detail).not.toContain("ETH");
  });
});
