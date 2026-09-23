// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LendingBorrowing
 * @notice A simple lending and borrowing protocol for demonstration.
 *         Users deposit a collateral token and borrow a lending token against it.
 *
 * Lifecycle:
 *   1. Owner funds the pool with the lending token via fundPool().
 *   2. Users deposit collateral via depositCollateral().
 *   3. Users borrow (up to collateralFactor% of their collateral) via takeLoan().
 *   4. Users repay their loan (partially or fully) via repayLoan().
 *   5. Once the loan is fully repaid, users may withdraw collateral via withdrawCollateral().
 *
 * Collateral factor:
 *   A value of 50 means users can borrow up to 50% of their deposited collateral.
 *   Both tokens are assumed to have the same decimals and to be worth the same per unit:
 *   there is NO price oracle, NO interest and NO liquidation. Not for use with real value.
 *
 * Token assumptions (enforced): the two tokens must differ, and every transfer must move
 * exactly the amount requested. Fee-on-transfer tokens are rejected rather than credited
 * for more than the contract received.
 */
contract LendingBorrowing is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Loan {
        uint256 amount;     // ARCT currently owed
        uint256 collateral; // USDC locked when the loan was taken
        bool isActive;
    }

    IERC20 public immutable collateralToken; // USDC
    IERC20 public immutable lendingToken;    // ARCT
    uint256 public collateralFactor;         // percentage, e.g. 50 = 50%

    mapping(address => uint256) public collateralBalances;
    mapping(address => Loan) public loans;

    event CollateralDeposited(address indexed user, uint256 amount);
    event CollateralWithdrawn(address indexed user, uint256 amount);
    event LoanTaken(address indexed user, uint256 amount);
    event LoanRepaid(address indexed user, uint256 amount);
    event PoolFunded(uint256 amount);
    event CollateralFactorUpdated(uint256 newFactor);

    constructor(
        address _collateralToken,
        address _lendingToken,
        uint256 _collateralFactor
    ) Ownable(msg.sender) {
        require(_collateralToken != address(0), "Invalid collateral token");
        require(_lendingToken != address(0), "Invalid lending token");
        // If both were the same token, depositors' collateral would count as pool liquidity
        // and borrowers could take it.
        require(_collateralToken != _lendingToken, "Tokens must differ");
        require(_collateralFactor > 0 && _collateralFactor <= 100, "Factor must be 1-100");
        collateralToken = IERC20(_collateralToken);
        lendingToken = IERC20(_lendingToken);
        collateralFactor = _collateralFactor;
    }

    // ─── User actions ────────────────────────────────────────────────

    /// @notice Deposit USDC as collateral. Requires prior ERC20 approval.
    function depositCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        _pull(collateralToken, msg.sender, amount);
        collateralBalances[msg.sender] += amount;
        emit CollateralDeposited(msg.sender, amount);
    }

    /// @notice Borrow ARCT against deposited USDC collateral.
    ///         Only one active loan per user at a time.
    function takeLoan(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(!loans[msg.sender].isActive, "Repay existing loan first");

        uint256 maxBorrowAmount = (collateralBalances[msg.sender] * collateralFactor) / 100;
        require(amount <= maxBorrowAmount, "Exceeds borrow limit");
        require(lendingToken.balanceOf(address(this)) >= amount, "Insufficient pool liquidity");

        loans[msg.sender] = Loan({
            amount: amount,
            collateral: collateralBalances[msg.sender],
            isActive: true
        });

        lendingToken.safeTransfer(msg.sender, amount);
        emit LoanTaken(msg.sender, amount);
    }

    /// @notice Repay ARCT loan (partially or fully). Requires prior ERC20 approval.
    function repayLoan(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        Loan storage loan = loans[msg.sender];
        require(loan.isActive, "No active loan");
        require(amount <= loan.amount, "Amount exceeds outstanding loan");

        loan.amount -= amount;
        _pull(lendingToken, msg.sender, amount);

        if (loan.amount == 0) {
            loan.isActive = false;
            loan.collateral = 0;
        }

        emit LoanRepaid(msg.sender, amount);
    }

    /// @notice Withdraw USDC collateral that is not locked by an active loan.
    function withdrawCollateral(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");

        uint256 locked = loans[msg.sender].isActive ? loans[msg.sender].collateral : 0;
        uint256 available = collateralBalances[msg.sender] - locked;
        require(amount <= available, "Insufficient available collateral");

        collateralBalances[msg.sender] -= amount;
        collateralToken.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    // ─── Owner actions ───────────────────────────────────────────────

    /// @notice Fund the lending pool with ARCT. Requires prior ERC20 approval.
    function fundPool(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be > 0");
        _pull(lendingToken, msg.sender, amount);
        emit PoolFunded(amount);
    }

    /// @notice Update the collateral factor (1-100).
    function setCollateralFactor(uint256 _collateralFactor) external onlyOwner {
        require(_collateralFactor > 0 && _collateralFactor <= 100, "Factor must be 1-100");
        collateralFactor = _collateralFactor;
        emit CollateralFactorUpdated(_collateralFactor);
    }

    // ─── View helpers ────────────────────────────────────────────────

    /// @notice Returns the maximum ARCT a user can currently borrow.
    function maxBorrow(address user) external view returns (uint256) {
        if (loans[user].isActive) return 0;
        return (collateralBalances[user] * collateralFactor) / 100;
    }

    /// @notice Returns the USDC collateral available to withdraw (not locked by a loan).
    function availableCollateral(address user) external view returns (uint256) {
        uint256 locked = loans[user].isActive ? loans[user].collateral : 0;
        return collateralBalances[user] - locked;
    }

    /// @notice Returns current ARCT liquidity in the pool.
    function poolLiquidity() external view returns (uint256) {
        return lendingToken.balanceOf(address(this));
    }

    // ─── Internal ────────────────────────────────────────────────────

    /// @dev Pulls `amount` of `token` from `from` and requires that exactly that much
    ///      arrived. Balances are credited from the requested amount, so a token that
    ///      delivers less (a transfer fee) would otherwise leave the contract insolvent.
    function _pull(IERC20 token, address from, uint256 amount) private {
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        require(token.balanceOf(address(this)) - before == amount, "Unsupported token: transfer fee");
    }
}
