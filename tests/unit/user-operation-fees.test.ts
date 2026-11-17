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
import { parseGwei } from "viem";
import { MIN_USER_OPERATION_PRIORITY_FEE, userOperationFees } from "@/contexts/WalletContext";

const gwei = (n: string) => parseGwei(n).toString();

describe("passkey UserOp fees", () => {
  it("uses Circle's quote when its tip is above the floor", () => {
    expect(userOperationFees({ maxFeePerGas: gwei("30.45"), maxPriorityFeePerGas: gwei("5.25") })).toEqual({
      maxFeePerGas: parseGwei("30.45"),
      maxPriorityFeePerGas: parseGwei("5.25"),
    });
  });

  it("raises a low quoted tip to 5 gwei (Circle's bundler never mines ~1.1 gwei tips)", () => {
    expect(MIN_USER_OPERATION_PRIORITY_FEE).toBe(parseGwei("5"));
    expect(userOperationFees({ maxFeePerGas: gwei("39.27"), maxPriorityFeePerGas: gwei("1.17") })).toEqual({
      maxFeePerGas: parseGwei("39.27"),
      maxPriorityFeePerGas: parseGwei("5"),
    });
  });

  it("keeps the max fee at least as high as the tip", () => {
    expect(userOperationFees({ maxFeePerGas: gwei("3"), maxPriorityFeePerGas: gwei("1") })).toEqual({
      maxFeePerGas: parseGwei("5"),
      maxPriorityFeePerGas: parseGwei("5"),
    });
  });
});
