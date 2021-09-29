// SPDX-License-Identifier: MIT


// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;
import "../interfaces/IRewarder.sol";


contract RewarderBrokenMock is IRewarder {

    function onBeetsReward (uint256, address, address, uint256, uint256) override external {
        revert();
    }

    function pendingTokens(uint256 pid, address user, uint256 beetsAmount) override external view returns (IERC20[] memory rewardTokens, uint256[] memory rewardAmounts){
        revert();
    }

}
