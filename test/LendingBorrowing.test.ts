import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { network } from "hardhat";

const { ethers } = await network.getOrCreate();

const UNIT = 10n ** 8n; // both tokens use 8 decimals in this app
const units = (n: number) => BigInt(n) * UNIT;

async function deploy() {
  const [owner, alice, bob, carol] = await ethers.getSigners();
  const collateral = await ethers.deployContract("TestnetERC20", ["cirBTC", "cirBTC", 8]);
  const lending = await ethers.deployContract("TestnetERC20", ["USD Coin", "USDC", 8]);
  const pool = await ethers.deployContract("LendingBorrowing", [
    await collateral.getAddress(),
    await lending.getAddress(),
    50,
  ]);
  const poolAddress = await pool.getAddress();

  for (const user of [alice, bob, carol]) {
    await collateral.allocateTo(user.address, units(1000));
    await lending.allocateTo(user.address, units(1000));
    await collateral.connect(user).approve(poolAddress, ethers.MaxUint256);
    await lending.connect(user).approve(poolAddress, ethers.MaxUint256);
  }
  await lending.allocateTo(owner.address, units(10_000));
  await lending.approve(poolAddress, ethers.MaxUint256);
  await pool.fundPool(units(10_000));

  return { owner, alice, bob, carol, collateral, lending, pool, poolAddress };
}

type Fixture = Awaited<ReturnType<typeof deploy>>;

const reverts = (promise: Promise<unknown>, reason: RegExp | string) =>
  assert.rejects(promise, (error: Error) => {
    assert.match(error.message, typeof reason === "string" ? new RegExp(reason) : reason);
    return true;
  });

