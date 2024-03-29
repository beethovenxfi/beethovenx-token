// SPDX-License-Identifier: MIT

pragma solidity ^0.8.15;

interface IReliquaryRewarder {
    function onReward(
        uint256 relicId,
        uint256 rewardAmount,
        address to
    ) external;

    function onDeposit(uint256 relicId, uint256 depositAmount) external;

    function onWithdraw(uint256 relicId, uint256 withdrawalAmount) external;

    function pendingTokens(uint256 relicId, uint256 rewardAmount)
        external
        view
        returns (address[] memory, uint256[] memory);
}
