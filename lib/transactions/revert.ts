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

import { decodeErrorResult, type Hex } from "viem";

/**
 * A transaction that was mined but whose call reverted, so it changed nothing. A mined
 * receipt alone is not success: a reverted call still gets a receipt and a hash.
 */
export class TransactionRevertedError extends Error {
  readonly hash: Hex;

  constructor(hash: Hex, revertData?: string) {
    const reason = decodeRevertReason(revertData);
    super(reason ? `Transaction reverted with reason: ${reason}` : "Transaction reverted");
    this.name = "TransactionRevertedError";
    this.hash = hash;
  }
}

/** Decodes Solidity `Error(string)` and `Panic(uint256)` revert data, if there is any. */
export function decodeRevertReason(data?: string): string | undefined {
  if (!data || !/^0x[0-9a-fA-F]{8,}$/.test(data)) return undefined;
  try {
    const { errorName, args } = decodeErrorResult({ abi: [], data: data as Hex });
    if (errorName === "Panic") return `panic code 0x${(args[0] as bigint).toString(16)}`;
    return String(args[0]);
  } catch {
    return undefined;
  }
}
