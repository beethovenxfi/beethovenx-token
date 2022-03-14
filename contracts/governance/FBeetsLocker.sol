// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/*
    Based on CVX Staking contract for https://www.convexfinance.com - https://github.com/convex-eth/platform/blob/main/contracts/contracts/CvxLocker.sol
    Changes:
        - upgrade to solidity 0.8.7
        - remove boosted concept
        - remove staking of locked tokens

     *** Locking mechanism ***

    This locking mechanism is based on epochs. An epoch is defined by the `epochDuration`. When locking our tokens,
    the unlock time for this lock period is set to the start of the current running epoch + `lockDuration`.
    The locked tokens of the current epoch are not eligible for voting. Therefore we need to wait for the next
    epoch until we can vote.
    All tokens locked within the same epoch share the same lock and therefore the same unlock time.


    *** Rewards ***

    Rewards are shared between users based on the total amount of locking tokens in the contract. This includes
    tokens which have been locked in the current epoch and also tokens of expired locks. To incentivize people to
    either withdraw their expired locks or re-lock, there is an incentive mechanism to kick out expired locks and
    collect a percentage of the locked tokens in return.
*/

contract FBeetsLocker is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    struct Epoch {
        uint256 supply; //epoch locked supply
        uint256 startTime; //epoch start date
    }

    IERC20 public immutable lockingToken;

    struct EarnedData {
        address token;
        uint256 amount;
    }

    address[] public rewardTokens;

    struct Reward {
        uint256 periodFinish;
        uint256 rewardRate;
        uint256 lastUpdateTime;
        uint256 rewardPerTokenStored;
    }

    mapping(address => Reward) public rewardData;

    uint256 public immutable epochDuration;

    uint256 public immutable lockDuration;

    uint256 public constant denominator = 10000;

    // reward token -> distributor -> is approved to add rewards
    mapping(address => mapping(address => bool)) public rewardDistributors;

    // user -> reward token -> amount
    mapping(address => mapping(address => uint256))
        public userRewardPerTokenPaid;
    mapping(address => mapping(address => uint256)) public rewards;

    uint256 public totalLockedSupply;
    Epoch[] public epochs;

    /*
        We keep the total locked amount and an index to the next unprocessed lock per user.
        All locks previous to this index have been either withdrawn or relocked and can be ignored.
    */

    struct Balances {
        uint256 lockedAmount;
        uint256 nextUnlockIndex;
    }

    mapping(address => Balances) public balances;

    /*
        We keep the amount locked and the unlock time (start epoch + lock duration)
        for each user
    */
    struct LockedBalance {
        uint256 locked;
        uint256 unlockTime;
    }

    mapping(address => LockedBalance[]) public userLocks;

    uint256 public kickRewardPerEpoch = 100;
    uint256 public kickRewardEpochDelay = 4;

    bool public isShutdown = false;

    //erc20-like interface
    string private constant _name = "Locked fBeets Token";
    string private constant _symbol = "lfBeets";
    uint8 private constant _decimals = 18;

    constructor(
        IERC20 _lockingToken,
        uint256 _epochDuration,
        uint256 _lockDuration
    ) {
        require(_lockDuration % _epochDuration == 0, "_epochDuration has to be a multiple of _lockDuration");
        lockingToken = _lockingToken;
        epochDuration = _epochDuration;
        lockDuration = _lockDuration;

        epochs.push(
            Epoch({
                supply: 0,
                startTime: (block.timestamp / _epochDuration) * _epochDuration
            })
        );
    }

    function decimals() external pure returns (uint8) {
        return _decimals;
    }

    function name() external pure returns (string memory) {
        return _name;
    }

    function symbol() external pure returns (string memory) {
        return _symbol;
    }

    /// @notice Add a new reward token to be distributed to lockers
    /// @param _rewardToken The rewarded token by the `_distributor`
    /// @param _distributor Address of the reward token sender
    function addReward(address _rewardToken, address _distributor)
        external
        onlyOwner
    {
        require(
            rewardData[_rewardToken].lastUpdateTime == 0,
            "Reward token already added"
        );
        require(
            _rewardToken != address(lockingToken),
            "Rewarding the locking token is not allowed"
        );
        rewardTokens.push(_rewardToken);
        rewardData[_rewardToken].lastUpdateTime = block.timestamp;
        rewardData[_rewardToken].periodFinish = block.timestamp;
        rewardDistributors[_rewardToken][_distributor] = true;
        emit RewardTokenAdded(_rewardToken);
        emit RewardDistributorApprovalChanged(_rewardToken, _distributor, true);
    }

    /// @notice Modify approval for a distributor to call `notifyRewardAmount`
    /// @param _rewardToken Reward token to change distributor approval
    /// @param _distributor Address of reward distributor
    /// @param _approved Flag to white- or blacklist the distributor for this reward token
    function approveRewardDistributor(
        address _rewardToken,
        address _distributor,
        bool _approved
    ) external onlyOwner {
        require(
            rewardData[_rewardToken].lastUpdateTime > 0,
            "Reward token has not been added"
        );
        rewardDistributors[_rewardToken][_distributor] = _approved;
        emit RewardDistributorApprovalChanged(
            _rewardToken,
            _distributor,
            _approved
        );
    }

    /// @notice Set kick incentive after epoch delay has passed
    /// @param _kickRewardPerEpoch incentive per epoch to the base of the `denominator`
    /// @param _kickRewardEpochDelay after how many epochs overdue an expired lock can be kicked out
    function setKickIncentive(
        uint256 _kickRewardPerEpoch,
        uint256 _kickRewardEpochDelay
    ) external onlyOwner {
        require(_kickRewardPerEpoch <= 500, "over max rate of 5% per epoch");
        require(_kickRewardEpochDelay >= 2, "min delay of 2 epochs required");
        kickRewardPerEpoch = _kickRewardPerEpoch;
        kickRewardEpochDelay = _kickRewardEpochDelay;

        emit SetKickIncentive(_kickRewardEpochDelay, _kickRewardPerEpoch);
    }

    /// @notice Shutdown the contract and release all locks
    function shutdown() external onlyOwner {
        isShutdown = true;
    }

    function _rewardPerToken(address _rewardToken)
        internal
        view
        returns (uint256)
    {
        Reward storage reward = rewardData[_rewardToken];

        if (totalLockedSupply == 0) {
            return reward.rewardPerTokenStored;
        }

        uint256 secondsSinceLastApplicableRewardTime = _lastTimeRewardApplicable(
                reward.periodFinish
            ) - reward.lastUpdateTime;
        return
            reward.rewardPerTokenStored +
            (((secondsSinceLastApplicableRewardTime * reward.rewardRate) *
                1e18) / totalLockedSupply);
    }

    function _earned(
        address _user,
        address _rewardsToken,
        uint256 _balance
    ) internal view returns (uint256) {
        return
            (_balance *
                (_rewardPerToken(_rewardsToken) -
                    userRewardPerTokenPaid[_user][_rewardsToken])) /
            1e18 +
            rewards[_user][_rewardsToken];
    }

    function _lastTimeRewardApplicable(uint256 _finishTime)
        internal
        view
        returns (uint256)
    {
        return Math.min(block.timestamp, _finishTime);
    }

    function lastTimeRewardApplicable(address _rewardsToken)
        external
        view
        returns (uint256)
    {
        return
            _lastTimeRewardApplicable(rewardData[_rewardsToken].periodFinish);
    }

    /// @notice Returns the rewards gained for the reward period per locked token
    /// @param _rewardToken The address of the reward token
    function rewardPerToken(address _rewardToken)
        external
        view
        returns (uint256)
    {
        return _rewardPerToken(_rewardToken);
    }

    /// @notice Returns rewarded amount for each token for the given address
    /// @param _user User address
    function claimableRewards(address _user)
        external
        view
        returns (EarnedData[] memory userRewards)
    {
        userRewards = new EarnedData[](rewardTokens.length);
        uint256 lockedAmount = balances[_user].lockedAmount;
        for (uint256 i = 0; i < userRewards.length; i++) {
            address token = rewardTokens[i];
            userRewards[i].token = token;
            userRewards[i].amount = _earned(_user, token, lockedAmount);
        }
        return userRewards;
    }

    /// @notice Total token balance of an account, including unlocked but not withdrawn tokens
    /// @param _user User address
    function lockedBalanceOf(address _user)
        external
        view
        returns (uint256 amount)
    {
        return balances[_user].lockedAmount;
    }

    // an epoch is always the timestamp on the start of an epoch
    function _currentEpoch() internal view returns (uint256) {
        return (block.timestamp / epochDuration) * epochDuration;
    }

    /// @notice Balance of an account which only includes properly locked tokens as of the most recent eligible epoch
    /// @param _user User address
    function balanceOf(address _user) external view returns (uint256 amount) {
        LockedBalance[] storage locks = userLocks[_user];
        Balances storage userBalance = balances[_user];
        uint256 nextUnlockIndex = userBalance.nextUnlockIndex;

        //start with current locked amount
        amount = balances[_user].lockedAmount;

        uint256 locksLength = locks.length;
        //remove old records only (will be better gas-wise than adding up)
        for (uint256 i = nextUnlockIndex; i < locksLength; i++) {
            if (locks[i].unlockTime <= block.timestamp) {
                amount = amount - locks[i].locked;
            } else {
                //stop now as no further checks are needed
                break;
            }
        }

        //also remove amount in the next (future) epoch
        if (
            locksLength > 0 &&
            locks[locksLength - 1].unlockTime - lockDuration > _currentEpoch()
        ) {
            amount = amount - locks[locksLength - 1].locked;
        }

        return amount;
    }

    /// @notice Balance of an account which only includes properly locked tokens at the given epoch
    /// @param _epoch Epoch index
    /// @param _user User address
    function balanceAtEpochOf(uint256 _epoch, address _user)
        external
        view
        returns (uint256 amount)
    {
        LockedBalance[] storage locks = userLocks[_user];

        //get timestamp of given epoch index
        uint256 epochStartTime = epochs[_epoch].startTime;
        //get timestamp of first non-inclusive epoch
        uint256 cutoffEpoch = epochStartTime - lockDuration;

        //traverse inversely to make more current queries more gas efficient
        uint256 currentLockIndex = locks.length;

        if (currentLockIndex == 0) {
            return 0;
        }
        do {
            currentLockIndex--;

            uint256 lockEpoch = locks[currentLockIndex].unlockTime -
                lockDuration;

            if (lockEpoch <= epochStartTime) {
                if (lockEpoch > cutoffEpoch) {
                    amount += locks[currentLockIndex].locked;
                } else {
                    //stop now as no further checks matter
                    break;
                }
            }
        } while (currentLockIndex > 0);

        return amount;
    }

    /// @notice returns amount of newly locked tokens in the upcoming epoch
    /// @param _user the user to check against
    function pendingLockOf(address _user)
        external
        view
        returns (uint256 amount)
    {
        LockedBalance[] storage locks = userLocks[_user];

        uint256 locksLength = locks.length;

        //return amount if latest lock is in the future
        uint256 currentEpoch = _currentEpoch();
        if (
            locksLength > 0 &&
            locks[locksLength - 1].unlockTime - lockDuration > currentEpoch
        ) {
            return locks[locksLength - 1].locked;
        }

        return 0;
    }

    /// @notice Supply of all properly locked balances at most recent eligible epoch
    function totalSupply() external view returns (uint256 supply) {
        uint256 currentEpoch = _currentEpoch();
        uint256 cutoffEpoch = currentEpoch - lockDuration;
        uint256 epochIndex = epochs.length;
        if (epochIndex == 0) {
            return 0;
        }

        // remove future epoch amount
        if (epochs[epochIndex - 1].startTime > currentEpoch) {
            epochIndex--;
        }

        //traverse inversely to make more current queries more gas efficient
        do {
            epochIndex--;
            Epoch storage epoch = epochs[epochIndex];
            if (epoch.startTime <= cutoffEpoch) {
                break;
            }
            supply += epoch.supply;
        } while (epochIndex > 0);

        return supply;
    }

    /// @notice Supply of all properly locked balances at the given epoch
    /// @param _epochIndex Epoch index
    function totalSupplyAtEpoch(uint256 _epochIndex)
        external
        view
        returns (uint256 supply)
    {
        // if its the first epoch, no locks can be active
        if (_epochIndex == 0) {
            return 0;
        }
        uint256 epochStart = epochs[_epochIndex].startTime;

        uint256 cutoffEpoch = epochStart - lockDuration;
        uint256 currentIndex = _epochIndex;

        //traverse inversely to make more current queries more gas efficient
        do {
            Epoch storage epoch = epochs[currentIndex];
            if (epoch.startTime <= cutoffEpoch) {
                break;
            }
            supply += epochs[currentIndex].supply;
            currentIndex--;
        } while (currentIndex > 0);

        return supply;
    }

    /// @notice Find an epoch index based on timestamp
    /// @param _time Timestamp
    function findEpochId(uint256 _time) external view returns (uint256 epoch) {
        uint256 max = epochs.length - 1;
        uint256 min = 0;

        //convert to start point
        _time = (_time / epochDuration) * epochDuration;

        for (uint256 i = 0; i < 128; i++) {
            if (min >= max) break;

            uint256 mid = (min + max + 1) / 2;
            uint256 midEpochBlock = epochs[mid].startTime;
            if (midEpochBlock == _time) {
                //found
                return mid;
            } else if (midEpochBlock < _time) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /// @notice Information on a user's locked balances per locking period
    /// @param _user User address
    function lockedBalances(address _user)
        external
        view
        returns (
            uint256 total,
            uint256 unlockable,
            uint256 locked,
            LockedBalance[] memory lockData
        )
    {
        LockedBalance[] storage locks = userLocks[_user];
        Balances storage userBalance = balances[_user];
        uint256 nextUnlockIndex = userBalance.nextUnlockIndex;
        uint256 idx;
        for (uint256 i = nextUnlockIndex; i < locks.length; i++) {
            if (locks[i].unlockTime > block.timestamp) {
                if (idx == 0) {
                    lockData = new LockedBalance[](locks.length - i);
                }
                lockData[idx] = locks[i];
                idx++;
                locked += locks[i].locked;
            } else {
                unlockable += locks[i].locked;
            }
        }
        return (userBalance.lockedAmount, unlockable, locked, lockData);
    }

    /// @notice Total number of epochs
    function epochCount() external view returns (uint256) {
        return epochs.length;
    }

    /// @notice Fills in any missing epochs until current epoch
    function checkpointEpoch() external {
        _checkpointEpoch();
    }

    //insert a new epoch if needed. fill in any gaps
    function _checkpointEpoch() internal {
        //create new epoch in the future where new non-active locks will lock to
        uint256 nextEpoch = _currentEpoch() + epochDuration;

        //check to add
        //first epoch add in constructor, no need to check 0 length
        if (epochs[epochs.length - 1].startTime < nextEpoch) {
            //fill any epoch gaps
            while (epochs[epochs.length - 1].startTime != nextEpoch) {
                uint256 nextEpochDate = epochs[epochs.length - 1].startTime +
                    epochDuration;
                epochs.push(Epoch({supply: 0, startTime: nextEpochDate}));
            }
        }
    }

    /// @notice Lockes `_amount` tokens from `_user` for lockDuration and are eligible to receive stakingReward rewards
    /// @param _user User to lock tokens from
    /// @param _amount Amount to lock
    function lock(address _user, uint256 _amount)
        external
        nonReentrant
        updateReward(_user)
    {
        //pull tokens
        lockingToken.safeTransferFrom(msg.sender, address(this), _amount);

        //lock
        _lock(_user, _amount, false);
    }

    function _lock(
        address _account,
        uint256 _amount,
        bool _relock
    ) internal {
        require(_amount > 0, "Cannot lock 0 tokens");
        require(!isShutdown, "Contract is in shutdown");

        Balances storage userBalance = balances[_account];

        //must try check pointing epoch first
        _checkpointEpoch();

        //add user balances
        userBalance.lockedAmount += _amount;
        //add to total supplies
        totalLockedSupply += _amount;

        //add user lock records or add to current
        uint256 lockStartEpoch = _currentEpoch();
        if (!_relock) {
            lockStartEpoch += epochDuration;
        }
        uint256 unlockTime = lockStartEpoch + lockDuration; // lock duration = 16 weeks + current week = 17 weeks

        uint256 idx = userLocks[_account].length;
        // if its the first lock or the last lock has shorter unlock time than this lock
        if (idx == 0 || userLocks[_account][idx - 1].unlockTime < unlockTime) {
            userLocks[_account].push(
                LockedBalance({locked: _amount, unlockTime: unlockTime})
            );
        } else {
            //if latest lock is further in the future, lower index
            //this can only happen if relocking an expired lock after creating a new lock
            if (userLocks[_account][idx - 1].unlockTime > unlockTime) {
                idx--;
            }

            //if idx points to the epoch when same unlock time, update
            //(this is always true with a normal lock but maybe not with relock)
            if (userLocks[_account][idx - 1].unlockTime == unlockTime) {
                LockedBalance storage userLock = userLocks[_account][idx - 1];
                userLock.locked += _amount;
            } else {
                //can only enter here if a relock is made after a lock and there's no lock entry
                //for the current epoch.
                //ex a list of locks such as "[...][older][current*][next]" but without a "current" lock
                //length - 1 is the next epoch
                //length - 2 is a past epoch
                //thus need to insert an entry for current epoch at the 2nd to last entry
                //we will copy and insert the tail entry(next) and then overwrite length-2 entry

                //reset idx
                idx = userLocks[_account].length;

                //get current last item
                LockedBalance storage userLock = userLocks[_account][idx - 1];

                //add a copy to end of list
                userLocks[_account].push(
                    LockedBalance({
                        locked: userLock.locked,
                        unlockTime: userLock.unlockTime
                    })
                );

                //insert current epoch lock entry by overwriting the entry at length-2
                userLock.locked = _amount;
                userLock.unlockTime = unlockTime;
            }
        }

        //update epoch supply, epoch checkpointed above so safe to add to latest
        uint256 epochIndex = epochs.length - 1;
        //if relock, epoch should be current and not next, thus need to decrease index to length-2
        if (_relock) {
            epochIndex--;
        }
        Epoch storage currentEpoch = epochs[epochIndex];
        currentEpoch.supply += _amount;

        emit Locked(_account, _amount, lockStartEpoch);
    }

    /// @notice Withdraw all currently locked tokens where the unlock time has passed
    function _processExpiredLocks(
        address _account,
        bool _relock,
        address _withdrawTo,
        address _rewardAddress,
        uint256 _checkDelay
    ) internal updateReward(_account) {
        LockedBalance[] storage locks = userLocks[_account];
        Balances storage userBalance = balances[_account];
        uint256 unlockedAmount;
        uint256 totalLocks = locks.length;
        uint256 reward = 0;

        require(totalLocks > 0, "Account has no locks");
        //if time is beyond last lock, can just bundle everything together
        if (
            isShutdown ||
            locks[totalLocks - 1].unlockTime <= block.timestamp - _checkDelay
        ) {
            unlockedAmount = userBalance.lockedAmount;

            //dont delete, just set next index
            userBalance.nextUnlockIndex = totalLocks;

            //check for kick reward
            //this wont have the exact reward rate that you would get if looped through
            //but this section is supposed to be for quick and easy low gas processing of all locks
            //we'll assume that if the reward was good enough someone would have processed at an earlier epoch
            if (_checkDelay > 0) {
                uint256 currentEpoch = ((block.timestamp - _checkDelay) /
                    epochDuration) * epochDuration;

                uint256 overdueEpochCount = (currentEpoch -
                    locks[totalLocks - 1].unlockTime) / epochDuration;

                uint256 rewardRate = Math.min(
                    kickRewardPerEpoch * (overdueEpochCount + 1),
                    denominator
                );

                reward =
                    (locks[totalLocks - 1].locked * rewardRate) /
                    denominator;
            }
        } else {
            // we start on nextUnlockIndex since everything before that has already been processed
            uint256 nextUnlockIndex = userBalance.nextUnlockIndex;
            for (uint256 i = nextUnlockIndex; i < totalLocks; i++) {
                //unlock time must be less or equal to time
                if (locks[i].unlockTime > block.timestamp - _checkDelay) break;

                //add to cumulative amounts
                unlockedAmount += locks[i].locked;

                //check for kick reward
                //each epoch over due increases reward
                if (_checkDelay > 0) {
                    uint256 currentEpoch = ((block.timestamp - _checkDelay) /
                        epochDuration) * epochDuration;

                    uint256 overdueEpochCount = (currentEpoch -
                        locks[i].unlockTime) / epochDuration;

                    uint256 rewardRate = Math.min(
                        kickRewardPerEpoch * (overdueEpochCount + 1),
                        denominator
                    );
                    reward += (locks[i].locked * rewardRate) / denominator;
                }
                //set next unlock index
                nextUnlockIndex++;
            }
            //update next unlock index
            userBalance.nextUnlockIndex = nextUnlockIndex;
        }
        require(unlockedAmount > 0, "No expired locks present");

        //update user balances and total supplies
        userBalance.lockedAmount = userBalance.lockedAmount - unlockedAmount;
        totalLockedSupply -= unlockedAmount;

        emit Withdrawn(_account, unlockedAmount, _relock);

        //send process incentive
        if (reward > 0) {
            //reduce return amount by the kick reward
            unlockedAmount -= reward;

            lockingToken.safeTransfer(_rewardAddress, reward);

            emit KickReward(_rewardAddress, _account, reward);
        }

        //relock or return to user
        if (_relock) {
            _lock(_withdrawTo, unlockedAmount, true);
        } else {
            // transfer unlocked amount - kick reward (if present)
            lockingToken.safeTransfer(_withdrawTo, unlockedAmount);
        }
    }

    /// @notice withdraw expired locks to a different address
    /// @param _withdrawTo address to withdraw expired locks to
    function withdrawExpiredLocksTo(address _withdrawTo) external nonReentrant {
        _processExpiredLocks(msg.sender, false, _withdrawTo, msg.sender, 0);
    }

    /// @notice Withdraw/relock all currently locked tokens where the unlock time has passed
    /// @param _relock Relock all expired locks
    function processExpiredLocks(bool _relock) external nonReentrant {
        _processExpiredLocks(msg.sender, _relock, msg.sender, msg.sender, 0);
    }

    /// @notice Kick expired locks of `_user` and collect kick reward
    /// @param _user User to kick expired locks
    function kickExpiredLocks(address _user) external nonReentrant {
        //allow kick after grace period of 'kickRewardEpochDelay'
        _processExpiredLocks(
            _user,
            false,
            _user,
            msg.sender,
            epochDuration * kickRewardEpochDelay
        );
    }

    /// @notice Claim all pending rewards
    function getReward() external nonReentrant updateReward(msg.sender) {
        for (uint256 i; i < rewardTokens.length; i++) {
            address _rewardsToken = rewardTokens[i];
            uint256 reward = rewards[msg.sender][_rewardsToken];
            if (reward > 0) {
                rewards[msg.sender][_rewardsToken] = 0;
                IERC20(_rewardsToken).safeTransfer(msg.sender, reward);

                emit RewardPaid(msg.sender, _rewardsToken, reward);
            }
        }
    }

    function _notifyReward(address _rewardToken, uint256 _reward)
        internal
        returns (uint256 rewardRate, uint256 periodFinish)
    {
        Reward storage tokenRewardData = rewardData[_rewardToken];

        // if there has not been a reward for the duration of an epoch, the reward rate resets
        if (block.timestamp >= tokenRewardData.periodFinish) {
            tokenRewardData.rewardRate = _reward / epochDuration;
        } else {
            // adjust reward rate with additional rewards
            uint256 remaining = tokenRewardData.periodFinish - block.timestamp;

            uint256 leftover = remaining * tokenRewardData.rewardRate;
            tokenRewardData.rewardRate = (_reward + leftover) / epochDuration;
        }

        tokenRewardData.lastUpdateTime = block.timestamp;
        tokenRewardData.periodFinish = block.timestamp + epochDuration;

        return (tokenRewardData.rewardRate, tokenRewardData.periodFinish);
    }

    /// @notice Called by a reward distributor to distribute rewards
    /// @param _rewardToken The token to reward
    /// @param _amount The amount to reward
    function notifyRewardAmount(address _rewardToken, uint256 _amount)
        external
        updateReward(address(0))
    {
        require(
            rewardDistributors[_rewardToken][msg.sender],
            "Rewarder not approved"
        );
        require(_amount > 0, "No rewards provided");

        (uint256 rewardRate, uint256 periodFinish) = _notifyReward(
            _rewardToken,
            _amount
        );

        // handle the transfer of reward tokens via `transferFrom` to reduce the number
        // of transactions required and ensure correctness of the _reward amount
        IERC20(_rewardToken).safeTransferFrom(
            msg.sender,
            address(this),
            _amount
        );

        emit RewardAdded(_rewardToken, _amount, rewardRate, periodFinish);
    }

    /// @notice Emergency function to withdraw non reward tokens
    /// @param _tokenAddress The token to withdraw
    /// @param _tokenAmount The amount to withdraw
    function recoverERC20(address _tokenAddress, uint256 _tokenAmount)
        external
        onlyOwner
    {
        require(
            _tokenAddress != address(lockingToken),
            "Cannot withdraw locking token"
        );
        require(
            rewardData[_tokenAddress].lastUpdateTime == 0,
            "Cannot withdraw reward token"
        );
        IERC20(_tokenAddress).safeTransfer(owner(), _tokenAmount);
        emit Recovered(_tokenAddress, _tokenAmount);
    }

    modifier updateReward(address _account) {
        {
            //stack too deep
            Balances storage userBalance = balances[_account];
            for (uint256 i = 0; i < rewardTokens.length; i++) {
                address token = rewardTokens[i];
                rewardData[token].rewardPerTokenStored = _rewardPerToken(token);
                rewardData[token].lastUpdateTime = _lastTimeRewardApplicable(
                    rewardData[token].periodFinish
                );
                if (_account != address(0)) {
                    rewards[_account][token] = _earned(
                        _account,
                        token,
                        userBalance.lockedAmount
                    );
                    userRewardPerTokenPaid[_account][token] = rewardData[token]
                        .rewardPerTokenStored;
                }
            }
        }
        _;
    }

    event RewardAdded(
        address indexed _token,
        uint256 _reward,
        uint256 _rewardRate,
        uint256 _periodFinish
    );
    event Locked(address indexed _user, uint256 _lockedAmount, uint256 _epoch);
    event Withdrawn(address indexed _user, uint256 _amount, bool _relocked);
    event KickReward(
        address indexed _user,
        address indexed _kicked,
        uint256 _reward
    );
    event RewardPaid(
        address indexed _user,
        address indexed _rewardsToken,
        uint256 _reward
    );
    event Recovered(address _token, uint256 _amount);
    event SetKickIncentive(
        uint256 _kickRewardEpochDelay,
        uint256 _kickRewardPerEpoch
    );
    event RewardTokenAdded(address _rewardToken);
    event RewardDistributorApprovalChanged(
        address _rewardToken,
        address _distributor,
        bool _approved
    );
}
