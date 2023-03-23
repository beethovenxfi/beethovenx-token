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

import "hardhat/console.sol";


enum FarmStatus { DISABLED, ENABLED }

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
    bytes32 public constant OPERATOR = keccak256("OPERATOR");
    bytes32 public constant COMMITTEE_MEMBER = keccak256("COMMITTEE_MEMBER");

    IMasterChef public immutable masterChef;
    IReliquary public immutable reliquary;

    // 7 * 86400 seconds - all future times are rounded by week
    uint private constant WEEK = 604800;

    uint private constant MABEETS_PRECISION = 1e18;

    // The number of master chef allocation points controlled by maBEETS votes
    uint public maBeetsAllocPoints;
    // The number of master chef allocation points controlled by the liquidity committee (music directors)
    uint public committeeAllocPoints;

    // An array of all masterchef farms. Triggering syncFarms will create references for any newly created farms.
    Farm[] public farms;

    // Here we track the votes per relic.
    // epoch -> relicId -> votes
    mapping(uint => mapping(uint => uint[])) private _relicVotes;
    // epoch -> farmId -> amount
    mapping(uint => mapping(uint => uint)) private _epochVotes;
    // epoch -> farmAllocations
    mapping(uint => uint[]) private _committeeEpochAllocations;
    // epoch -> allocationsPointsSet
    mapping(uint => bool) private _allocationPointsSetForEpoch;

    // epoch -> farmId -> incentiveToken -> amount
    mapping(uint => mapping(uint => mapping(address => uint))) private _incentives;
    // epoch -> farmId -> incentiveToken -> relicId -> hasClaimed
    mapping(uint => mapping(uint => mapping(address => mapping(uint => bool)))) private _incentiveClaims;

    // Incentive tokens need to be whitelisted individually, any non whitelisted incentive token will be rejected.
    EnumerableSet.AddressSet private _whiteListedIncentiveTokens;
    
    // events
    event IncentiveDeposited(uint indexed epoch, uint indexed farmId, address indexed incentiveToken, uint amount);
    event MaBeetsAllocationPointsSet(uint numAllocPoints);
    event CommitteeAllocationPointsSet(uint numAllocPoints);
    event FarmEnabled(uint indexed farmId);
    event FarmDisabled(uint indexed farmId);
    event VotesSetForRelic(uint indexed relicId, Vote[] votes);
    event IncentiveTokenWhiteListed(IERC20 indexed incentiveToken);

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
    error IncentiveTokenAlreadyWhiteListed();
    error UnsupportedIncentiveToken();
    error NoIncentivesForEpoch();
    error NoVotesForEpoch();
    error RelicDidNotVoteForThisFarm();
    error IncentivesForEpochNotYetClaimable();
    error IncentivesAlreadyClaimed();
    error NoDuplicateVotes();

    constructor(IMasterChef _masterChef, IReliquary _reliquary, uint _maBeetsAllocPoints, uint _committeeAllocPoints) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        masterChef = _masterChef;
        reliquary = _reliquary;
        maBeetsAllocPoints = _maBeetsAllocPoints;
        committeeAllocPoints = _committeeAllocPoints;
    }

    /**
     * @dev The current epoch is defined as the start of the current week.
     */
    function getCurrentEpochTimestamp() public view returns (uint) {
        return (block.timestamp) / WEEK * WEEK;
    }

    /**
     * @dev The next epoch is defined as the start of the next week.
     */
    function getNextEpochTimestamp() public view returns (uint) {
        return (block.timestamp + WEEK) / WEEK * WEEK;
    }

    /**
     * @dev Sync any new farms that have been deployed to the masterchef. The lastFarmId param allows
     * us to set an upper bound on the number of farms that will be processed, ensuring that this operation
     * wont run in to gas issues.
     */
    function syncFarms(uint lastFarmId, FarmStatus initialStatus) external onlyRole(OPERATOR) {
        if (farms.length > 0 && lastFarmId == farms.length - 1) revert NoNewFarmsToSync();

        uint firstFarmId = farms.length;

        for (uint i = firstFarmId; i <= lastFarmId; i++) {
            // this call will revert if the farmId does not exist
            address lpToken = masterChef.lpTokens(i);

            farms.push(
                Farm({
                    farmId: i,
                    token: IERC20(lpToken),
                    poolId: _getBalancerPoolId(lpToken),
                    status: initialStatus
                })
            );
        }
    }

    /**
     * @dev Sets the farm with id as enabled. Only enabled farms accept votes for the next epoch.
     */
    function enableFarm(uint farmId) external onlyRole(OPERATOR) {
        if (farmId >= farms.length) revert FarmDoesNotExist();
        if (farms[farmId].status == FarmStatus.ENABLED) revert FarmIsEnabled();
  
        farms[farmId].status = FarmStatus.ENABLED;

        emit FarmEnabled(farmId);
    }

    /**
     * @dev Sets the farm with id as disabled. Disabled farms do not accept votes for the next epoch.
     * If a farm is disabled in the middle of a voting period, any votes set for that farm will be ignored
     * when calculating allocation points per farm.
     */
    function disableFarm(uint farmId) external onlyRole(OPERATOR) {
        _requireFarmValidAndNotDisabled(farmId);

        farms[farmId].status = FarmStatus.DISABLED;

        emit FarmDisabled(farmId);
    }

    /**
     * @dev Convenience function to set votes for several relics at once. Be careful of gas spending!
     */
    function setVotesForRelics(uint[] memory relicIds, Vote[][] memory votes) external nonReentrant {
        if (relicIds.length != votes.length) revert ArrayLengthMismatch();

        for (uint i = 0; i < relicIds.length; i++) {
            _setVotesForRelic(relicIds[i], votes[i]);
        }
    }

    /**
     * @dev Allows the owner or approved to cast votes for a specific relic.
     */
    function setVotesForRelic(uint relicId, Vote[] memory votes) public nonReentrant {
        _setVotesForRelic(relicId, votes);
    }

    /**
     * @dev Internal handling for setting votes for a relic, nonReentrant modifier is not used.
     * All votes for a relic must be submitted at once. Submitting another set of votes for a given
     * relic will invalidate the existing votes.
     */
    function _setVotesForRelic(uint relicId, Vote[] memory votes) internal {
        // TODO: It may be necessary to allow for multiple transactions, if the number of votes gets too big to be
        // handled by a single block.

        _requireIsApprovedOrOwner(relicId);
        _requireNoDuplicateVotes(votes);

        uint nextEpoch = getNextEpochTimestamp();

        // clear any existing votes for this relic.
        _clearPreviousVotes(relicId, nextEpoch);

        PositionInfo memory position = reliquary.getPositionForId(relicId);
        LevelInfo memory level = reliquary.getLevelInfo(position.poolId);

        uint[] memory relicVotes = new uint[](farms.length);
        uint maxLevelMultiplier = level.multipliers[level.multipliers.length - 1];
        uint assignedAmount = 0;

        // calculate the total voting power for this relic
        // votingPower = currentLevelMultiplier / maxLevelMultiplier * amount
        uint votingPower = 
            position.amount
            * MABEETS_PRECISION
            * level.multipliers[position.level]
            / maxLevelMultiplier
            / MABEETS_PRECISION;
        
        for (uint i = 0; i < votes.length; i++) {
            // keep track of the entire amount
            assignedAmount += votes[i].amount;

            _requireFarmValidAndNotDisabled(votes[i].farmId);

            _epochVotes[nextEpoch][votes[i].farmId] = _epochVotes[nextEpoch][votes[i].farmId] + votes[i].amount;
            relicVotes[votes[i].farmId] = votes[i].amount;
        }

        // if the user submitted votes exceed the total voting power for this relic, reject
        if (assignedAmount > votingPower) revert AmountExceedsVotingPower();

        // store the votes for this relic.
        _relicVotes[nextEpoch][relicId] = relicVotes; 

        emit VotesSetForRelic(relicId, votes);
    }

    /**
     * @dev The total number of votes cast for a given epoch.
     */
    function getTotalVotesForEpoch(uint epoch) public view returns (uint) {
        uint totalEpochVotes = 0;

        for (uint i = 0; i < farms.length; i++) {
            if (farms[i].status == FarmStatus.ENABLED) {
                totalEpochVotes += _epochVotes[epoch][i];
            }
        }

        return totalEpochVotes;
    }

    /**
     * @dev The votes cast by a relic for a given epoch.
     */
    function getRelicVotesForEpoch(uint relicId, uint epoch) external view returns (uint[] memory) {
        return _relicVotes[epoch][relicId];
    }

    /**
     * @dev Formatted Vote[] of votes cast per farm for a given epoch.
     */
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

    function setMaBeetsAllocPoints(uint numAllocPoints) external onlyRole(OPERATOR) {
        maBeetsAllocPoints = numAllocPoints;

        emit MaBeetsAllocationPointsSet(numAllocPoints);
    }
    function setCommitteeAllocPoints(uint numAllocPoints) external onlyRole(OPERATOR) {
        committeeAllocPoints = numAllocPoints;

        emit CommitteeAllocationPointsSet(numAllocPoints);
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

    function whiteListIncentiveToken(IERC20 incentiveToken) external onlyRole(OPERATOR) {
        if (_whiteListedIncentiveTokens.contains(address(incentiveToken))) revert IncentiveTokenAlreadyWhiteListed();

        _whiteListedIncentiveTokens.add(address(incentiveToken));

        emit IncentiveTokenWhiteListed(incentiveToken);
    }

    function isIncentiveTokenWhiteListed(IERC20 incentiveToken) external view returns (bool) {
        return _whiteListedIncentiveTokens.contains(address(incentiveToken));
    }

    function getWhiteListedIncentiveToken(uint index) external view returns (IERC20) {
        return IERC20(_whiteListedIncentiveTokens.at(index));
    }

    function getWhiteListedIncentiveTokens() external view returns (address[] memory) {
        return _whiteListedIncentiveTokens.values();
    }

    function depositIncentiveForFarm(uint farmId, IERC20 incentiveToken, uint incentiveAmount) external nonReentrant {
        _requireIsWhiteListedIncentiveToken(incentiveToken);
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
        _requireIsApprovedOrOwner(relicId);
        _requireIsWhiteListedIncentiveToken(incentiveToken);
        if (farmId >= farms.length) revert FarmDoesNotExist();
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

    function _getBalancerPoolId(address token) internal view returns (bytes32) {
        // It's possible that the token is not a pool, in which case we return an empty string
        try IBalancerPool(token).getPoolId() returns (bytes32 poolId) {
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

    function _requireIsWhiteListedIncentiveToken(IERC20 incentiveToken) private view {
        if (!_whiteListedIncentiveTokens.contains(address(incentiveToken))) revert UnsupportedIncentiveToken();
    }

    function _requireNoDuplicateVotes(Vote[] memory votes) private pure {
        uint i;
        uint j;

        for (i = 0; i < votes.length - 1; i++) {
            for (j = i + 1; j < votes.length; j++) {
                if (votes[i].farmId == votes[j].farmId) {
                    revert NoDuplicateVotes();
                }
            }
        }
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