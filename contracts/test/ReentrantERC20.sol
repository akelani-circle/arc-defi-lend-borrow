// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ILending {
    function depositCollateral(uint256 amount) external;
    function repayLoan(uint256 amount) external;
}

/// @dev TEST ONLY. An ERC20 whose transferFrom calls back into the lending contract
///      (as an ERC777-style hook would), to prove the entry points are not re-enterable.
contract ReentrantERC20 is ERC20 {
    ILending public target;
    bool public attackRepay;
    bool private inAttack;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 value) external {
        _mint(to, value);
    }

    function arm(address lending, bool repay) external {
        target = ILending(lending);
        attackRepay = repay;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (address(target) != address(0) && !inAttack) {
            inAttack = true;
            if (attackRepay) target.repayLoan(1);
            else target.depositCollateral(1);
            inAttack = false;
        }
        return super.transferFrom(from, to, value);
    }
}
