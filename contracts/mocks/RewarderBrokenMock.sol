// SPDX-License-Identifier: MIT

// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;
import "../interfaces/IRewarder.sol";

contract RewarderBrokenMock is IRewarder {
    function onBeetsReward(
        uint256,
        address,
        address,
        uint256,
        uint256
    ) external override {
        revert();
    }

    function pendingTokens(
        uint256 pid,
        address user,
        uint256 beetsAmount
    )
        external
        view
        override
        returns (IERC20[] memory rewardTokens, uint256[] memory rewardAmounts)
    {
        revert();
    }
}
