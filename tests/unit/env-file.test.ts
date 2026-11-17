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
import { upsertEnv } from "@/scripts/env-file";

describe("upsertEnv (deploy script .env.local writer)", () => {
  it("updates keys in place and keeps comments, blank lines and order", () => {
    const before = [
      "# Deployer wallet private key",
      "PRIVATE_KEY=abc",
      "",
      "# Contract addresses",
      "NEXT_PUBLIC_USDC_ADDRESS=",
      "NEXT_PUBLIC_LENDING_ADDRESS=0xold",
      "",
    ].join("\n");

    expect(upsertEnv(before, { NEXT_PUBLIC_LENDING_ADDRESS: "0xnew", NEXT_PUBLIC_USDC_ADDRESS: "0xusdc" })).toBe(
      [
        "# Deployer wallet private key",
        "PRIVATE_KEY=abc",
        "",
        "# Contract addresses",
        "NEXT_PUBLIC_USDC_ADDRESS=0xusdc",
        "NEXT_PUBLIC_LENDING_ADDRESS=0xnew",
        "",
      ].join("\n"),
    );
  });

  it("appends keys that are missing and leaves commented-out keys alone", () => {
    expect(upsertEnv("# NEXT_PUBLIC_CIRBTC_ADDRESS=0xold\nA=1\n", { NEXT_PUBLIC_CIRBTC_ADDRESS: "0xnew" })).toBe(
      "# NEXT_PUBLIC_CIRBTC_ADDRESS=0xold\nA=1\nNEXT_PUBLIC_CIRBTC_ADDRESS=0xnew\n",
    );
  });

  it("creates the file content from scratch and keeps Windows line endings", () => {
    expect(upsertEnv("", { A: "1" })).toBe("A=1\n");
    expect(upsertEnv("# c\r\nA=0\r\n", { A: "1" })).toBe("# c\r\nA=1\r\n");
  });

  it("rewrites every copy of a duplicated key, since the last one wins", () => {
    expect(upsertEnv("A=0\nB=2\nA=3\n", { A: "1" })).toBe("A=1\nB=2\nA=1\n");
  });
});
