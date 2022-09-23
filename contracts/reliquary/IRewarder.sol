// SPDX-License-Identifier: MIT

pragma solidity ^0.8.15;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IRewarder {
    function onOathReward(uint256 relicId, uint256 oathAmount) external;

    function onDeposit(uint256 relicId, uint256 depositAmount) external;

    function onWithdraw(uint256 relicId, uint256 withdrawalAmount) external;

    function pendingTokens(uint256 relicId, uint256 oathAmount)
        external
        view
        returns (IERC20[] memory, uint256[] memory);
}