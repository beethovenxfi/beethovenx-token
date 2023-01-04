// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./IReliquaryMock.sol";

interface IReliquaryGamifiedMock is IReliquaryMock {
    function modifyMaturity(uint relicId, uint bonus) external;
    function commitLastMaturityBonus(uint relicId) external;

    function genesis(uint relicId) external view returns (uint);
    function lastMaturityBonus(uint relicId) external view returns (uint);
}
