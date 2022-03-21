// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../interfaces/IRewarder.sol";
import "../token/BeethovenxMasterChef.sol";

contract TimeBasedMasterChefMultiTokenRewarder is IRewarder, Ownable {
    using SafeERC20 for ERC20;

    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
    }

    struct RewardInfo {
        uint256 accRewardTokenPerShare;
        uint256 lastRewardTime;
    }

    struct PendingReward {
        ERC20 token;
        uint256 amount;
    }

    ERC20[] public rewardTokens;
    uint256[] public rewardsPerSecond;

    uint256[] public masterchefPoolIds;

    /// @notice Info of reward configuration for each pool and token .
    mapping(uint256 => mapping(ERC20 => RewardInfo)) public tokenRewardInfos;

    mapping(uint256 => uint256) public allocationPointsPerPool;

    /// @notice Info of each user that stakes LP tokens per reward token.
    mapping(uint256 => mapping(address => mapping(ERC20 => UserInfo)))
        public userInfos;

    /// @dev Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 totalAllocationPoints;

    uint256 public accTokenPrecision;

    address public immutable masterChef;

    event LogOnReward(
        address indexed user,
        uint256 indexed pid,
        ERC20 rewardToken,
        uint256 amount,
        address indexed to
    );
    event LogPoolAddition(uint256 indexed pid, uint256 allocPoint);
    event LogSetPool(uint256 indexed pid, uint256 allocPoint);
    event LogUpdatePool(
        uint256 indexed pid,
        ERC20 indexed rewardToken,
        uint256 lastRewardTime,
        uint256 lpSupply,
        uint256 accRewardTokenPerShare
    );
    event LogRewardsPerSecond(ERC20[] rewardTokens, uint256[] rewardsPerSecond);
    event LogSetRewardTokens(ERC20[] rewardTokens, uint256 accTokenPrecision);
    event LogInit();

    constructor(address _masterChef) {
        masterChef = _masterChef;
    }

    /// @notice To allow contract verification on matching similar source, we dont provide this in the constructor
    function setRewardTokens(ERC20[] calldata tokens) external onlyOwner {
        require(rewardTokens.length == 0, "Reward tokens can only be set once");
        require(tokens.length > 0, "At least 1 reward token required");
        uint8 decimals = tokens[0].decimals();
        for (uint256 i = 1; i < tokens.length; i++) {
            require(
                tokens[i].decimals() == decimals,
                "Mixed decimals in reward tokens not supported"
            );
        }
        rewardTokens = tokens;
        accTokenPrecision = 10**uint256(18 - decimals + 12);
        emit LogSetRewardTokens(tokens, accTokenPrecision);
    }

    function onBeetsReward(
        uint256 pid,
        address userAddress,
        address recipient,
        uint256,
        uint256 newLpAmount
    ) external override onlyMasterChef {
        // reward infos align with reward token index
        RewardInfo[] memory rewardInfos = updatePool(pid);
        for (uint256 i = 0; i < rewardInfos.length; i++) {
            ERC20 rewardToken = rewardTokens[i];
            UserInfo storage userInfo = userInfos[pid][userAddress][
                rewardToken
            ];
            uint256 pending;
            if (userInfo.amount > 0) {
                pending =
                    ((userInfo.amount * rewardInfos[i].accRewardTokenPerShare) /
                        accTokenPrecision) -
                    userInfo.rewardDebt;
                if (pending > rewardToken.balanceOf(address(this))) {
                    pending = rewardToken.balanceOf(address(this));
                }
            }
            userInfo.amount = newLpAmount;
            userInfo.rewardDebt =
                (newLpAmount * rewardInfos[i].accRewardTokenPerShare) /
                accTokenPrecision;

            if (pending > 0) {
                rewardToken.safeTransfer(recipient, pending);
            }

            emit LogOnReward(userAddress, pid, rewardToken, pending, recipient);
        }
    }

    function pendingTokens(
        uint256 pid,
        address userAddress,
        uint256
    )
        external
        view
        override
        returns (IERC20[] memory tokens, uint256[] memory rewardAmounts)
    {
        uint256 totalLpSupply = BeethovenxMasterChef(masterChef)
            .lpTokens(pid)
            .balanceOf(masterChef);

        rewardAmounts = new uint256[](rewardTokens.length);
        tokens = new IERC20[](rewardTokens.length);
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            ERC20 rewardToken = rewardTokens[i];
            tokens[i] = rewardToken;
            RewardInfo memory rewardInfo = tokenRewardInfos[pid][rewardToken];
            rewardAmounts[i] = 0;
            if (rewardInfo.lastRewardTime != 0) {
                UserInfo storage user = userInfos[pid][userAddress][
                    rewardToken
                ];
                uint256 accRewardTokenPerShare = rewardInfo
                    .accRewardTokenPerShare;

                if (
                    block.timestamp > rewardInfo.lastRewardTime &&
                    totalLpSupply != 0
                ) {
                    uint256 timeSinceLastReward = block.timestamp -
                        rewardInfo.lastRewardTime;

                    uint256 rewards = (timeSinceLastReward *
                        rewardsPerSecond[i] *
                        allocationPointsPerPool[pid]) / totalAllocationPoints;

                    accRewardTokenPerShare =
                        accRewardTokenPerShare +
                        ((rewards * accTokenPrecision) / totalLpSupply);
                }
                rewardAmounts[i] =
                    ((user.amount * accRewardTokenPerShare) /
                        accTokenPrecision) -
                    user.rewardDebt;
                if (rewardAmounts[i] > rewardToken.balanceOf(address(this))) {
                    rewardAmounts[i] = rewardToken.balanceOf(address(this));
                }
            }
        }
    }

    /// @notice Sets the rewards per second to be distributed. Can only be called by the owner.
    /// @param _rewardsPerSecond The amount of token rewards to be distributed per second.
    function setRewardPerSecond(uint256[] memory _rewardsPerSecond)
        public
        onlyOwner
    {
        require(
            rewardTokens.length == rewardsPerSecond.length,
            "Emission rate for each reward token required"
        );
        rewardsPerSecond = _rewardsPerSecond;
        emit LogRewardsPerSecond(rewardTokens, rewardsPerSecond);
    }

    modifier onlyMasterChef() {
        require(
            msg.sender == masterChef,
            "Only MasterChef can call this function."
        );
        _;
    }

    /// @notice Returns the number of rewarded pools.
    function poolLength() public view returns (uint256 pools) {
        pools = masterchefPoolIds.length;
    }

    /// @notice Add a new LP to the pool. Can only be called by the owner.
    /// @param pid Pid on MasterChef
    /// @param allocationPoints AP of the new pool.
    function add(uint256 pid, uint256 allocationPoints) public onlyOwner {
        require(
            tokenRewardInfos[pid][rewardTokens[0]].lastRewardTime == 0,
            "Pool already exists"
        );
        uint256 lastRewardTime = block.timestamp;
        totalAllocationPoints = totalAllocationPoints + allocationPoints;

        allocationPointsPerPool[pid] = allocationPoints;

        for (uint256 i = 0; i < rewardTokens.length; i++) {
            tokenRewardInfos[pid][rewardTokens[i]] = RewardInfo(
                0,
                lastRewardTime
            );
        }
        masterchefPoolIds.push(pid);
        emit LogPoolAddition(pid, allocationPoints);
    }

    /// @notice Update the given pool's reward token allocation point and `IRewarder` contract. Can only be called by the owner.
    /// @param pid The index of the MasterChef pool. See `poolInfo`.
    /// @param allocationPoints New AP of the pool.
    function set(uint256 pid, uint256 allocationPoints) public onlyOwner {
        require(
            tokenRewardInfos[pid][rewardTokens[0]].lastRewardTime != 0,
            "Pool does not exist"
        );
        totalAllocationPoints =
            totalAllocationPoints -
            allocationPointsPerPool[pid] +
            allocationPoints;

        allocationPointsPerPool[pid] = allocationPoints;
        emit LogSetPool(pid, allocationPoints);
    }

    /// @notice View function to see pending Token
    /// @param _pid The index of the MasterChef pool. See `poolInfo`.
    /// @param _user Address of user.
    /// @return pending rewards for a given user.
    function pendingToken(uint256 _pid, address _user)
        public
        view
        returns (uint256 pending)
    {}

    /// @notice Update reward variables for all pools. Be careful of gas spending!
    /// @param pids Pool IDs of all to be updated. Make sure to update all active pools.
    function massUpdatePools(uint256[] calldata pids) external {
        uint256 len = pids.length;
        for (uint256 i = 0; i < len; ++i) {
            updatePool(pids[i]);
        }
    }

    /// @notice Update reward variables of the given pool.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @return rewardInfos Returns reward infos of the pool that was updated.
    function updatePool(uint256 pid)
        public
        returns (RewardInfo[] memory rewardInfos)
    {
        rewardInfos = new RewardInfo[](rewardTokens.length);
        uint256 totalLpSupply = BeethovenxMasterChef(masterChef)
            .lpTokens(pid)
            .balanceOf(masterChef);

        for (uint256 i = 0; i < rewardTokens.length; i++) {
            ERC20 rewardToken = rewardTokens[i];
            RewardInfo memory rewardInfo = tokenRewardInfos[pid][rewardToken];
            if (
                rewardInfo.lastRewardTime != 0 &&
                block.timestamp > rewardInfo.lastRewardTime
            ) {
                if (totalLpSupply > 0) {
                    uint256 time = block.timestamp - rewardInfo.lastRewardTime;
                    uint256 tokenReward = (time *
                        rewardsPerSecond[i] *
                        allocationPointsPerPool[pid]) / totalAllocationPoints;

                    rewardInfo.accRewardTokenPerShare =
                        rewardInfo.accRewardTokenPerShare +
                        ((tokenReward * accTokenPrecision) / totalLpSupply);
                }
                rewardInfo.lastRewardTime = block.timestamp;
                tokenRewardInfos[pid][rewardToken] = rewardInfo;
                rewardInfos[i] = rewardInfo;
                emit LogUpdatePool(
                    pid,
                    rewardToken,
                    rewardInfo.lastRewardTime,
                    totalLpSupply,
                    rewardInfo.accRewardTokenPerShare
                );
            }
        }
    }

    /// @notice sets rewards per second to 0 and withdraws remaining funds
    /// @param withdrawRemainingFundsTo where to withdraaw the remaining funds to
    function shutDown(address withdrawRemainingFundsTo) external onlyOwner {
        setRewardPerSecond(new uint256[](rewardTokens.length));
        for (uint256 i = 0; i < rewardTokens.length; i++) {
            rewardTokens[i].safeTransfer(
                withdrawRemainingFundsTo,
                rewardTokens[i].balanceOf(address(this))
            );
        }
    }
}
