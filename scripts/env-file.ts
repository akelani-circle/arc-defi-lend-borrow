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

/**
 * Sets `vars` in the text of a dotenv file, in place. Comments, blank lines and the order
 * of existing keys are kept: an existing key's line is rewritten, a new key is appended.
 */
export function upsertEnv(content: string, vars: Record<string, string>): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content === "" ? [] : content.replace(/\r?\n$/, "").split(/\r?\n/);
  const written = new Set<string>();

  const out = lines.map((line) => {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (key === undefined || !Object.hasOwn(vars, key)) return line;
    // Rewrite every occurrence: dotenv lets the last one win.
    written.add(key);
    return `${key}=${vars[key]}`;
  });

  for (const [key, value] of Object.entries(vars)) {
    if (!written.has(key)) out.push(`${key}=${value}`);
  }
  return out.join(eol) + eol;
}
