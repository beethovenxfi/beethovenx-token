// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "./IRewardsOnlyGauge.sol";
import "./IChildChainStreamer.sol";

//import "hardhat/console.sol";

contract ChildChainGaugeRewardHelper {
    bytes32 public constant CLAIM_SIG = keccak256("get_reward()") >> (28 * 8);
    uint256 public constant CLAIM_FREQUENCY = 3600;

    function claimRewards(IRewardsOnlyGauge gauge) external {
        IChildChainStreamer streamer = IChildChainStreamer(
            gauge.reward_contract()
        );
        if (streamer.last_update_time() + CLAIM_FREQUENCY < block.timestamp) {
            gauge.claim_rewards(msg.sender);
        } else {
            streamer.get_reward();
            gauge.claim_rewards(msg.sender);
        }
    }

    function pendingRewards(IRewardsOnlyGauge gauge, address token)
        external
        returns (uint256)
    {
        IChildChainStreamer streamer = IChildChainStreamer(
            gauge.reward_contract()
        );
        uint256 lastUpdateTime = streamer.last_update_time();
        if (lastUpdateTime + CLAIM_FREQUENCY < block.timestamp) {
            return gauge.claimable_reward_write(msg.sender, token);
        } else {
            uint256 pendingOnGauge = gauge.claimable_reward(msg.sender, token);
            IChildChainStreamer.RewardToken memory rewardToken = streamer
                .reward_data(token);

            uint256 totalPendingOnStreamer = (block.timestamp -
                lastUpdateTime) *
                rewardToken.rate;

            uint256 rewardPerShare = (1e18 * totalPendingOnStreamer) /
                gauge.totalSupply();

            return
                pendingOnGauge +
                (gauge.balanceOf(msg.sender) * rewardPerShare) /
                1e18;
        }
    }
}
