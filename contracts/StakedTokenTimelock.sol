// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BeethovenxMasterChef.sol";

/**
 * @dev A token holder contract that will allow a beneficiary to extract the
 * tokens after a given release time.
 *
 * Useful for simple vesting schedules like "advisors get all of their tokens
 * after 1 year".
 */
contract StakedTokenTimelock {
    using SafeERC20 for IERC20;

    // ERC20 basic token contract being held
    IERC20 private immutable _token;

    // beneficiary of tokens after they are released
    address private immutable _beneficiary;

    // timestamp when token release is enabled
    uint256 private immutable _releaseTime;

    BeethovenxMasterChef private _masterChef;

    constructor(
        IERC20 token_,
        address beneficiary_,
        uint256 releaseTime_,
        BeethovenxMasterChef masterChef_
    ) {
        require(releaseTime_ > block.timestamp, "TokenTimelock: release time is before current time");
        _token = token_;
        _beneficiary = beneficiary_;
        _releaseTime = releaseTime_;
        _masterChef = masterChef_;
    }

    /**
     * @return the token being held.
     */
    function token() public view virtual returns (IERC20) {
        return _token;
    }

    /**
     * @return the beneficiary of the tokens.
     */
    function beneficiary() public view virtual returns (address) {
        return _beneficiary;
    }

    /**
     * @return the time when the tokens are released.
     */
    function releaseTime() public view virtual returns (uint256) {
        return _releaseTime;
    }

    /**
     * @notice Transfers tokens held by timelock to beneficiary.
     */
    function release() public virtual {
        require(block.timestamp >= releaseTime(), "TokenTimelock: current time is before release time");

        uint256 amount = token().balanceOf(address(this));
        require(amount > 0, "TokenTimelock: no tokens to release");

        token().safeTransfer(beneficiary(), amount);
    }

//    function deposit(uint256 _pid) external {
//       _masterChef.deposit(pid, _token.balanceOf(address(this)), address(this)));
//    }
}