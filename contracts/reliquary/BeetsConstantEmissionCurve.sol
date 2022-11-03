// SPDX-License-Identifier: MIT

pragma solidity ^0.8.15;

import "../interfaces/IEmissionCurve.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BeetsConstantEmissionCurve is IEmissionCurve, Ownable {
    event EmissionUpdate(uint256 rewardsPerSecond);

    uint256 public rewardPerSecond;

    constructor(uint256 _rewardPerSecond) {
        rewardPerSecond = _rewardPerSecond;
    }

    function getRate(uint256 lastRewardTime)
        external
        view
        override
        returns (uint256)
    {
        return rewardPerSecond;
    }

    function setRate(uint256 _rewardPerSecond) external onlyOwner {
        rewardPerSecond = _rewardPerSecond;
        emit EmissionUpdate(_rewardPerSecond);
    }
}
