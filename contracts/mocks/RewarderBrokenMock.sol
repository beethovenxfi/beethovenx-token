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
    ) external pure override {
        revert("mock failure");
    }

    function pendingTokens(
        uint256,
        address,
        uint256
    ) external pure override returns (IERC20[] memory, uint256[] memory) {
        revert("mock failure");
    }
}
