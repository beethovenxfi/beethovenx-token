// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import "./ReliquaryMock.sol";
import "./IReliquaryGamifiedMock.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

contract ReliquaryGamifiedMock is ReliquaryMock, IReliquaryGamifiedMock {
    /// @dev Access control role.
    bytes32 private constant MATURITY_MODIFIER = keccak256("MATURITY_MODIFIER");

    /// @notice relicId => timestamp of Relic creation.
    mapping(uint => uint) public genesis;
    /// @notice relicId => timestamp of last committed maturity bonu.
    mapping(uint => uint) public lastMaturityBonus;

    /// @dev Event emitted when a maturity bonus is actually applied.
    event MaturityBonus(uint indexed pid, address indexed to, uint indexed relicId, uint bonus);

    constructor(address _rewardToken, address _emissionCurve) ReliquaryMock(_rewardToken, _emissionCurve) {}

    /**
     * @notice Allows an address with the MATURITY_MODIFIER role to modify a position's maturity.
     * @param relicId The NFT ID of the position being modified.
     * @param bonus Number of seconds to reduce the position's entry by (increasing maturity).
     */
    function modifyMaturity(uint relicId, uint bonus) external override onlyRole(MATURITY_MODIFIER) {
        PositionInfo storage position = positionForId[relicId];
        position.entry -= bonus;
        _updatePosition(0, relicId, Kind.OTHER, address(0));

        emit MaturityBonus(position.poolId, ownerOf(relicId), relicId, bonus);
    }

    /// @dev Commit or "spend" the last maturity bonus time of the Relic before value of bonus is revealed, resetting
    /// any time limit enforced by MATURITY_MODIFIER.
    function commitLastMaturityBonus(uint relicId) external override onlyRole(MATURITY_MODIFIER) {
        lastMaturityBonus[relicId] = block.timestamp;
    }

    /// @inheritdoc ReliquaryMock
    function createRelicAndDeposit(address to, uint pid, uint amount)
        public
        override (IReliquaryMock, ReliquaryMock)
        returns (uint id)
    {
        id = super.createRelicAndDeposit(to, pid, amount);
        genesis[id] = block.timestamp;
    }

    /// @inheritdoc ReliquaryMock
    function split(uint fromId, uint amount, address to) public override (IReliquaryMock, ReliquaryMock) returns (uint newId) {
        newId = super.split(fromId, amount, to);
        genesis[newId] = block.timestamp;
    }

    /// Ensure users can't benefit from shifting tokens from a Relic with a spent maturity bonus to a different one.
    /// @inheritdoc ReliquaryMock
    function shift(uint fromId, uint toId, uint amount) public override (IReliquaryMock, ReliquaryMock) {
        super.shift(fromId, toId, amount);
        lastMaturityBonus[toId] = Math.max(lastMaturityBonus[fromId], lastMaturityBonus[toId]);
    }

    /// Ensure users can't benefit from merging tokens from a Relic with a spent maturity bonus to a different one.
    /// @inheritdoc ReliquaryMock
    function merge(uint fromId, uint toId) public override (IReliquaryMock, ReliquaryMock) {
        super.merge(fromId, toId);
        lastMaturityBonus[toId] = Math.max(lastMaturityBonus[fromId], lastMaturityBonus[toId]);
    }

    /// @inheritdoc ReliquaryMock
    function burn(uint tokenId) public override (IReliquaryMock, ReliquaryMock) {
        delete genesis[tokenId];
        delete lastMaturityBonus[tokenId];
        super.burn(tokenId);
    }

    /// @inheritdoc ReliquaryMock
    function supportsInterface(bytes4 interfaceId) public view override (IERC165, ReliquaryMock) returns (bool) {
        return interfaceId == type(IReliquaryGamifiedMock).interfaceId || super.supportsInterface(interfaceId);
    }
}