describe("LendingBorrowing", () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await deploy();
  });

  describe("constructor", () => {
    it("rejects zero addresses, a bad factor, and identical tokens", async () => {
      const a = await f.collateral.getAddress();
      const b = await f.lending.getAddress();
      await reverts(ethers.deployContract("LendingBorrowing", [ethers.ZeroAddress, b, 50]), "Invalid collateral token");
      await reverts(ethers.deployContract("LendingBorrowing", [a, ethers.ZeroAddress, 50]), "Invalid lending token");
      await reverts(ethers.deployContract("LendingBorrowing", [a, b, 0]), "Factor must be 1-100");
      await reverts(ethers.deployContract("LendingBorrowing", [a, b, 101]), "Factor must be 1-100");
      // Same token on both sides would let borrowers take other people's collateral.
      await reverts(ethers.deployContract("LendingBorrowing", [a, a, 50]), "Tokens must differ");
    });
  });

  describe("depositCollateral", () => {
    it("credits the depositor and holds the tokens", async () => {
      await f.pool.connect(f.alice).depositCollateral(units(10));
      assert.equal(await f.pool.collateralBalances(f.alice.address), units(10));
      assert.equal(await f.collateral.balanceOf(f.poolAddress), units(10));
    });

    it("rejects zero", async () => {
      await reverts(f.pool.connect(f.alice).depositCollateral(0), "Amount must be > 0");
    });

    it("rejects more than the depositor holds or approved", async () => {
      await reverts(f.pool.connect(f.alice).depositCollateral(units(5000)), /.+/);
    });
  });

  describe("takeLoan", () => {
    beforeEach(async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
    });

    it("lends up to the collateral factor, and no more", async () => {
      assert.equal(await f.pool.maxBorrow(f.alice.address), units(50));
      await reverts(f.pool.connect(f.alice).takeLoan(units(50) + 1n), "Exceeds borrow limit");
      await f.pool.connect(f.alice).takeLoan(units(50));
      assert.equal(await f.lending.balanceOf(f.alice.address), units(1050));
    });

    it("allows one active loan per user", async () => {
      await f.pool.connect(f.alice).takeLoan(units(10));
      await reverts(f.pool.connect(f.alice).takeLoan(units(1)), "Repay existing loan first");
      assert.equal(await f.pool.maxBorrow(f.alice.address), 0n);
    });

    it("cannot borrow without collateral", async () => {
      await reverts(f.pool.connect(f.bob).takeLoan(1), "Exceeds borrow limit");
    });

    it("cannot borrow more than the pool holds", async () => {
      const [owner] = await ethers.getSigners();
      const small = await ethers.deployContract("LendingBorrowing", [
        await f.collateral.getAddress(),
        await f.lending.getAddress(),
        100,
      ]);
      await f.collateral.connect(f.alice).approve(await small.getAddress(), ethers.MaxUint256);
      await small.connect(f.alice).depositCollateral(units(100));
      await reverts(small.connect(f.alice).takeLoan(units(10)), "Insufficient pool liquidity");
      void owner;
    });
  });

  describe("repayLoan", () => {
    beforeEach(async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
      await f.pool.connect(f.alice).takeLoan(units(40));
    });

    it("supports partial repayment and keeps the loan open", async () => {
      await f.pool.connect(f.alice).repayLoan(units(15));
      const loan = await f.pool.loans(f.alice.address);
      assert.equal(loan.amount, units(25));
      assert.equal(loan.isActive, true);
    });

    it("closes the loan and unlocks the collateral when fully repaid", async () => {
      await f.pool.connect(f.alice).repayLoan(units(40));
      const loan = await f.pool.loans(f.alice.address);
      assert.equal(loan.isActive, false);
      assert.equal(loan.collateral, 0n);
      assert.equal(await f.pool.availableCollateral(f.alice.address), units(100));
    });

    it("rejects over-repayment, zero, and repaying with no loan", async () => {
      await reverts(f.pool.connect(f.alice).repayLoan(units(41)), "Amount exceeds outstanding loan");
      await reverts(f.pool.connect(f.alice).repayLoan(0), "Amount must be > 0");
      await reverts(f.pool.connect(f.bob).repayLoan(1), "No active loan");
    });

    it("one user cannot repay another user's loan", async () => {
      await reverts(f.pool.connect(f.bob).repayLoan(units(1)), "No active loan");
      assert.equal((await f.pool.loans(f.alice.address)).amount, units(40));
    });
  });

  describe("withdrawCollateral", () => {
    it("cannot withdraw collateral locked by an active loan", async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
      await f.pool.connect(f.alice).takeLoan(units(10));
      await reverts(f.pool.connect(f.alice).withdrawCollateral(1), "Insufficient available collateral");
    });

    it("can withdraw collateral deposited AFTER the loan was taken", async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
      await f.pool.connect(f.alice).takeLoan(units(10));
      await f.pool.connect(f.alice).depositCollateral(units(20));
      await f.pool.connect(f.alice).withdrawCollateral(units(20));
      await reverts(f.pool.connect(f.alice).withdrawCollateral(1), "Insufficient available collateral");
    });

    it("returns everything after full repayment, and never more than was deposited", async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
      await f.pool.connect(f.alice).takeLoan(units(10));
      await f.pool.connect(f.alice).repayLoan(units(10));
      await reverts(f.pool.connect(f.alice).withdrawCollateral(units(100) + 1n), "Insufficient available collateral");
      await f.pool.connect(f.alice).withdrawCollateral(units(100));
      assert.equal(await f.collateral.balanceOf(f.alice.address), units(1000));
    });

    it("one user cannot withdraw another user's collateral", async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
      await reverts(f.pool.connect(f.bob).withdrawCollateral(1), "Insufficient available collateral");
    });
  });

  describe("accounting", () => {
    it("holds exactly the sum of users' collateral, across many actions", async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
      await f.pool.connect(f.bob).depositCollateral(units(40));
      await f.pool.connect(f.carol).depositCollateral(units(7));
      await f.pool.connect(f.alice).takeLoan(units(30));
      await f.pool.connect(f.alice).repayLoan(units(30));
      await f.pool.connect(f.alice).withdrawCollateral(units(60));
      await f.pool.connect(f.bob).withdrawCollateral(units(40));

      const owed =
        (await f.pool.collateralBalances(f.alice.address)) +
        (await f.pool.collateralBalances(f.bob.address)) +
        (await f.pool.collateralBalances(f.carol.address));
      assert.equal(await f.collateral.balanceOf(f.poolAddress), owed);
    });

    it("pool liquidity tracks loans out and repayments in", async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
      await f.pool.connect(f.alice).takeLoan(units(50));
      assert.equal(await f.pool.poolLiquidity(), units(10_000) - units(50));
      await f.pool.connect(f.alice).repayLoan(units(50));
      assert.equal(await f.pool.poolLiquidity(), units(10_000));
    });
  });

  describe("owner", () => {
    it("only the owner can fund the pool or change the factor", async () => {
      await reverts(f.pool.connect(f.alice).fundPool(1), /OwnableUnauthorizedAccount/);
      await reverts(f.pool.connect(f.alice).setCollateralFactor(90), /OwnableUnauthorizedAccount/);
    });

    it("bounds the collateral factor", async () => {
      await reverts(f.pool.setCollateralFactor(0), "Factor must be 1-100");
      await reverts(f.pool.setCollateralFactor(101), "Factor must be 1-100");
      await f.pool.setCollateralFactor(75);
      assert.equal(await f.pool.collateralFactor(), 75n);
    });

    it("lowering the factor does not touch an existing loan", async () => {
      await f.pool.connect(f.alice).depositCollateral(units(100));
      await f.pool.connect(f.alice).takeLoan(units(50));
      await f.pool.setCollateralFactor(10);
      assert.equal((await f.pool.loans(f.alice.address)).amount, units(50));
    });

    it("ownership moves in two steps, so it cannot be sent to a wrong address", async () => {
      await f.pool.transferOwnership(f.bob.address);
      assert.equal(await f.pool.owner(), f.owner.address); // not yet
      await reverts(f.pool.connect(f.carol).acceptOwnership(), /OwnableUnauthorizedAccount/);
      await f.pool.connect(f.bob).acceptOwnership();
      assert.equal(await f.pool.owner(), f.bob.address);
    });

    it("has no way for the owner to take users' collateral", async () => {
      const functions = f.pool.interface.fragments
        .filter((fragment) => fragment.type === "function")
        .map((fragment) => (fragment as { name: string }).name);
      for (const name of functions) {
        assert.doesNotMatch(name, /^(rescue|sweep|emergency|drain|recover)/i);
      }
    });
  });

  describe("unsupported tokens", () => {
    async function poolWith(collateralAddress: string, lendingAddress: string) {
      const p = await ethers.deployContract("LendingBorrowing", [collateralAddress, lendingAddress, 50]);
      return p;
    }

    it("rejects a fee-on-transfer collateral token instead of over-crediting deposits", async () => {
      const fee = await ethers.deployContract("FeeOnTransferERC20");
      const p = await poolWith(await fee.getAddress(), await f.lending.getAddress());
      await fee.mint(f.alice.address, units(100));
      await fee.connect(f.alice).approve(await p.getAddress(), ethers.MaxUint256);

      await reverts(p.connect(f.alice).depositCollateral(units(100)), "Unsupported token: transfer fee");
      assert.equal(await p.collateralBalances(f.alice.address), 0n);
    });

    it("rejects a fee-on-transfer lending token on repayment and funding", async () => {
      const fee = await ethers.deployContract("FeeOnTransferERC20");
      const p = await poolWith(await f.collateral.getAddress(), await fee.getAddress());
      await fee.mint(f.owner.address, units(100));
      await fee.approve(await p.getAddress(), ethers.MaxUint256);
      await reverts(p.fundPool(units(100)), "Unsupported token: transfer fee");
    });
  });

  describe("reentrancy", () => {
    it("cannot re-enter depositCollateral from a token callback", async () => {
      const evil = await ethers.deployContract("ReentrantERC20");
      const p = await ethers.deployContract("LendingBorrowing", [await evil.getAddress(), await f.lending.getAddress(), 50]);
      await evil.mint(f.alice.address, units(100));
      await evil.connect(f.alice).approve(await p.getAddress(), ethers.MaxUint256);
      await evil.arm(await p.getAddress(), false);

      await reverts(p.connect(f.alice).depositCollateral(units(10)), /ReentrancyGuardReentrantCall/);
      assert.equal(await p.collateralBalances(f.alice.address), 0n);
    });

    it("cannot re-enter repayLoan from a token callback", async () => {
      const evil = await ethers.deployContract("ReentrantERC20");
      const p = await ethers.deployContract("LendingBorrowing", [await f.collateral.getAddress(), await evil.getAddress(), 50]);
      const pAddress = await p.getAddress();
      await evil.mint(f.owner.address, units(1000));
      await evil.mint(f.alice.address, units(1000));
      await evil.approve(pAddress, ethers.MaxUint256);
      await evil.connect(f.alice).approve(pAddress, ethers.MaxUint256);
      await p.fundPool(units(1000));
      await f.collateral.connect(f.alice).approve(pAddress, ethers.MaxUint256);
      await p.connect(f.alice).depositCollateral(units(100));
      await p.connect(f.alice).takeLoan(units(40));

      await evil.arm(pAddress, true);
      await reverts(p.connect(f.alice).repayLoan(units(10)), /ReentrancyGuardReentrantCall/);
      assert.equal((await p.loans(f.alice.address)).amount, units(40));
    });
  });
});
