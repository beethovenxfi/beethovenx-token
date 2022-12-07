// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./IReliquaryMock.sol";

interface IReliquaryGamifiedMock is IReliquaryMock {
    function modifyMaturity(uint256 relicId, uint256 bonus) external;

    function commitLastMaturityBonus(uint256 relicId) external;

    function genesis(uint256 relicId) external view returns (uint256);

    function lastMaturityBonus(uint256 relicId) external view returns (uint256);
}
