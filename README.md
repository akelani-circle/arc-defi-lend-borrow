# Arc Borrow & Lend

A collateralized lending platform built on [Arc Testnet](https://arc.network/). Users connect a wallet, deposit cirBTC as collateral, and borrow USDC against it. The protocol is governed by a configurable collateral factor — by default users can borrow up to 50% of their deposited collateral value.

<img alt="Arc Borrow & Lend dashboard" src="public/screenshot.png" />

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [How It Works](#how-it-works)
- [Contract Overview](#contract-overview)
- [Loan Lifecycle](#loan-lifecycle)
- [Environment Variables](#environment-variables)
- [Local Database (Supabase)](#local-database-supabase)
- [Upgrading](#upgrading)
- [Testing](#testing)
- [Project Structure](#project-structure)
- [Security & Usage Model](#security--usage-model)

## Features

- **Connect wallet** — MetaMask (or any injected EVM wallet) or a Circle passkey wallet (WebAuthn biometric auth), unified behind a single `useContractWrite` hook.
- **Deposit collateral** (`depositCollateral`) — deposit cirBTC as collateral.
- **Borrow** (`takeLoan`) — take a USDC loan up to the collateral factor limit.
- **Repay** (`repayLoan`) — repay an outstanding USDC loan, partially or fully.
- **Withdraw** (`withdrawCollateral`) — withdraw cirBTC collateral once a loan is fully repaid.
- **Transaction history** — every action is persisted to Supabase and shown on the dashboard.
- **Testnet faucet** — the mock USDC lending token is freely mintable via an in-app faucet button.

## Prerequisites

- **Node.js v22+ (required by Hardhat 3)** - Install via [nvm](https://github.com/nvm-sh/nvm)
- **A wallet** - either:
  - **MetaMask** (or any injected EVM wallet) - connected to **Arc Testnet** (Chain ID `5042002`), or
  - **Circle Passkey Wallet** - browser-based biometric authentication via WebAuthn (no extension needed). Requires a [Circle developer account](https://console.circle.com/) for the client key and URL.
    > **Emulating passkeys in the browser:** If your browser does not support hardware passkeys (or you're developing without a biometric device), you can enable a virtual authenticator in DevTools:
    >
    > 1. Open **Developer Tools** (F12)
    > 2. Go to the **WebAuthn** tab (in Chromium-based browsers)
    > 3. Check **"Enable virtual authenticator environment"**
    > 4. Configure the virtual authenticator:
    >   - **Protocol**: `ctap2`
    >   - **Transport**: `internal`
    >   - **Supports resident keys**: `Yes`
    >   - **Supports user verification**: `Yes`
    >   - **Supports large blob**: `No`
    >
    > This creates a software-based authenticator that emulates biometric authentication, allowing passkey registration and login to work without physical hardware.
- **Arc Testnet USDC** - used for gas fees only. Obtain from the [Circle faucet](https://faucet.circle.com/) (20 USDC per request, every 2 hours per address).
- **cirBTC** - the collateral token for this protocol. Circle's wrapped Bitcoin on Arc Testnet (`0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`).
  > **⚠️ cirBTC has no public faucet yet.** As of this writing, cirBTC is a "coming soon" product from Circle and is not distributed by `faucet.circle.com` or the developer-console faucet (both of which only dispense USDC/EURC/native gas tokens). The contract on Arc Testnet is Circle's standard `FiatTokenProxy`, which means only Circle-whitelisted minter addresses can mint — there is no self-serve on-chain faucet.
  >
  > To obtain cirBTC for testing, you currently need to either:
  >
  > 1. Request an allocation through [Circle's developer Discord](https://discord.gg/buildoncircle) / partner channels, or
  > 2. Receive a transfer from a wallet that already holds cirBTC (e.g. a team demo wallet).
  >
  > The mock USDC loan token deployed by this repo remains freely mintable via the in-app faucet button, so the rest of the flow is testable once you have any non-zero cirBTC balance.

## Getting Started

1. Clone the repository and install dependencies:
  ```bash
   git clone <repo-url>
   cd arc-borrow-lend
   npm install
  ```
2. Set up environment variables:
  ```bash
   cp .env.example .env.local
  ```
   Edit `.env.local` and fill in your deployer private key and (optionally) Circle credentials (see [Environment Variables](#environment-variables)). The Arc Testnet RPC URL defaults to [https://rpc.testnet.arc.network](https://rpc.testnet.arc.network).
  > **Note:** The public RPC rate-limits (HTTP 429) under the app's polling — balances and buttons can stall. For demos or heavy use, set `NEXT_PUBLIC_RPC_URL` to a dedicated provider (e.g. an Alchemy Arc Testnet endpoint).
  > **Note:** Deployment requires a **non-custodial wallet** (e.g. MetaMask) whose private key you can export. Custodial wallets like Circle passkey wallets do not expose private keys and cannot be used for deployment. The Circle wallet integration is for end users interacting with the deployed contracts via the frontend.
3. Compile and deploy the smart contracts:
  ```bash
   npm run compile
   npm run deploy:lending
  ```
   The deploy script:
  1. Uses the existing cirBTC token (`0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF`) as collateral — no deployment needed
  2. Deploys a mock USDC (TestnetERC20, 8 decimals) and mints 100,000 USDC to the deployer
  3. Deploys the `LendingBorrowing` contract with cirBTC as collateral, USDC as the lending token, and a 50% collateral factor
  4. Funds the lending pool with 50,000 USDC
  5. Writes all deployed addresses to `.env.local`
4. Start the development server:
  ```bash
   npm run dev
  ```
   The app will be available at `http://localhost:3000`.

## How It Works

- Built with [Next.js](https://nextjs.org/) App Router and [wagmi](https://wagmi.sh/) + [viem](https://viem.sh/) for wallet interactions
- **Dual wallet support**: users can connect via MetaMask (injected wallet) or a Circle passkey wallet (WebAuthn biometric authentication with smart account abstraction via `[@circle-fin/modular-wallets-core](https://www.npmjs.com/package/@circle-fin/modular-wallets-core)`). A unified `useContractWrite` hook abstracts the differences so all lending actions work identically with either wallet type.
- **Collateral**: cirBTC (Circle's wrapped Bitcoin on Arc Testnet, 8 decimals). Users deposit cirBTC to unlock borrowing capacity.
- **Lending token**: Mock USDC (8 decimals) - freely mintable via the UI faucet button. Users borrow USDC from the pool against their cirBTC collateral.
- **Collateral factor**: set at deployment (default 50%). Users can borrow up to `collateralFactor%` of their deposited cirBTC value in USDC. Both tokens use 8 decimals so the percentage math is exact with no decimal conversion.
- Only one active loan per user at a time. Collateral is locked while a loan is outstanding and released upon full repayment.
- Styled with [Tailwind CSS](https://tailwindcss.com) and components from [shadcn/ui](https://ui.shadcn.com/)
- Arc Testnet uses USDC as native gas — no separate ETH needed for transaction fees.

## Contract Overview

### `LendingBorrowing`

A simple collateralized lending protocol with the following interface:


| Function                      | Who   | Description                                                   |
| ----------------------------- | ----- | ------------------------------------------------------------- |
| `depositCollateral(amount)`   | User  | Deposit cirBTC as collateral (requires prior ERC20 approval)  |
| `takeLoan(amount)`            | User  | Borrow USDC up to `collateralFactor%` of deposited collateral |
| `repayLoan(amount)`           | User  | Repay USDC loan (partially or fully)                          |
| `withdrawCollateral(amount)`  | User  | Withdraw cirBTC not locked by an active loan                  |
| `fundPool(amount)`            | Owner | Fund the lending pool with USDC                               |
| `setCollateralFactor(factor)` | Owner | Update the collateral factor (1–100)                          |


**View helpers:**


| Function                    | Returns                                             |
| --------------------------- | --------------------------------------------------- |
| `maxBorrow(user)`           | Maximum USDC the user can currently borrow          |
| `availableCollateral(user)` | cirBTC available to withdraw (not locked by a loan) |
| `poolLiquidity()`           | Current USDC balance in the lending pool            |


## Loan Lifecycle


| Step | Action         | Description                                                                                                                                                          |
| ---- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Get cirBTC** | Obtain cirBTC on Arc Testnet to use as collateral (see [Prerequisites](#prerequisites) — no public faucet; distribution is via Circle Discord or a team demo wallet) |
| 2    | **Deposit**    | Approve and deposit cirBTC as collateral                                                                                                                             |
| 3    | **Borrow**     | Take a USDC loan up to the collateral factor limit                                                                                                                   |
| 4    | **Repay**      | Approve USDC and repay any portion of the outstanding loan                                                                                                           |
| 5    | **Withdraw**   | Once fully repaid, withdraw cirBTC collateral                                                                                                                        |


> Collateral is **locked** for the duration of an active loan and cannot be withdrawn until the loan is fully repaid.

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the required values. The deploy script automatically writes contract addresses back to this file after a successful deployment:

```bash
# Deployer wallet private key (for contract deployment)
PRIVATE_KEY=your_private_key_here

# Optional — defaults to the public https://rpc.testnet.arc.network
NEXT_PUBLIC_RPC_URL=https://your-alchemy-rpc-url-here

# Optional — for contract verification
ARCSCAN_API_KEY=your_arcscan_api_key_here

# Circle modular wallets (required for passkey wallet support)
NEXT_PUBLIC_CIRCLE_CLIENT_KEY=your_circle_client_key_here
NEXT_PUBLIC_CIRCLE_CLIENT_URL=your_circle_client_url_here

# Contract addresses (auto-written by the deploy script)
NEXT_PUBLIC_USDC_ADDRESS=
NEXT_PUBLIC_LENDING_ADDRESS=
NEXT_PUBLIC_CIRBTC_ADDRESS=

# Optional
NEXT_PUBLIC_EXPLORER_URL=

# Local Supabase (populated by `npm run db:start`)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

| Variable | Scope | Purpose |
| --- | --- | --- |
| `PRIVATE_KEY` | Server-side, secret | Deployer wallet private key, used by Hardhat for contract deployment. |
| `NEXT_PUBLIC_RPC_URL` | Public | Alchemy RPC URL (used by both Hardhat and the frontend). Optional — defaults to the public `https://rpc.testnet.arc.network`, which rate-limits under the app's polling. |
| `ARCSCAN_API_KEY` | Server-side | Optional. ArcScan API key used by `@nomicfoundation/hardhat-verify` for contract verification. |
| `NEXT_PUBLIC_CIRCLE_CLIENT_KEY` | Public | Circle modular wallets client key (for the passkey wallet). |
| `NEXT_PUBLIC_CIRCLE_CLIENT_URL` | Public | Circle modular wallets API URL (for the passkey wallet). |
| `NEXT_PUBLIC_CIRBTC_ADDRESS` | Public | cirBTC token address (hardcoded; auto-written by the deploy script). |
| `NEXT_PUBLIC_USDC_ADDRESS` | Public | Deployed mock USDC address (auto-written by the deploy script). |
| `NEXT_PUBLIC_LENDING_ADDRESS` | Public | Deployed `LendingBorrowing` contract address (auto-written by the deploy script). |
| `NEXT_PUBLIC_EXPLORER_URL` | Public | Optional. Block explorer base URL used for transaction hash links. |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Local Supabase API URL. Defaults to `http://127.0.0.1:54321`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public | Local Supabase publishable key, printed by `npm run db:status` (formerly called the "anon key"). |
| `SUPABASE_SECRET_KEY` | Server-side | Local Supabase secret key, printed by `npm run db:status`. Used only by `POST /api/transactions` to record history. Bypasses row level security: never expose it to the browser. |


## Local Database (Supabase)

Transaction history is persisted in a locally self-hosted [Supabase](https://supabase.com) instance. Docker is required.

```bash
npm run db:start    # boots Postgres + Studio + REST
npm run db:status   # prints API URL, anon key, Studio URL
npm run db:stop
npm run db:reset    # re-run migrations, wipe data
```

On first run, copy the printed `Project URL` into `NEXT_PUBLIC_SUPABASE_URL` and the `Publishable` key into `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. (Supabase recently renamed `anon` → `publishable` and `service_role` → `secret`.) Also copy the `Secret` key into `SUPABASE_SECRET_KEY`: the browser can no longer write history itself. The migrations in `supabase/migrations` create the `transactions` table used by the history panel on the dashboard and lock it so only the server can write to it.

## Upgrading

Changes that require action on an existing deployment:

- **Redeploy the contract** (`npm run deploy:lending`). `LendingBorrowing` now rejects a deployment where both tokens are the same (borrowers could otherwise take other people's collateral), guards every entry point against re-entrancy, refuses tokens that charge a transfer fee (they would leave the contract insolvent), and uses two-step ownership transfer (`transferOwnership` then `acceptOwnership`). Existing deployments keep the old behaviour.
- **Apply the new migration** (`npm run db:start` locally, `npm run supabase -- db push` on a hosted project). The `transactions` table used to accept INSERTs from anyone, with the action and amount chosen by the browser, so anyone could fabricate history for any wallet, or pre-insert a wrong row for a real transaction hash so the genuine one was rejected as a duplicate. Now only the server writes, and reads stay public.
- **Add `SUPABASE_SECRET_KEY`** to `.env.local` (and to your deployment). History is recorded by `POST /api/transactions`, which takes only a transaction hash and a wallet and reads the action, token and amount from the on-chain receipt. Without the key the app still works; history is simply not recorded.
- `@types/node` is now `^22`, matching the Node 22+ this repo already requires.

## Testing

- `npm test` runs the unit tests in `tests/unit` (no services needed): the receipt verifier, the history route, and the client helpers.
- `npm run test:contracts` runs the Solidity tests in `test/` on Hardhat's in-process network: borrowing limits, collateral locking, repayment, ownership, fee-on-transfer tokens and re-entrancy. `contracts/test/` holds the test-only tokens and is never deployed.
- `npm run test:integration` runs `tests/integration` against the **local** Supabase stack (`npm run db:start` first): who can read and write the history table. It reads connection settings from `.env.local`.

## Project Structure

```
arc-borrow-lend/
├── app/                                    # Next.js App Router pages
│   ├── layout.tsx
│   ├── page.tsx                            # Main lending & borrowing UI
│   ├── providers.tsx
│   └── globals.css
├── components/                             # React components
│   ├── trading/
│   │   └── TxStatus.tsx                    # Transaction status indicator
│   ├── wallet/                             # Wallet connection components
│   │   ├── ConnectDialog.tsx               # Wallet selection dialog
│   │   ├── ConnectWallet.tsx               # Wallet connect button + balances
│   │   └── CopyableText.tsx               # Click-to-copy address display
│   └── ui/                                 # shadcn/ui primitives (button, card, input, tabs, etc.)
├── contracts/                              # Solidity smart contracts
│   ├── LendingBorrowing.sol                # Collateralized lending protocol
│   └── TestnetERC20.sol                    # Mintable ERC20 for testnet (deployed as USDC)
├── contexts/
│   └── WalletContext.tsx                   # Dual-wallet state (MetaMask + Circle passkey)
├── hooks/
│   ├── useContractWrite.ts                 # Unified write hook for both wallet types
│   └── lending/                            # Lending hook modules
│       ├── index.ts
│       ├── useLendingState.ts              # Pool and user position state
│       └── useLendingActions.ts            # Deposit, withdraw, borrow, repay actions
├── lib/
│   ├── contracts/                          # Contract definitions
│   │   ├── addresses.ts                    # Deployed contract addresses from env vars
│   │   └── abis/                           # ABI definitions
│   ├── circle.ts                           # Circle passkey transport & client helpers
│   ├── errors.ts                           # Error parsing & user-friendly messages
│   ├── wagmi.ts                            # Wagmi + Arc Testnet chain config
│   └── utils.ts                            # Utility functions
├── public/                                 # Static assets
├── scripts/
│   └── deploy-lending.ts                   # Deploys mock USDC + LendingBorrowing, funds pool
├── hardhat.config.ts                       # Arc Testnet network & compiler settings
├── next.config.ts                          # Next.js configuration
├── package.json                            # All dependencies & scripts
└── .env.example                            # Environment variable template
```

## Security & Usage Model

This sample application:

- Targets Arc Testnet only
- Mock USDC is freely mintable — not suitable for production use without replacing with a real token
- cirBTC is an existing token on Arc Testnet and is not mintable via the app
- No interest rate model — this is an interest-free protocol for demonstration purposes
- Has no price oracle, interest or liquidation: the contract treats one unit of each token as worth the same. It must never hold real value
- Records history only from on-chain receipts (the browser cannot write it), but the history is public: anyone can read any wallet's rows
- Is not intended for production use without modification

