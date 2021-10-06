// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../token/BeethovenxMasterChef.sol";

// based on https://github.com/OpenZeppelin/openzeppelin-contracts/blob/v4.3.0/contracts/token/ERC20/utils/TokenTimelock.sol

/**
 * @dev A token holder contract that will allow a beneficiary to extract the
 * tokens after a given release time.
 *
 * Useful for simple vesting schedules like "advisors get all of their tokens
 * after 1 year".
 */

/*
    Additions:
        - stake tokens on deposit in master chef pool
        - allow withdrawal of master chef rewards at any time
        - un-stake and transfer tokens to beneficiary on release
*/
contract MasterChefLpTokenTimelock {
    using SafeERC20 for IERC20;

    // ERC20 basic token contract being held
    IERC20 private immutable _token;

    // beneficiary of tokens after they are released
    address private immutable _beneficiary;

    // timestamp when token release is enabled
    uint256 private immutable _releaseTime;

    BeethovenxMasterChef private _masterChef;

    uint256 private immutable _masterChefPoolId;

    constructor(
        IERC20 token_,
        address beneficiary_,
        uint256 releaseTime_,
        BeethovenxMasterChef masterChef_,
        uint256 masterChefPoolId_
    ) {
        require(
            releaseTime_ > block.timestamp,
            "TokenTimelock: release time is before current time"
        );
        require(
            masterChef_.lpTokens(masterChefPoolId_) == token_,
            "Provided poolId not eligible for this token"
        );
        _token = token_;
        _beneficiary = beneficiary_;
        _releaseTime = releaseTime_;
        _masterChef = masterChef_;
        _masterChefPoolId = masterChefPoolId_;
    }

    /**
     * @return the token being held.
     */
    function token() public view returns (IERC20) {
        return _token;
    }

    /**
     * @return the beneficiary of the tokens.
     */
    function beneficiary() public view returns (address) {
        return _beneficiary;
    }

    /**
     * @return the time when the tokens are released.
     */
    function releaseTime() public view returns (uint256) {
        return _releaseTime;
    }

    /**
     * @notice Transfers tokens held by timelock to beneficiary.
     */
    function release() public {
        require(
            block.timestamp >= releaseTime(),
            "TokenTimelock: current time is before release time"
        );

        (uint256 amount, uint256 rewardDebt) = _masterChef.userInfo(
            masterChefPoolId(),
            address(this)
        );
        // withdraw & harvest all from master chef
        _masterChef.withdrawAndHarvest(
            masterChefPoolId(),
            amount,
            beneficiary()
        );

        // release everything which remained on this contract
        uint256 localAmount = token().balanceOf(address(this));

        if (localAmount > 0) {
            token().safeTransfer(beneficiary(), localAmount);
        }
    }

    function masterChefPoolId() public view returns (uint256) {
        return _masterChefPoolId;
    }

    /**
     * @notice Transfers tokens held by timelock to master chef pool.
     */
    function depositAllToMasterChef(uint256 amount) external {
        _token.safeTransferFrom(msg.sender, address(this), amount);

        _token.approve(address(_masterChef), _token.balanceOf(address(this)));
        _masterChef.deposit(
            _masterChefPoolId,
            _token.balanceOf(address(this)),
            address(this)
        );
    }

    function harvest() external {
        _masterChef.harvest(masterChefPoolId(), beneficiary());
    }
}
