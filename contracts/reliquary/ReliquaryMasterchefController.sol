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
}

struct Vote {
    uint farmId;
    uint amount;
}

struct FarmAllocation {
    uint farmId;
    // these should be provided in normal form (ie without precision added)
    uint allocPoints;
}

struct FarmIncentive {
    uint farmId;
    IERC20 token;
    uint amount;
}

contract ReliquaryMasterchefController is ReentrancyGuard, AccessControlEnumerable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /// @dev Access control roles.
    bytes32 public constant OPERATOR = keccak256("OPERATOR");
    bytes32 public constant COMMITTEE_MEMBER = keccak256("COMMITTEE_MEMBER");

    IMasterChef public immutable masterChef;
    // reliquary contract that hosts maBEETS
    IReliquary public immutable reliquary;
    // The reliquary poolId for maBEETS
    uint public immutable maBeetsPoolId;
    LevelInfo private _maBeetsLevelInfo;
    uint private immutable _maxLevelMultiplier;

    // 7 * 86400 seconds - all future times are rounded by week
    uint public constant EPOCH_DURATION_IN_SECONDS = 604800;
    // The voting window is the period of time during the current epoch where votes for the next epoch are accepted
    // We define an integer value here that is the seconds before the next epoch when voting ends.
    // IE: we say that voting for the next epoch closes 1 day before the epoch starts
    uint public constant VOTING_CLOSES_SECONDS_BEFORE_NEXT_EPOCH = 86400;

    uint private constant MABEETS_PRECISION = 1e18;
    uint private constant ALLOC_PT_PRECISION = 1e3;

    // We store allocation point history as parallel arrays. This allows us to determine the allocation points
    // at any epoch in the past. For simplicity, we keep both arrays the same length, so any change to one allocation
    // point type introduces a new entry for both.
    uint[] private allocPointEpochs;
    // The number of master chef allocation points controlled by maBEETS votes
    uint[] private maBeetsAllocPointsAtEpoch; 
    // The number of master chef allocation points controlled by the liquidity committee (music directors)
    uint[] private committeeAllocPointsAtEpoch;

    // An array of all masterchef farms. Triggering syncFarms will create references for any newly created farms.
    Farm[] public farms;
    // We store status history as two parallel arrays, this allows us to determine to state of a farm at any
    // epoch in the past.
    FarmStatus[][] private _farmStatuses;
    uint[][] private _farmStatusEpochs;

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
    event MaBeetsAllocationPointsSet(uint numAllocPoints, uint indexed epoch);
    event CommitteeAllocationPointsSet(uint numAllocPoints, uint indexed epoch);
    event FarmEnabled(uint indexed farmId, uint indexed epoch);
    event FarmDisabled(uint indexed farmId, uint indexed epoch);
    event VotesSetForRelic(uint indexed relicId, Vote[] votes);
    event IncentiveTokenWhiteListed(IERC20 indexed incentiveToken);
    event IncentivesClaimedForFarm(
        uint indexed relicId,
        uint indexed farmId,
        uint indexed epoch,
        IERC20 incentiveToken,
        address recipient
    );

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
    error NoDuplicateAllocations();
    error FarmNotRegisteredForEpoch();
    error VotingForEpochClosed();
    error RelicIsNotFromMaBeetsPool();
    error InvalidEpoch();

    constructor(
        IMasterChef _masterChef,
        IReliquary _reliquary,
        uint _maBeetsPoolId,
        uint _maBeetsAllocPoints,
        uint _committeeAllocPoints
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);

        masterChef = _masterChef;
        reliquary = _reliquary;
        maBeetsPoolId = _maBeetsPoolId;

        maBeetsAllocPointsAtEpoch.push(_maBeetsAllocPoints * ALLOC_PT_PRECISION);
        committeeAllocPointsAtEpoch.push(_committeeAllocPoints * ALLOC_PT_PRECISION);
        allocPointEpochs.push(getCurrentEpochTimestamp());

        _maBeetsLevelInfo = reliquary.getLevelInfo(maBeetsPoolId);
        _maxLevelMultiplier =_maBeetsLevelInfo.multipliers[_maBeetsLevelInfo.multipliers.length - 1];
    }

    /**
     * @dev The current epoch is defined as the start of the current week.
     */
    function getCurrentEpochTimestamp() public view returns (uint) {
        return (block.timestamp) / EPOCH_DURATION_IN_SECONDS * EPOCH_DURATION_IN_SECONDS;
    }

    /**
     * @dev The next epoch is defined as the start of the next week.
     */
    function getNextEpochTimestamp() public view returns (uint) {
        return (block.timestamp + EPOCH_DURATION_IN_SECONDS) / EPOCH_DURATION_IN_SECONDS * EPOCH_DURATION_IN_SECONDS;
    }

    /**
     * @dev The next number of farms that have been synced to the controller. This can be less than the number
     * of farms that exist on the masterchef
     */
    function numFarms() public view returns (uint) {
        return farms.length;
    }

    /**
     * @dev Sync any new farms that have been deployed to the masterchef. The lastFarmId param allows
     * us to set an upper bound on the number of farms that will be processed, ensuring that this operation
     * wont run in to gas issues.
     */
    function syncFarms(uint lastFarmId, FarmStatus initialStatus) external onlyRole(OPERATOR) {
        if (farms.length > 0 && lastFarmId == farms.length - 1) revert NoNewFarmsToSync();

        uint firstFarmId = farms.length;
        uint nextEpoch = getNextEpochTimestamp();

        for (uint i = firstFarmId; i <= lastFarmId; i++) {
            // this call will revert if the farmId does not exist
            address lpToken = masterChef.lpTokens(i);
            
            FarmStatus[] memory statuses = new FarmStatus[](1);
            statuses[0] = initialStatus;

            uint[] memory statusEpochs = new uint[](1);
            statusEpochs[0] = nextEpoch;

            farms.push(
                Farm({
                    farmId: i,
                    token: IERC20(lpToken),
                    poolId: _getBalancerPoolId(lpToken)
                })
            );

            _farmStatuses.push(statuses);
            _farmStatusEpochs.push(statusEpochs);
        }
    }

    /**
     * @dev Sets the farm with id as enabled. Only enabled farms accept votes for the next epoch.
     */
    function enableFarm(uint farmId) external onlyRole(OPERATOR) {
        if (farmId >= farms.length) revert FarmDoesNotExist();
        if (_farmStatuses[farmId][_farmStatuses[farmId].length - 1] == FarmStatus.ENABLED) {
            revert FarmIsEnabled();
        }
  
        uint epoch = getNextEpochTimestamp();

        _addStatusToFarm(farmId, FarmStatus.ENABLED, epoch);

        emit FarmEnabled(farmId, epoch);
    }

    /**
     * @dev Sets the farm with id as disabled. Disabled farms do not accept votes for the next epoch.
     * If a farm is disabled in the middle of a voting period, any votes set for that farm will be ignored
     * when calculating allocation points per farm.
     */
    function disableFarm(uint farmId) external onlyRole(OPERATOR) {
        _requireFarmValidAndNotDisabled(farmId);

        uint epoch = getNextEpochTimestamp();

        _addStatusToFarm(farmId, FarmStatus.DISABLED, epoch);

        emit FarmDisabled(farmId, epoch);
    }

    function getFarmStatuses(uint farmId) public view returns (FarmStatus[] memory statuses, uint[] memory epochs) {
        statuses = _farmStatuses[farmId];
        epochs = _farmStatusEpochs[farmId];
    }

    function getFarmStatusForEpoch(uint farmId, uint epoch) external view returns (FarmStatus) {
        if (_farmStatusEpochs[farmId][0] > epoch) revert FarmNotRegisteredForEpoch();

        return _getFarmStatusForEpoch(farmId, epoch);
    }

    // we assume the farmId has already been verified to exist and that the status change is valid
    function _addStatusToFarm(uint farmId, FarmStatus status, uint epoch) private {
        uint numStatuses = _farmStatuses[farmId].length;

        if (epoch == _farmStatusEpochs[farmId][numStatuses - 1]) {
            _farmStatuses[farmId][numStatuses - 1] = status;
        } else {
            FarmStatus[] memory statuses = new FarmStatus[](numStatuses + 1);
            uint[] memory epochs = new uint[](numStatuses + 1);
            
            for (uint i = 0; i < _farmStatuses[farmId].length; i++) {
                statuses[i] = _farmStatuses[farmId][i];
                epochs[i] = _farmStatusEpochs[farmId][i];
            }

            statuses[statuses.length - 1] = status;
            epochs[epochs.length - 1] = epoch;

            _farmStatuses[farmId] = statuses;
            _farmStatusEpochs[farmId] = epochs;
        }
        
    }

    function getRelicVotingPower(uint relicId) public view returns (uint) {
        PositionInfo memory position = reliquary.getPositionForId(relicId);

        if (position.poolId != maBeetsPoolId) revert RelicIsNotFromMaBeetsPool();
        
        // votingPower = currentLevelMultiplier / maxLevelMultiplier * amount
        return position.amount
            * MABEETS_PRECISION
            * _maBeetsLevelInfo.multipliers[position.level]
            / _maxLevelMultiplier
            / MABEETS_PRECISION;
    }

    /**
     * @dev Convenience function to set votes for several relics at once. Be careful of gas spending!
     */
    function setVotesForRelics(uint[] memory relicIds, Vote[][] memory votes) external nonReentrant {
        _requireIsWithinVotingPeriod();
        if (relicIds.length != votes.length) revert ArrayLengthMismatch();

        for (uint i = 0; i < relicIds.length; i++) {
            _setVotesForRelic(relicIds[i], votes[i]);
        }
    }

    /**
     * @dev Allows the owner or approved to cast votes for a specific relic.
     */
    function setVotesForRelic(uint relicId, Vote[] memory votes) public nonReentrant {
        _requireIsWithinVotingPeriod();

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

        // This will revert if the relic is not for the ma beets pool
        uint votingPower = getRelicVotingPower(relicId);

        uint nextEpoch = getNextEpochTimestamp();

        // clear any existing votes for this relic.
        _clearPreviousVotes(relicId, nextEpoch);

        uint[] memory relicVotes = new uint[](farms.length);
        uint assignedAmount = 0;

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
            totalEpochVotes += _epochVotes[epoch][i];

            // TODO: this is more correct, but will likely lead to out of gas errors
            /* if (_getFarmStatusForEpoch(i, epoch) == FarmStatus.ENABLED) {
                totalEpochVotes += _epochVotes[epoch][i];
            } */
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
     * @dev The votes cast per farm for a given epoch.
     */
    function getEpochVotes(uint epoch) external view returns (uint[] memory) {
        uint[] memory votes = new uint[](farms.length);

        for (uint i = 0; i < farms.length; i++) {
            votes[i] = _epochVotes[epoch][i];
        }

        return votes;
    }

    function setMaBeetsAllocPoints(uint maBeetsAllocPoints) external onlyRole(OPERATOR) {
        _updateAllocationPoints(
            maBeetsAllocPoints * ALLOC_PT_PRECISION,
            committeeAllocPointsAtEpoch[allocPointEpochs.length - 1]
        );

        emit MaBeetsAllocationPointsSet(maBeetsAllocPoints, getNextEpochTimestamp());
    }

    function setCommitteeAllocPoints(uint committeeAlocPoints) external onlyRole(OPERATOR) {
        _updateAllocationPoints(
            maBeetsAllocPointsAtEpoch[allocPointEpochs.length - 1],
            committeeAlocPoints * ALLOC_PT_PRECISION
        );

        emit CommitteeAllocationPointsSet(committeeAlocPoints, getNextEpochTimestamp());
    }

    function _updateAllocationPoints(uint maBeetsAllocPoints, uint committeeAllocPoints) private {
        if (allocPointEpochs[allocPointEpochs.length - 1] == getNextEpochTimestamp()) {
            maBeetsAllocPointsAtEpoch[allocPointEpochs.length - 1] = maBeetsAllocPoints;
            committeeAllocPointsAtEpoch[allocPointEpochs.length - 1] = committeeAllocPoints;
        }else {
            maBeetsAllocPointsAtEpoch.push(maBeetsAllocPoints);
            committeeAllocPointsAtEpoch.push(committeeAllocPoints);
            allocPointEpochs.push(getNextEpochTimestamp());
        }
    }

    function getMaBeetsAllocPointsForEpoch(uint epoch) public view returns (uint) {
        return maBeetsAllocPointsAtEpoch[_getAllocPointIdxForEpoch(epoch)];
    }

    function getComitteeAllocPointsForEpoch(uint epoch) public view returns (uint) {
        return committeeAllocPointsAtEpoch[_getAllocPointIdxForEpoch(epoch)];
    }

    function _getAllocPointIdxForEpoch(uint epoch) private view returns (uint) {
        // We work under the expectation that any state changing operations will be done for the most
        // recent epochs. By starting from the end of the list, we reduce reads for state changing ops.
        for (uint i = allocPointEpochs.length - 1; i >= 0; i--) {
            if (allocPointEpochs[i] <= epoch) {
                return i;
            }
        }

        revert InvalidEpoch();
    }

    // Because of rounding, its possible for the allocations to add up to be slightly more than allocated.
    // The impact here is very small and it does not impact the function of the masterchef, so we allow for it.
    function getMaBeetsFarmAllocationsForEpoch(uint epoch) public view returns (uint[] memory) {
        uint[] memory allocations = new uint[](farms.length);
        uint totalEpochVotes = getTotalVotesForEpoch(epoch);
        uint totalAllocations = 0;
        uint maBeetsAllocPoints = getMaBeetsAllocPointsForEpoch(epoch);

        if (totalEpochVotes == 0) revert NoVotesForEpoch();

        for (uint i = 0; i < farms.length; i++) {
            allocations[i] = _epochVotes[epoch][i] * maBeetsAllocPoints / totalEpochVotes;
            totalAllocations += allocations[i];
        }

        return allocations;
    }

    function setCommitteeFarmAllocationsForEpoch(
        FarmAllocation[] memory allocations
    ) external onlyRole(COMMITTEE_MEMBER) {
        _requireNoDuplicateAllocations(allocations);

        uint epoch = getNextEpochTimestamp();
        uint[] memory committeeAllocations = new uint[](farms.length);
        uint totalAllocPoints = 0;

        for (uint i = 0; i < allocations.length; i++) {
            _requireFarmValidAndNotDisabled(allocations[i].farmId);

            // committee allocation points are expect to be provided in normal form (whole numbers), we apply
            // the additional precision on the input amounts.
            committeeAllocations[allocations[i].farmId] = allocations[i].allocPoints * ALLOC_PT_PRECISION;
            totalAllocPoints += committeeAllocations[allocations[i].farmId];
        }

        if (totalAllocPoints > getComitteeAllocPointsForEpoch(epoch)) revert CommitteeAllocationGreaterThanControlled();

        _committeeEpochAllocations[epoch] = committeeAllocations;
    }

    function getCommitteeFarmAllocationsForEpoch(uint epoch) external view returns (uint[] memory) {
        return _committeeEpochAllocations[epoch];
    }

    function getFarmAllocationsForEpoch(uint epoch) public view returns (uint[] memory) {
        uint[] memory allocations = new uint[](farms.length);
        uint[] memory maBeetsAllocations = getMaBeetsFarmAllocationsForEpoch(epoch);
        uint maBeetsAllocPoints = getMaBeetsAllocPointsForEpoch(epoch);
        uint committeeAllocPoints = getComitteeAllocPointsForEpoch(epoch);

        for (uint i = 0; i < farms.length; i++) {
            //TODO this is not correct when points change over time, would need to store point history
            allocations[i] = committeeAllocPoints == 0 ? 0 : _committeeEpochAllocations[epoch][i];
            allocations[i] += maBeetsAllocPoints == 0 ? 0 : maBeetsAllocations[i];
        }

        return allocations;
    }

    function depositIncentiveForFarm(uint farmId, IERC20 incentiveToken, uint incentiveAmount) external nonReentrant {
        _requireFarmValidAndNotDisabled(farmId);
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
    ) external nonReentrant returns (uint) {
        _requireIsApprovedOrOwner(relicId);
        _requireIsWhiteListedIncentiveToken(incentiveToken);
        if (epoch > getCurrentEpochTimestamp()) revert IncentivesForEpochNotYetClaimable();
        //TODO not adequate, should be "did exist at epoch"
        if (farmId >= farms.length) revert FarmDoesNotExist();

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

        // This will always round down.
        uint incentivesForRelic = 
            incentivesForFarm
            * (relicVotesForFarm * MABEETS_PRECISION / totalVotesForFarm)
            / MABEETS_PRECISION;

        incentiveToken.safeTransfer(recipient, incentivesForRelic);

        emit IncentivesClaimedForFarm(relicId, farmId, epoch, incentiveToken, recipient);

        return incentivesForRelic;
    }

    function getFarmIncentivesForEpoch(
        uint farmId,
        uint epoch
    ) external view returns (FarmIncentive[] memory incentives) {
        address[] memory tokens = getWhiteListedIncentiveTokens();
        uint count = 0;
        uint i;

        for (i = 0; i < tokens.length; i++) {
            if (_incentives[epoch][farmId][address(tokens[i])] > 0) {
                count++;
            }
        }

        incentives = new FarmIncentive[](count);
        uint idx = 0;

        for (i = 0; i < tokens.length; i++) {
            if (_incentives[epoch][farmId][tokens[i]] > 0) {
                incentives[idx] = FarmIncentive({
                    farmId: farmId,
                    token: IERC20(tokens[i]),
                    amount: _incentives[epoch][farmId][address(tokens[i])]
                });

                idx++;
            }
        }
    }

    function getIncentiveAmountForEpoch(
        uint farmId,
        uint epoch,
        IERC20 incentiveToken
    ) public view returns (uint) {
        _requireIsWhiteListedIncentiveToken(incentiveToken);
        if (farmId >= farms.length) revert FarmDoesNotExist();

        return _incentives[epoch][farmId][address(incentiveToken)];
    }

    /**
     * @dev Whitelist an incentive token. Only whitelisted tokens can be deposited as incentives. 
     * For the sake of simplicity, we do no support rebase tokens.
     */
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

    function getWhiteListedIncentiveTokens() public view returns (address[] memory) {
        return _whiteListedIncentiveTokens.values();
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
        if (_farmStatuses[farmId][_farmStatuses[farmId].length - 1] == FarmStatus.DISABLED) {
             revert FarmIsDisabled();
        }
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

    function _requireNoDuplicateAllocations(FarmAllocation[] memory allocations) private pure {
        uint i;
        uint j;

        for (i = 0; i < allocations.length - 1; i++) {
            for (j = i + 1; j < allocations.length; j++) {
                if (allocations[i].farmId == allocations[j].farmId) {
                    revert NoDuplicateAllocations();
                }
            }
        }
    }

    function _requireIsWithinVotingPeriod() private view {
        if (getNextEpochTimestamp() - block.timestamp <= VOTING_CLOSES_SECONDS_BEFORE_NEXT_EPOCH) {
             revert VotingForEpochClosed();
        }
    }

    function _clearPreviousVotes(uint relicId, uint nextEpoch) private {
        uint[] memory votes = _relicVotes[nextEpoch][relicId]; 

        for (uint i = 0; i < votes.length; i++) {
            _epochVotes[nextEpoch][i] = _epochVotes[nextEpoch][i] - votes[i];
        }
    }

    function _getFarmStatusForEpoch(uint farmId, uint epoch) private view returns (FarmStatus) {
        if (_farmStatusEpochs[farmId][0] > epoch) revert FarmNotRegisteredForEpoch();

        FarmStatus status = FarmStatus.DISABLED;

        // we work under the expectation that any state changing operations will be done for the most
        // recent epochs. By starting from the end of the list, we reduce reads for state changing ops.
        for (uint i = _farmStatusEpochs[farmId].length - 1; i >= 0; i--) {
            if (_farmStatusEpochs[farmId][i] >= epoch) {
                status = _farmStatuses[farmId][i];
            }
        }

        return status;
    }

    // This is just a reference implementation, good chance it wouldn't work exactly like this
    /*function setMasterchefAllocationPointsForCurrentEpoch() external onlyRole(OPERATOR) {
        uint epoch = getCurrentEpochTimestamp();
        uint[] memory allocations = getAllocationsForEpoch(epoch);

        if (_allocationPointsSetForEpoch[epoch] == true) revert AllocationPointsAlreadySetForCurrentEpoch();

        for (uint i = 0; i < farms.length; i++) {
            masterChef.set(i, allocations[i], IRewarder(address(0)), false);
        }
    }*/
}