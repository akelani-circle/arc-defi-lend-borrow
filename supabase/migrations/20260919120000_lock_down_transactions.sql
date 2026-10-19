-- Copyright 2026 Circle Internet Group, Inc.  All rights reserved.
--
-- Licensed under the Apache License, Version 2.0 (the "License");
-- you may not use this file except in compliance with the License.
-- You may obtain a copy of the License at
--
--     http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing, software
-- distributed under the License is distributed on an "AS IS" BASIS,
-- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-- See the License for the specific language governing permissions and
-- limitations under the License.
--
-- SPDX-License-Identifier: Apache-2.0

-- The transactions table used to accept INSERTs from anyone (`with check (true)`), and the
-- browser sent the action, token and amount itself. That allowed:
--   * fabricated history for any wallet (fake "borrow 1000000" rows), and
--   * a wrong row squatting on a real tx hash (tx_hash was UNIQUE), so the genuine row
--     was rejected as a duplicate and the wallet's real history never appeared.
--
-- Rows are now written only by POST /api/transactions, with the secret key, from the
-- transaction's own receipt. Reads stay public: this is a view of public on-chain data.

drop policy if exists "insert all" on public.transactions;

drop policy if exists "read all" on public.transactions;
create policy "read all" on public.transactions
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.transactions from anon, authenticated;

-- One bundled transaction can carry several users' operations, so the hash alone is not
-- unique: a row is (transaction, wallet, action).
alter table public.transactions drop constraint if exists transactions_tx_hash_key;
alter table public.transactions
  add constraint transactions_hash_wallet_action_key unique (tx_hash, wallet_address, action);

-- The API stores lower-cased values. NOT VALID checks new rows without failing on old ones.
alter table public.transactions
  add constraint transactions_wallet_lowercase check (wallet_address = lower(wallet_address)) not valid,
  add constraint transactions_hash_format check (tx_hash ~ '^0x[0-9a-f]{64}$') not valid;
