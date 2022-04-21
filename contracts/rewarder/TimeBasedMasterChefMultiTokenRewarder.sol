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

    struct RewardTokenConfig {
        ERC20 rewardToken;
        uint256 rewardsPerSecond;
        uint256 accTokenPrecision;
    }

    // ERC20[] public rewardTokens;
    // uint256[] public rewardsPerSecond;
    RewardTokenConfig[] public rewardTokenConfigs;

    uint256[] public masterchefPoolIds;

    /// @notice Info of reward configuration for each pool and token .
    mapping(uint256 => mapping(ERC20 => RewardInfo)) public tokenRewardInfos;

    mapping(uint256 => uint256) public allocationPointsPerPool;

    /// @notice Info of each user that stakes LP tokens per reward token.
    mapping(uint256 => mapping(address => mapping(ERC20 => UserInfo)))
        public userInfos;

    /// @dev Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 totalAllocationPoints;

    // uint256 public accTokenPrecision;

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
    event LogInitRewardTokens(
        ERC20[] rewardTokens,
        uint256[] accTokenPrecisions
    );
    event LogInit();

    constructor(address _masterChef) {
        masterChef = _masterChef;
    }

    /// @notice To allow contract verification on matching similar source, we dont provide this in the constructor
    function initializeRewardTokens(ERC20[] calldata tokens)
        external
        onlyOwner
    {
        require(
            rewardTokenConfigs.length == 0,
            "Reward token configs can only be initialized once"
        );
        uint256[] memory accTokenPrecisions = new uint256[](tokens.length);
        require(tokens.length > 0, "At least 1 reward token required");
        for (uint256 i = 0; i < tokens.length; i++) {
            uint256 precision = 10**uint256(18 - tokens[i].decimals() + 12);
            rewardTokenConfigs.push(RewardTokenConfig(tokens[i], 0, precision));
            accTokenPrecisions[i] = precision;
        }
        emit LogInitRewardTokens(tokens, accTokenPrecisions);
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
            ERC20 rewardToken = rewardTokenConfigs[i].rewardToken;
            uint256 accTokenPrecision = rewardTokenConfigs[i].accTokenPrecision;
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
        rewardAmounts = new uint256[](rewardTokenConfigs.length);
        tokens = new IERC20[](rewardTokenConfigs.length);

        // if the pool is not configured, we return 0 amount for each reward token
        if (
            tokenRewardInfos[pid][rewardTokenConfigs[0].rewardToken]
                .lastRewardTime == 0
        ) {
            for (uint256 i = 0; i < rewardTokenConfigs.length; i++) {
                tokens[i] = rewardTokenConfigs[i].rewardToken;
                rewardAmounts[i] = 0;
            }
        } else {
            uint256 totalLpSupply = BeethovenxMasterChef(masterChef)
                .lpTokens(pid)
                .balanceOf(masterChef);

            for (uint256 i = 0; i < rewardTokenConfigs.length; i++) {
                RewardTokenConfig storage config = rewardTokenConfigs[i];
                tokens[i] = config.rewardToken;

                RewardInfo memory rewardInfo = tokenRewardInfos[pid][
                    config.rewardToken
                ];
                rewardAmounts[i] = 0;
                if (rewardInfo.lastRewardTime != 0) {
                    UserInfo storage user = userInfos[pid][userAddress][
                        config.rewardToken
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
                            config.rewardsPerSecond *
                            allocationPointsPerPool[pid]) /
                            totalAllocationPoints;

                        accRewardTokenPerShare =
                            accRewardTokenPerShare +
                            ((rewards * config.accTokenPrecision) /
                                totalLpSupply);
                    }
                    rewardAmounts[i] =
                        ((user.amount * accRewardTokenPerShare) /
                            config.accTokenPrecision) -
                        user.rewardDebt;
                    if (
                        rewardAmounts[i] >
                        config.rewardToken.balanceOf(address(this))
                    ) {
                        rewardAmounts[i] = config.rewardToken.balanceOf(
                            address(this)
                        );
                    }
                }
            }
        }
    }

    /// @notice Sets the rewards per second to be distributed. Can only be called by the owner.
    /// @param _tokens Tokens matching the index of _rewardsPerSecond, have to match rewardTokenConfigs order!
    /// @param _rewardsPerSecond The amount of token rewards to be distributed per second.
    function setRewardPerSecond(
        ERC20[] memory _tokens,
        uint256[] memory _rewardsPerSecond
    ) public onlyOwner {
        require(
            rewardTokenConfigs.length == _rewardsPerSecond.length,
            "Emission rate for each reward token required"
        );
        for (uint256 i = 0; i < rewardTokenConfigs.length; i++) {
            require(
                rewardTokenConfigs[i].rewardToken == _tokens[i],
                "Order mismatch, provide tokens in order of rewardTokenConfigs"
            );
            rewardTokenConfigs[i].rewardsPerSecond = _rewardsPerSecond[i];
        }
        emit LogRewardsPerSecond(_tokens, _rewardsPerSecond);
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
            tokenRewardInfos[pid][rewardTokenConfigs[0].rewardToken]
                .lastRewardTime == 0,
            "Pool already exists"
        );
        uint256 lastRewardTime = block.timestamp;
        totalAllocationPoints = totalAllocationPoints + allocationPoints;

        allocationPointsPerPool[pid] = allocationPoints;

        for (uint256 i = 0; i < rewardTokenConfigs.length; i++) {
            tokenRewardInfos[pid][
                rewardTokenConfigs[i].rewardToken
            ] = RewardInfo(0, lastRewardTime);
        }
        masterchefPoolIds.push(pid);
        emit LogPoolAddition(pid, allocationPoints);
    }

    /// @notice Update the given pool's reward token allocation point and `IRewarder` contract. Can only be called by the owner.
    /// @param pid The index of the MasterChef pool. See `poolInfo`.
    /// @param allocationPoints New AP of the pool.
    function set(uint256 pid, uint256 allocationPoints) public onlyOwner {
        require(
            tokenRewardInfos[pid][rewardTokenConfigs[0].rewardToken]
                .lastRewardTime != 0,
            "Pool does not exist"
        );
        totalAllocationPoints =
            totalAllocationPoints -
            allocationPointsPerPool[pid] +
            allocationPoints;

        allocationPointsPerPool[pid] = allocationPoints;
        emit LogSetPool(pid, allocationPoints);
    }

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
        rewardInfos = new RewardInfo[](rewardTokenConfigs.length);
        uint256 totalLpSupply = BeethovenxMasterChef(masterChef)
            .lpTokens(pid)
            .balanceOf(masterChef);

        for (uint256 i = 0; i < rewardTokenConfigs.length; i++) {
            RewardTokenConfig storage config = rewardTokenConfigs[i];
            RewardInfo memory rewardInfo = tokenRewardInfos[pid][
                config.rewardToken
            ];
            rewardInfos[i] = rewardInfo;
            if (
                rewardInfo.lastRewardTime != 0 &&
                block.timestamp > rewardInfo.lastRewardTime
            ) {
                if (totalLpSupply > 0) {
                    uint256 time = block.timestamp - rewardInfo.lastRewardTime;
                    uint256 tokenReward = (time *
                        config.rewardsPerSecond *
                        allocationPointsPerPool[pid]) / totalAllocationPoints;

                    rewardInfo.accRewardTokenPerShare =
                        rewardInfo.accRewardTokenPerShare +
                        ((tokenReward * config.accTokenPrecision) /
                            totalLpSupply);
                }
                rewardInfo.lastRewardTime = block.timestamp;
                tokenRewardInfos[pid][config.rewardToken] = rewardInfo;
                rewardInfos[i] = rewardInfo;
                emit LogUpdatePool(
                    pid,
                    config.rewardToken,
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
        setRewardPerSecond(
            getRewardTokens(),
            new uint256[](rewardTokenConfigs.length)
        );

        for (uint256 i = 0; i < rewardTokenConfigs.length; i++) {
            rewardTokenConfigs[i].rewardToken.safeTransfer(
                withdrawRemainingFundsTo,
                rewardTokenConfigs[i].rewardToken.balanceOf(address(this))
            );
        }
    }

    function getRewardTokens() public view returns (ERC20[] memory tokens) {
        tokens = new ERC20[](rewardTokenConfigs.length);
        for (uint256 i = 0; i < rewardTokenConfigs.length; i++) {
            tokens[i] = rewardTokenConfigs[i].rewardToken;
        }
    }

    function getRewardTokenConfigs()
        public
        view
        returns (RewardTokenConfig[] memory configs)
    {
        return rewardTokenConfigs;
    }
}
