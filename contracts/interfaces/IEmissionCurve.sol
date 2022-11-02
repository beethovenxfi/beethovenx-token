// SPDX-License-Identifier: MIT

pragma solidity ^0.8.15;

interface IEmissionCurve {
    function getRate(uint256 lastRewardTime)
        external
        view
        returns (uint256 rate);
}
