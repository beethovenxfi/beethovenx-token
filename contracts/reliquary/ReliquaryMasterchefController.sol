// SPDX-License-Identifier: GPL-3.0-or-later
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

pragma solidity ^0.8.15;

import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../interfaces/IReliquary.sol";
import "../interfaces/IMasterChef.sol";
import "../interfaces/IBalancerPool.sol";


enum FarmStatus { ENABLED, DISABLED }

struct Farm {
    uint farmId;
    IERC20 token;
    bytes32 poolId;
    FarmStatus status;
}

struct Vote {
    uint farmId;
    uint amount;
}

struct FarmAllocation {
    uint farmId;
    uint allocPoints;
}

contract ReliquaryMasterchefController is ReentrancyGuard, AccessControlEnumerable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev Access control roles.
    bytes32 private constant OPERATOR = keccak256("OPERATOR");
    bytes32 private constant COMMITTEE_MEMBER = keccak256("COMMITTEE_MEMBER");

    IMasterChef public immutable masterChef;
    IReliquary public immutable reliquary;

    // 7 * 86400 seconds - all future times are rounded by week
    uint private constant WEEK = 604800;

    uint public maBeetsAllocPoints = 0;
    uint public committeeAllocPoints = 0;

    Farm[] public farms;

    // epoch -> relicId -> votes
    mapping(uint => mapping(uint => uint[])) private _relicVotes;
    // epoch -> farmId -> amount
    mapping(uint => mapping(uint => uint)) private _epochVotes;
    // epoch -> farmAllocations
    mapping(uint => uint[]) private _committeeEpochAllocations;
    // epoch -> allocationsPointsSet
    mapping(uint => bool) private _allocationPointsSetForEpoch;

    EnumerableSet.AddressSet private _supportedIncentiveTokens;

    // epoch -> farmId -> incentiveToken -> amount
    mapping(uint => mapping(uint => mapping(address => uint))) private _incentives;
    // epoch -> farmId -> incentiveToken -> relicId -> hasClaimed
    mapping(uint => mapping(uint => mapping(address => mapping(uint => bool)))) private _incentiveClaims;
    
    // events
    event IncentiveDeposited(uint indexed epoch, uint indexed farmId, address indexed incentiveToken, uint amount);

    // errors
    error NotApprovedOrOwner();
    error FarmDoesNotExist();
    error FarmIsDisabled();
    error FarmIsEnabled();
    error AmountExceedsVotingPower();
    error NoNewFarmsToSync();
    error ArrayLengthMismatch();
    error CommitteeAllocationGreaterThanControlled();
    error AllocationPointsAlreadySetForCurrentEpoch();
    error ZeroAmount();
    error IncentiveTokenAlreadySupported();
    error UnsupportedIncentiveToken();
    error NoIncentivesForEpoch();
    error NoVotesForEpoch();
    error RelicDidNotVoteForThisFarm();
    error IncentivesForEpochNotYetClaimable();
    error IncentivesAlreadyClaimed();

    constructor(IMasterChef _masterChef, IReliquary _reliquary, uint _maBeetsAllocPoints, uint _committeeAllocPoints) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        masterChef = _masterChef;
        reliquary = _reliquary;
        maBeetsAllocPoints = _maBeetsAllocPoints;
        committeeAllocPoints = _committeeAllocPoints;
    }

    function getNextEpochTimestamp() public view returns (uint) {
        return (block.timestamp + WEEK) / WEEK * WEEK;
    }

    function getCurrentEpochTimestamp() public view returns (uint) {
        return (block.timestamp) / WEEK * WEEK;
    }

    function setMaBeetsAllocPoints(uint numAllocPoints) external onlyRole(OPERATOR) {
        maBeetsAllocPoints = numAllocPoints;
    }

    function setCommitteeAllocPoints(uint numAllocPoints) external onlyRole(OPERATOR) {
        committeeAllocPoints = numAllocPoints;
    }

    function syncFarms(uint lastFarmId, FarmStatus initialStatus) external onlyRole(OPERATOR) {
        if (lastFarmId == farms.length - 1) revert NoNewFarmsToSync();

        uint firstFarmId = farms.length;

        for (uint i = firstFarmId; i <= lastFarmId; i++) {
            // this call will revert if the farmId does not exist
            IMasterChef.PoolInfo memory poolInfo = masterChef.poolInfo(i);

            farms.push(
                Farm({
                    farmId: i,
                    token: poolInfo.lpToken,
                    poolId: _getBalancerPoolId(poolInfo.lpToken),
                    status: initialStatus
                })
            );
        }
    }

    function enableFarm(uint farmId) external onlyRole(OPERATOR) {
        _requireFarmValidAndNotDisabled(farmId);
        
        farms[farmId].status = FarmStatus.ENABLED;
    }

    function disableFarm(uint farmId) external onlyRole(OPERATOR) {
        _requireFarmValidAndNotDisabled(farmId);

        farms[farmId].status = FarmStatus.DISABLED;
    }

    function setVotesForRelics(uint[] memory relicIds, Vote[][] memory votes) external nonReentrant {
        if (relicIds.length != votes.length) revert ArrayLengthMismatch();

        for (uint i = 0; i < relicIds.length; i++) {
            _setVotesForRelic(relicIds[i], votes[i]);
        }
    }

    function setVotesForRelic(uint relicId, Vote[] memory votes) public nonReentrant {
        _setVotesForRelic(relicId, votes);
    }

    function _setVotesForRelic(uint relicId, Vote[] memory votes) internal {
        _requireIsApprovedOrOwner(relicId);

        uint nextEpoch = getNextEpochTimestamp();
        PositionInfo memory position = reliquary.getPositionForId(relicId);
        LevelInfo memory level = reliquary.getLevelInfo(position.poolId);

        _clearPreviousVotes(relicId, nextEpoch);

        uint[] memory relicVotes = new uint[](farms.length);
        uint assignedAmount = 0;
        uint votingPower = level.multipliers[position.level]
            / level.multipliers[level.multipliers.length - 1]
            * position.amount;
        
        for (uint i = 0; i < votes.length; i++) {
            assignedAmount += votes[i].amount;

            _requireFarmValidAndNotDisabled(votes[i].farmId);

            _epochVotes[nextEpoch][votes[i].farmId] = _epochVotes[nextEpoch][votes[i].farmId] + votes[i].amount;
            relicVotes[votes[i].farmId] = votes[i].amount;
        }

        if (assignedAmount > votingPower) revert AmountExceedsVotingPower();

        _relicVotes[nextEpoch][relicId] = relicVotes; 
    }

    function getTotalVotesForEpoch(uint epoch) public view returns (uint) {
        uint totalEpochVotes = 0;

        for (uint i = 0; i < farms.length; i++) {
            totalEpochVotes += _epochVotes[epoch][i];
        }

        return totalEpochVotes;
    }

    function getRelicVotesForEpoch(uint relicId, uint epoch) external view returns (uint[] memory) {
        return _relicVotes[epoch][relicId];
    }

    function getEpochVotes(uint epoch) external view returns (Vote[] memory) {
        Vote[] memory votes = new Vote[](farms.length);

        for (uint i = 0; i < farms.length; i++) {
            votes[i] = Vote({
                farmId: i,
                amount: _epochVotes[epoch][i]
            });
        }

        return votes;
    }

    function getMaBeetsAllocationsForEpoch(uint epoch) public view returns (uint[] memory) {
        uint[] memory allocations = new uint[](farms.length);
        uint totalEpochVotes = getTotalVotesForEpoch(epoch);

        for (uint i = 0; i < farms.length; i++) {
            // TODO: correct math and handle rounding errors here
            allocations[i] = _epochVotes[epoch][i] * maBeetsAllocPoints / totalEpochVotes;
        }

        return allocations;
    }

    function setCommitteeAllocationsForEpoch(FarmAllocation[] memory allocations) external onlyRole(COMMITTEE_MEMBER) {
        uint[] memory committeeAllocations = new uint[](farms.length);
        uint totalAllocPoints = 0;

        for (uint i = 0; i < allocations.length; i++) {
            _requireFarmValidAndNotDisabled(allocations[i].farmId);

            totalAllocPoints += allocations[i].allocPoints;
            committeeAllocations[allocations[i].farmId] = allocations[i].allocPoints;
        }

        if (totalAllocPoints > committeeAllocPoints) revert CommitteeAllocationGreaterThanControlled();

        _committeeEpochAllocations[getNextEpochTimestamp()] = committeeAllocations;
    }

    function getCommitteeAllocationsForEpoch(uint epoch) external view returns (uint[] memory) {
        return _committeeEpochAllocations[epoch];
    }

    function getAllocationsForEpoch(uint epoch) public view returns (uint[] memory) {
        uint[] memory allocations = new uint[](farms.length);
        uint[] memory maBeetsAllocations = getMaBeetsAllocationsForEpoch(epoch);

        for (uint i = 0; i < farms.length; i++) {
            allocations[i] = _committeeEpochAllocations[epoch][i];
            allocations[i] += maBeetsAllocations[i];
        }

        return allocations;
    }

    function addSupportedIncentiveToken(IERC20 incentiveToken) external onlyRole(OPERATOR) {
        if (_supportedIncentiveTokens.contains(address(incentiveToken))) revert IncentiveTokenAlreadySupported();

        _supportedIncentiveTokens.add(address(incentiveToken));
    }

    function getSupportedIncentiveTokens() external view returns (address[] memory) {
        return _supportedIncentiveTokens.values();
    }

    function depositIncentiveForFarm(uint farmId, IERC20 incentiveToken, uint incentiveAmount) external nonReentrant {
        _requireIsSupportedIncentiveToken(incentiveToken);
        if (incentiveAmount == 0) revert ZeroAmount();

        uint nextEpoch = getNextEpochTimestamp();

        _incentives[nextEpoch][farmId][address(incentiveToken)] += incentiveAmount; 

        incentiveToken.safeTransferFrom(msg.sender, address(this), incentiveAmount);

        emit IncentiveDeposited(nextEpoch, farmId, address(incentiveToken), incentiveAmount);
    }

    function claimIncentivesForFarm(
        uint relicId,
        uint farmId,
        uint epoch,
        IERC20 incentiveToken,
        address recipient
    ) external nonReentrant {
        if (farmId >= farms.length) revert FarmDoesNotExist();
        _requireIsApprovedOrOwner(relicId);
        _requireIsSupportedIncentiveToken(incentiveToken);
        if (epoch > getCurrentEpochTimestamp()) revert IncentivesForEpochNotYetClaimable();

        if (_incentiveClaims[epoch][farmId][address(incentiveToken)][relicId] == true) {
            revert IncentivesAlreadyClaimed();
        }

        uint incentivesForFarm = _incentives[epoch][farmId][address(incentiveToken)];
        uint totalVotesForFarm = _epochVotes[epoch][farmId];
        uint relicVotesForFarm = _relicVotes[epoch][relicId][farmId];

        if (incentivesForFarm == 0) revert NoIncentivesForEpoch();
        if (totalVotesForFarm == 0) revert NoVotesForEpoch();
        if (relicVotesForFarm == 0) revert RelicDidNotVoteForThisFarm();
        
        _incentiveClaims[epoch][farmId][address(incentiveToken)][relicId] = true;
        
        //TODO: manage rounding and fix math
        uint incentivesForRelic = incentivesForFarm * (relicVotesForFarm / totalVotesForFarm);

        incentiveToken.safeTransfer(recipient, incentivesForRelic);
    }

    function _getBalancerPoolId(IERC20 token) internal view returns (bytes32) {
        // It's possible that the token is not a pool, in which case we return an empty string
        try IBalancerPool(address(token)).getPoolId() returns (bytes32 poolId) {
            return poolId;
        } catch {
            return "";
        }
    }

    function _requireFarmValidAndNotDisabled(uint farmId) private view {
        if (farmId >= farms.length) revert FarmDoesNotExist();
        if (farms[farmId].status == FarmStatus.DISABLED) revert FarmIsDisabled();
    }

    function _requireIsApprovedOrOwner(uint relicId) private view {
        if (!reliquary.isApprovedOrOwner(msg.sender, relicId)) revert NotApprovedOrOwner();
    }

    function _requireIsSupportedIncentiveToken(IERC20 incentiveToken) private view {
        if (!_supportedIncentiveTokens.contains(address(incentiveToken))) revert UnsupportedIncentiveToken();
    }

    function _clearPreviousVotes(uint relicId, uint nextEpoch) private {
        uint[] memory votes = _relicVotes[nextEpoch][relicId]; 

        for (uint i = 0; i < votes.length; i++) {
            _epochVotes[nextEpoch][i] = _epochVotes[nextEpoch][i] - votes[i];
        }
    }

    // This is just a reference implementation, good chance it wouldn't work exactly like this
    function setMasterchefAllocationPointsForCurrentEpoch() external onlyRole(OPERATOR) {
        uint epoch = getCurrentEpochTimestamp();
        uint[] memory allocations = getAllocationsForEpoch(epoch);

        if (_allocationPointsSetForEpoch[epoch] == true) revert AllocationPointsAlreadySetForCurrentEpoch();

        for (uint i = 0; i < farms.length; i++) {
            masterChef.set(i, allocations[i], IRewarder(address(0)), false);
        }
    }
}