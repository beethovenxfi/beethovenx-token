// SPDX-License-Identifier: MIT

// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;
import "../interfaces/IRewarder.sol";

contract RewarderBrokenMock is IRewarder {
    function onBeetsReward(
        uint256 pid,
        address user,
        address recipient,
        uint256 beetsAmount,
        uint256 newLpAmount
    ) external override {
        revert("mock failure");
    }

    function pendingTokens(
        uint256,
        address,
        uint256
    )
        external
        view
        override
        returns (IERC20[] memory rewardTokens, uint256[] memory rewardAmounts)
    {
        revert("mock failure");
    }
}
