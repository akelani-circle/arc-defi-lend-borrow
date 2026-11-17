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

import { afterEach, describe, expect, it, vi } from "vitest";

const ZERO = "0x0000000000000000000000000000000000000000";

async function load(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return import("@/lib/contracts/addresses");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("contract addresses", () => {
  it("falls back when a variable is present but empty, as in .env.example", async () => {
    const addresses = await load({
      NEXT_PUBLIC_CIRBTC_ADDRESS: "",
      NEXT_PUBLIC_USDC_ADDRESS: "",
      NEXT_PUBLIC_LENDING_ADDRESS: "",
    });
    expect(addresses.LENDING_ADDRESS).toBe(ZERO);
    expect(addresses.USDC_ADDRESS).toBe(ZERO);
    expect(addresses.CIRBTC_ADDRESS).toBe("0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");
  });

  it("uses the configured addresses", async () => {
    const lending = "0x10E28564a4df0980D827BFa78A77E2389509a650";
    const addresses = await load({ NEXT_PUBLIC_LENDING_ADDRESS: lending });
    expect(addresses.LENDING_ADDRESS).toBe(lending);
  });
});
