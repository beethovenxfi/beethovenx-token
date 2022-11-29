// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "./IReliquaryMock.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Burnable.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/*
 + @title Reliquary
 + @author Justin Bebis, Zokunei & the Byte Masons team
 +
 + @notice This system is designed to manage incentives for deposited assets such that
 + behaviors can be programmed on a per-pool basis using maturity levels. Stake in a
 + pool, also referred to as "position," is represented by means of an NFT called a
 + "Relic." Each position has a "maturity" which captures the age of the position.
 +
 + @notice Deposits are tracked by Relic ID instead of by user. This allows for
 + increased composability without affecting accounting logic too much, and users can
 + trade their Relics without withdrawing liquidity or affecting the position's maturity.
*/
contract ReliquaryMock is
    IReliquaryMock,
    ERC721Burnable,
    ERC721Enumerable,
    AccessControlEnumerable,
    Multicall,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    /// @notice Access control roles.
    bytes32 private constant OPERATOR = keccak256("OPERATOR");
    bytes32 private constant EMISSION_CURVE = keccak256("EMISSION_CURVE");
    bytes32 private constant MATURITY_MODIFIER = keccak256("MATURITY_MODIFIER");

    /// @notice Indicates whether tokens are being added to, or removed from, a pool
    enum Kind {
        DEPOSIT,
        WITHDRAW,
        OTHER
    }

    /// @notice Level of precision rewards are calculated to
    uint256 private constant ACC_REWARD_PRECISION = 1e12;

    /// @notice Nonce to use for new relicId
    uint256 private nonce;

    /// @notice Address of the reward token contract.
    IERC20 public immutable rewardToken;
    /// @notice Address of each NFTDescriptor contract.
    INFTDescriptor[] public nftDescriptor;
    /// @notice Address of EmissionCurve contract.
    IEmissionCurve public emissionCurve;
    /// @notice Info of each Reliquary pool.
    PoolInfo[] private poolInfo;
    /// @notice Level system for each Reliquary pool.
    LevelInfo[] private levels;
    /// @notice Address of the LP token for each Reliquary pool.
    IERC20[] public poolToken;
    /// @notice Address of each `IRewarder` contract.
    IReliquaryRewarder[] public rewarder;

    /// @notice Info of each staked position
    mapping(uint256 => PositionInfo) private positionForId;

    /// @dev Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint;

    event CreateRelic(
        uint256 indexed pid,
        address indexed to,
        uint256 indexed relicId
    );
    event Deposit(
        uint256 indexed pid,
        uint256 amount,
        address indexed to,
        uint256 indexed relicId
    );
    event Withdraw(
        uint256 indexed pid,
        uint256 amount,
        address indexed to,
        uint256 indexed relicId
    );
    event EmergencyWithdraw(
        uint256 indexed pid,
        uint256 amount,
        address indexed to,
        uint256 indexed relicId
    );
    event Harvest(
        uint256 indexed pid,
        uint256 amount,
        address indexed to,
        uint256 indexed relicId
    );
    event MaturityBonus(
        uint256 indexed pid,
        address indexed to,
        uint256 indexed relicId,
        uint256 bonus
    );
    event LogPoolAddition(
        uint256 indexed pid,
        uint256 allocPoint,
        IERC20 indexed poolToken,
        IReliquaryRewarder indexed rewarder,
        INFTDescriptor nftDescriptor
    );
    event LogPoolModified(
        uint256 indexed pid,
        uint256 allocPoint,
        IReliquaryRewarder indexed rewarder,
        INFTDescriptor nftDescriptor
    );
    event LogUpdatePool(
        uint256 indexed pid,
        uint256 lastRewardTime,
        uint256 lpSupply,
        uint256 accRewardPerShare
    );
    event LogSetEmissionCurve(IEmissionCurve indexed emissionCurveAddress);
    event LevelChanged(uint256 indexed relicId, uint256 newLevel);
    event Split(uint256 indexed fromId, uint256 indexed toId, uint256 amount);
    event Shift(uint256 indexed fromId, uint256 indexed toId, uint256 amount);
    event Merge(uint256 indexed fromId, uint256 indexed toId, uint256 amount);

    /*
     + @notice structs defined in IReliquary

     + @notice Info for each Reliquary position.
     + `amount` LP token amount the position owner has provided
     + `rewardDebt` Amount of reward token accumalated before the position's entry or last harvest
     + `rewardCredit` Amount of reward token owed to the user on next harvest
     + `entry` Used to determine the maturity of the position
     + `poolId` ID of the pool to which this position belongs
     + `level` Index of this position's level within the pool's array of levels
     + `genesis` Relic creation time
     + `lastMaturityBonus` Last time the position had its entry altered by a MaturityModifier
    struct PositionInfo {
        uint amount;
        uint rewardDebt;
        uint rewardCredit;
        uint entry; // position owner's relative entry into the pool.
        uint poolId; // ensures that a single Relic is only used for one pool.
        uint level;
        uint genesis;
        uint lastMaturityBonus;
    }

     + @notice Info of each Reliquary pool
     + `accRewardPerShare` Accumulated reward tokens per share of pool (1 / 1e12)
     + `lastRewardTime` Last timestamp the accumulated reward was updated
     + `allocPoint` Pool's individual allocation - ratio of the total allocation
     + `name` Name of pool to be displayed in NFT image
    struct PoolInfo {
        uint accRewardPerShare;
        uint lastRewardTime;
        uint allocPoint;
        string name;
    }

     + @notice Level that determines how maturity is rewarded
     + `requiredMaturity` The minimum maturity (in seconds) required to reach this Level
     + `allocPoint` Level's individual allocation - ratio of the total allocation
     + `balance` Total number of tokens deposited in positions at this Level
    struct LevelInfo {
        uint[] requiredMaturity;
        uint[] allocPoint;
        uint[] balance;
    }

     + @notice Object representing pending rewards and related data for a position.
     + `relicId` The NFT ID of the given position.
     + `poolId` ID of the pool to which this position belongs.
     + `pendingReward` pending reward amount for a given position.
    struct PendingReward {
        uint relicId;
        uint poolId;
        uint pendingReward;
    }
    */

    /*
     + @notice Constructs and initializes the contract
     + @param _rewardToken The reward token contract address.
     + @param _emissionCurve The contract address for the EmissionCurve, which will return the emission rate
    */
    constructor(IERC20 _rewardToken, IEmissionCurve _emissionCurve)
        ERC721("Reliquary Deposit", "RELIC")
    {
        rewardToken = _rewardToken;
        emissionCurve = _emissionCurve;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @notice Implement ERC165 to return which interfaces this contract conforms to
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(
            IReliquaryMock,
            AccessControlEnumerable,
            ERC721,
            ERC721Enumerable
        )
        returns (bool)
    {
        return
            interfaceId == type(IReliquaryMock).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    /// @notice Returns the number of Reliquary pools.
    function poolLength() public view override returns (uint256 pools) {
        pools = poolInfo.length;
    }

    function tokenURI(uint256 tokenId)
        public
        view
        override(ERC721)
        returns (string memory)
    {
        require(_exists(tokenId), "token does not exist");
        return
            nftDescriptor[positionForId[tokenId].poolId].constructTokenURI(
                tokenId
            );
    }

    /// @param _emissionCurve The contract address for EmissionCurve, which will return the base emission rate
    function setEmissionCurve(IEmissionCurve _emissionCurve)
        external
        override
        onlyRole(EMISSION_CURVE)
    {
        emissionCurve = _emissionCurve;
        emit LogSetEmissionCurve(_emissionCurve);
    }

    function getPositionForId(uint256 relicId)
        external
        view
        override
        returns (PositionInfo memory position)
    {
        position = positionForId[relicId];
    }

    function getPoolInfo(uint256 pid)
        external
        view
        override
        returns (PoolInfo memory pool)
    {
        pool = poolInfo[pid];
    }

    function getLevelInfo(uint256 pid)
        external
        view
        override
        returns (LevelInfo memory levelInfo)
    {
        levelInfo = levels[pid];
    }

    function burn(uint256 tokenId)
        public
        override(IReliquaryMock, ERC721Burnable)
    {
        require(positionForId[tokenId].amount == 0, "contains deposit");
        require(pendingReward(tokenId) == 0, "contains pending rewards");
        super.burn(tokenId);
    }

    /*
     + @notice Add a new pool for the specified LP.
     +         Can only be called by an operator.
     +
     + @param allocPoint The allocation points for the new pool
     + @param _poolToken Address of the pooled ERC-20 token
     + @param _rewarder Address of the rewarder delegate
     + @param requiredMaturity Array of maturity (in seconds) required to achieve each level for this pool
     + @param allocPoints The allocation points for each level within this pool
     + @param name Name of pool to be displayed in NFT image
     + @param _nftDescriptor The contract address for NFTDescriptor, which will return the token URI
    */
    function addPool(
        uint256 allocPoint,
        IERC20 _poolToken,
        IReliquaryRewarder _rewarder,
        uint256[] calldata requiredMaturity,
        uint256[] calldata allocPoints,
        string memory name,
        INFTDescriptor _nftDescriptor
    ) external override onlyRole(OPERATOR) {
        require(_poolToken != rewardToken, "cannot add reward token as pool");
        require(requiredMaturity.length != 0, "empty levels array");
        require(
            requiredMaturity.length == allocPoints.length,
            "array length mismatch"
        );
        require(requiredMaturity[0] == 0, "requiredMaturity[0] != 0");
        if (requiredMaturity.length > 1) {
            uint256 highestMaturity;
            for (
                uint256 i = 1;
                i < requiredMaturity.length;
                i = _uncheckedInc(i)
            ) {
                require(
                    requiredMaturity[i] > highestMaturity,
                    "unsorted levels array"
                );
                highestMaturity = requiredMaturity[i];
            }
        }

        uint256 length = poolLength();
        for (uint256 i; i < length; i = _uncheckedInc(i)) {
            _updatePool(i);
        }

        uint256 totalAlloc = totalAllocPoint + allocPoint;
        require(totalAlloc != 0, "totalAllocPoint cannot be 0");
        totalAllocPoint = totalAlloc;
        poolToken.push(_poolToken);
        rewarder.push(_rewarder);
        nftDescriptor.push(_nftDescriptor);

        poolInfo.push(
            PoolInfo({
                allocPoint: allocPoint,
                lastRewardTime: block.timestamp,
                accRewardPerShare: 0,
                name: name
            })
        );
        levels.push(
            LevelInfo({
                requiredMaturity: requiredMaturity,
                allocPoint: allocPoints,
                balance: new uint256[](allocPoints.length)
            })
        );

        emit LogPoolAddition(
            (poolToken.length - 1),
            allocPoint,
            _poolToken,
            _rewarder,
            _nftDescriptor
        );
    }

    /*
     + @notice Modify the given pool's properties.
     +         Can only be called by an operator.
     +
     + @param pid The index of the pool. See `poolInfo`.
     + @param allocPoint New AP of the pool.
     + @param _rewarder Address of the rewarder delegate.
     + @param name Name of pool to be displayed in NFT image
     + @param _nftDescriptor The contract address for NFTDescriptor, which will return the token URI
     + @param overwriteRewarder True if _rewarder should be set. Otherwise `_rewarder` is ignored.
    */
    // function modifyPool(
    //     uint256 pid,
    //     uint256 allocPoint,
    //     IReliquaryRewarder _rewarder,
    //     string calldata name,
    //     INFTDescriptor _nftDescriptor,
    //     bool overwriteRewarder
    // ) external override onlyRole(OPERATOR) {
    //     require(pid < poolInfo.length, "set: pool does not exist");

    //     uint256 length = poolLength();
    //     for (uint256 i; i < length; i = _uncheckedInc(i)) {
    //         _updatePool(i);
    //     }

    //     PoolInfo storage pool = poolInfo[pid];
    //     uint256 totalAlloc = totalAllocPoint + allocPoint - pool.allocPoint;
    //     require(totalAlloc != 0, "totalAllocPoint cannot be 0");
    //     totalAllocPoint = totalAlloc;
    //     pool.allocPoint = allocPoint;

    //     if (overwriteRewarder) {
    //         rewarder[pid] = _rewarder;
    //     }

    //     pool.name = name;
    //     nftDescriptor[pid] = _nftDescriptor;

    //     emit LogPoolModified(
    //         pid,
    //         allocPoint,
    //         overwriteRewarder ? _rewarder : rewarder[pid],
    //         _nftDescriptor
    //     );
    // }

    /*
     + @notice Allows an address with the MATURITY_MODIFIER role to modify a position's maturity within set limits.
     + @param relicId The NFT ID of the position being modified.
     + @param points Number of seconds to reduce the position's entry by (increasing maturity), before maximum.
     + @return receivedBonus Actual maturity bonus received after maximum.
    // */
    // function modifyMaturity(uint256 relicId, uint256 points)
    //     external
    //     override
    //     onlyRole(MATURITY_MODIFIER)
    //     returns (uint256 receivedBonus)
    // {
    //     receivedBonus = Math.max(1 days, points);
    //     PositionInfo storage position = positionForId[relicId];
    //     position.entry -= receivedBonus;
    //     _updatePosition(0, relicId, Kind.OTHER, address(0));

    //     emit MaturityBonus(
    //         position.poolId,
    //         ownerOf(relicId),
    //         relicId,
    //         receivedBonus
    //     );
    // }

    // function updateLastMaturityBonus(uint256 relicId)
    //     external
    //     override
    //     onlyRole(MATURITY_MODIFIER)
    // {
    //     PositionInfo storage position = positionForId[relicId];
    //     position.lastMaturityBonus = block.timestamp;
    // }

    /*
     + @notice View function to see pending reward tokens on frontend.
     + @param relicId ID of the position.
     + @return pending reward amount for a given position owner.
    */
    function pendingReward(uint256 relicId)
        public
        view
        override
        returns (uint256 pending)
    {
        PositionInfo storage position = positionForId[relicId];
        uint256 poolId = position.poolId;
        PoolInfo storage pool = poolInfo[poolId];
        uint256 accRewardPerShare = pool.accRewardPerShare;
        uint256 lpSupply = _poolBalance(position.poolId);

        uint256 lastRewardTime = pool.lastRewardTime;
        uint256 secondsSinceReward = block.timestamp - lastRewardTime;
        if (secondsSinceReward != 0 && lpSupply != 0) {
            uint256 reward = (secondsSinceReward *
                _baseEmissionsPerSecond(lastRewardTime) *
                pool.allocPoint) / totalAllocPoint;
            accRewardPerShare += (reward * ACC_REWARD_PRECISION) / lpSupply;
        }

        uint256 leveledAmount = position.amount *
            levels[poolId].allocPoint[position.level];
        pending =
            (leveledAmount * accRewardPerShare) /
            ACC_REWARD_PRECISION +
            position.rewardCredit -
            position.rewardDebt;
    }

    /*
     + @notice View function to retrieve the relicIds, poolIds, and pendingReward for each Relic owned by an address.
     + @param owner Address of the owner to retrieve info for.
     + @return pendingRewards Array of PendingReward objects.
    */
    function pendingRewardsOfOwner(address owner)
        external
        view
        override
        returns (PendingReward[] memory pendingRewards)
    {
        uint256 balance = balanceOf(owner);
        pendingRewards = new PendingReward[](balance);
        for (uint256 i; i < balance; i = _uncheckedInc(i)) {
            uint256 relicId = tokenOfOwnerByIndex(owner, i);
            pendingRewards[i] = PendingReward({
                relicId: relicId,
                poolId: positionForId[relicId].poolId,
                pendingReward: pendingReward(relicId)
            });
        }
    }

    /*
     + @notice View function to retrieve owned positions for an address.
     + @param owner Address of the owner to retrieve info for.
     + @return relicIds Each relicId owned by the given address.
     + @return positionInfos The PositionInfo object for each relicId.
    */
    function relicPositionsOfOwner(address owner)
        external
        view
        override
        returns (uint256[] memory relicIds, PositionInfo[] memory positionInfos)
    {
        uint256 balance = balanceOf(owner);
        relicIds = new uint256[](balance);
        positionInfos = new PositionInfo[](balance);
        for (uint256 i; i < balance; i = _uncheckedInc(i)) {
            relicIds[i] = tokenOfOwnerByIndex(owner, i);
            positionInfos[i] = positionForId[relicIds[i]];
        }
    }

    /*
     + @notice View function to see level of position if it were to be updated.
     + @param relicId ID of the position.
     + @return level Level for given position upon update.
    */
    function levelOnUpdate(uint256 relicId)
        public
        view
        override
        returns (uint256 level)
    {
        PositionInfo storage position = positionForId[relicId];
        LevelInfo storage levelInfo = levels[position.poolId];
        uint256 length = levelInfo.requiredMaturity.length;
        if (length == 1) {
            return 0;
        }

        uint256 maturity = block.timestamp - position.entry;
        for (level = length - 1; true; level = _uncheckedDec(level)) {
            if (maturity >= levelInfo.requiredMaturity[level]) {
                break;
            }
        }
    }

    /*
     + @notice Update reward variables for all pools. Be careful of gas spending!
     + @param pids Pool IDs of all to be updated. Make sure to update all active pools.
    */
    function massUpdatePools(uint256[] calldata pids)
        external
        override
        nonReentrant
    {
        for (uint256 i; i < pids.length; i = _uncheckedInc(i)) {
            _updatePool(pids[i]);
        }
    }

    /*
     + @notice Update reward variables of the given pool.
     + @param pid The index of the pool. See `poolInfo`.
     + @return pool Returns the pool that was updated.
    */
    function updatePool(uint256 pid) external override nonReentrant {
        _updatePool(pid);
    }

    /// @dev Internal _updatePool function without nonReentrant modifier
    function _updatePool(uint256 pid)
        internal
        returns (uint256 accRewardPerShare)
    {
        require(pid < poolLength(), "invalid pool ID");
        PoolInfo storage pool = poolInfo[pid];
        uint256 timestamp = block.timestamp;
        uint256 lastRewardTime = pool.lastRewardTime;
        uint256 secondsSinceReward = timestamp - lastRewardTime;

        accRewardPerShare = pool.accRewardPerShare;
        if (secondsSinceReward != 0) {
            uint256 lpSupply = _poolBalance(pid);

            if (lpSupply != 0) {
                uint256 reward = (secondsSinceReward *
                    _baseEmissionsPerSecond(lastRewardTime) *
                    pool.allocPoint) / totalAllocPoint;
                accRewardPerShare += (reward * ACC_REWARD_PRECISION) / lpSupply;
                pool.accRewardPerShare = accRewardPerShare;
            }

            pool.lastRewardTime = timestamp;

            emit LogUpdatePool(pid, timestamp, lpSupply, accRewardPerShare);
        }
    }

    /*
     + @notice Create a new Relic NFT and deposit into this position
     + @param to Address to mint the Relic to
     + @param pid The index of the pool. See `poolInfo`.
     + @param amount Token amount to deposit.
    */
    function createRelicAndDeposit(
        address to,
        uint256 pid,
        uint256 amount
    ) external override nonReentrant returns (uint256 id) {
        require(pid < poolInfo.length, "invalid pool ID");
        id = _mint(to);
        PositionInfo storage position = positionForId[id];
        position.poolId = pid;
        position.genesis = block.timestamp;
        _deposit(amount, id);
        emit CreateRelic(pid, to, id);
    }

    /*
     + @notice Deposit LP tokens to Reliquary for reward token allocation.
     + @param amount Token amount to deposit.
     + @param relicId NFT ID of the position being deposited to.
    */
    function deposit(uint256 amount, uint256 relicId)
        external
        override
        nonReentrant
    {
        _requireApprovedOrOwner(relicId);
        _deposit(amount, relicId);
    }

    /// @dev Internal deposit function that assumes relicId is valid.
    function _deposit(uint256 amount, uint256 relicId) internal {
        require(amount != 0, "depositing 0 amount");

        (uint256 poolId, ) = _updatePosition(
            amount,
            relicId,
            Kind.DEPOSIT,
            address(0)
        );

        poolToken[poolId].safeTransferFrom(msg.sender, address(this), amount);

        emit Deposit(poolId, amount, ownerOf(relicId), relicId);
    }

    /*
     + @notice Withdraw LP tokens.
     + @param amount token amount to withdraw.
     + @param relicId NFT ID of the position being withdrawn.
    */
    function withdraw(uint256 amount, uint256 relicId)
        external
        override
        nonReentrant
    {
        require(amount != 0, "withdrawing 0 amount");
        _requireApprovedOrOwner(relicId);

        (uint256 poolId, ) = _updatePosition(
            amount,
            relicId,
            Kind.WITHDRAW,
            address(0)
        );

        poolToken[poolId].safeTransfer(msg.sender, amount);

        emit Withdraw(poolId, amount, msg.sender, relicId);
    }

    /*
     + @notice Harvest proceeds for transaction sender to owner of `relicId`.
     + @param relicId NFT ID of the position being harvested.
     + @param harvestTo Address to send rewards to (zero address if harvest should not be performed).
    */
    function harvest(uint256 relicId, address harvestTo)
        external
        override
        nonReentrant
    {
        _requireApprovedOrOwner(relicId);

        (uint256 poolId, uint256 _pendingReward) = _updatePosition(
            0,
            relicId,
            Kind.OTHER,
            harvestTo
        );

        emit Harvest(poolId, _pendingReward, harvestTo, relicId);
    }

    /*
     + @notice Withdraw LP tokens and harvest proceeds for transaction sender to owner of `relicId`.
     + @param amount token amount to withdraw.
     + @param relicId NFT ID of the position being withdrawn and harvested.
     + @param harvestTo Address to send rewards to (zero address if harvest should not be performed).
    */
    function withdrawAndHarvest(
        uint256 amount,
        uint256 relicId,
        address harvestTo
    ) external override nonReentrant {
        require(amount != 0, "withdrawing 0 amount");
        _requireApprovedOrOwner(relicId);

        (uint256 poolId, uint256 _pendingReward) = _updatePosition(
            amount,
            relicId,
            Kind.WITHDRAW,
            harvestTo
        );

        poolToken[poolId].safeTransfer(msg.sender, amount);

        emit Withdraw(poolId, amount, msg.sender, relicId);
        emit Harvest(poolId, _pendingReward, harvestTo, relicId);
    }

    /*
     + @notice Withdraw without caring about rewards. EMERGENCY ONLY.
     + @param relicId NFT ID of the position to emergency withdraw from and burn.
    */
    function emergencyWithdraw(uint256 relicId) external override nonReentrant {
        address to = ownerOf(relicId);
        require(to == msg.sender, "you do not own this position");

        PositionInfo storage position = positionForId[relicId];
        uint256 amount = position.amount;
        uint256 poolId = position.poolId;

        levels[poolId].balance[position.level] -= amount;

        _burn(relicId);
        delete positionForId[relicId];

        poolToken[poolId].safeTransfer(to, amount);

        emit EmergencyWithdraw(poolId, amount, to, relicId);
    }

    /// @notice Update position without performing a deposit/withdraw/harvest.
    /// @param relicId The NFT ID of the position being updated.
    function updatePosition(uint256 relicId) external override nonReentrant {
        require(_exists(relicId), "Relic doesn't exist");
        _updatePosition(0, relicId, Kind.OTHER, address(0));
    }

    /*
     + @dev Internal function called whenever a position's state needs to be modified.
     + @param amount Amount of poolToken to deposit/withdraw.
     + @param relicId The NFT ID of the position being updated.
     + @param kind Indicates whether tokens are being added to, or removed from, a pool.
     + @param harvestTo Address to send rewards to (zero address if harvest should not be performed).
     + @return pending reward for a given position owner.
    */
    function _updatePosition(
        uint256 amount,
        uint256 relicId,
        Kind kind,
        address harvestTo
    ) internal returns (uint256 poolId, uint256 _pendingReward) {
        PositionInfo storage position = positionForId[relicId];
        poolId = position.poolId;
        uint256 accRewardPerShare = _updatePool(poolId);

        uint256 oldAmount = position.amount;
        uint256 newAmount;
        if (kind == Kind.DEPOSIT) {
            _updateEntry(amount, relicId);
            newAmount = oldAmount + amount;
            position.amount = newAmount;
        } else if (kind == Kind.WITHDRAW) {
            newAmount = oldAmount - amount;
            position.amount = newAmount;
        } else {
            newAmount = oldAmount;
        }

        uint256 oldLevel = position.level;
        uint256 newLevel = _updateLevel(relicId);
        if (oldLevel != newLevel) {
            levels[poolId].balance[oldLevel] -= oldAmount;
            levels[poolId].balance[newLevel] += newAmount;
        } else if (kind == Kind.DEPOSIT) {
            levels[poolId].balance[oldLevel] += amount;
        } else if (kind == Kind.WITHDRAW) {
            levels[poolId].balance[oldLevel] -= amount;
        }

        _pendingReward =
            (oldAmount *
                levels[poolId].allocPoint[oldLevel] *
                accRewardPerShare) /
            ACC_REWARD_PRECISION -
            position.rewardDebt;
        position.rewardDebt =
            (newAmount *
                levels[poolId].allocPoint[newLevel] *
                accRewardPerShare) /
            ACC_REWARD_PRECISION;

        bool _harvest = harvestTo != address(0);
        if (!_harvest && _pendingReward != 0) {
            position.rewardCredit += _pendingReward;
        } else if (_harvest) {
            uint256 total = _pendingReward + position.rewardCredit;
            uint256 received = _receivedReward(total);
            position.rewardCredit = total - received;
            if (received != 0) {
                rewardToken.safeTransfer(harvestTo, received);
                IReliquaryRewarder _rewarder = rewarder[poolId];
                if (address(_rewarder) != address(0)) {
                    // _rewarder.onReward(relicId, received, harvestTo);
                }
            }
        }

        if (kind == Kind.DEPOSIT) {
            IReliquaryRewarder _rewarder = rewarder[poolId];
            if (address(_rewarder) != address(0)) {
                // _rewarder.onDeposit(relicId, amount);
            }
        } else if (kind == Kind.WITHDRAW) {
            IReliquaryRewarder _rewarder = rewarder[poolId];
            if (address(_rewarder) != address(0)) {
                // _rewarder.onWithdraw(relicId, amount);
            }
        }
    }

    /// @notice Split an owned Relic into a new one, while maintaining maturity
    /// @param fromId The NFT ID of the Relic to split from
    /// @param amount Amount to move from existing Relic into the new one
    /// @param to Address to mint the Relic to
    /// @return newId The NFT ID of the new Relic
    function split(
        uint256 fromId,
        uint256 amount,
        address to
    ) external override nonReentrant returns (uint256 newId) {
        require(amount != 0, "cannot split zero amount");
        _requireApprovedOrOwner(fromId);

        PositionInfo storage fromPosition = positionForId[fromId];
        uint256 fromAmount = fromPosition.amount;
        require(amount <= fromAmount, "amount exceeds deposited");
        uint256 newFromAmount = fromAmount - amount;
        fromPosition.amount = newFromAmount;

        newId = _mint(to);
        PositionInfo storage newPosition = positionForId[newId];
        newPosition.genesis = block.timestamp;
        newPosition.amount = amount;
        newPosition.entry = fromPosition.entry;
        uint256 level = fromPosition.level;
        newPosition.level = level;
        uint256 poolId = fromPosition.poolId;
        newPosition.poolId = poolId;

        uint256 multiplier = _updatePool(poolId) *
            levels[poolId].allocPoint[level];
        uint256 pendingFrom = (fromAmount * multiplier) /
            ACC_REWARD_PRECISION -
            fromPosition.rewardDebt;
        if (pendingFrom != 0) {
            fromPosition.rewardCredit += pendingFrom;
        }
        fromPosition.rewardDebt =
            (newFromAmount * multiplier) /
            ACC_REWARD_PRECISION;
        newPosition.rewardDebt = (amount * multiplier) / ACC_REWARD_PRECISION;

        emit CreateRelic(poolId, to, newId);
        emit Split(fromId, newId, amount);
    }

    // /// @notice Transfer amount from one Relic into another, updating maturity in the receiving Relic
    // /// @param fromId The NFT ID of the Relic to transfer from
    // /// @param toId The NFT ID of the Relic being transferred to
    // /// @param amount The amount being transferred
    // function shift(
    //     uint256 fromId,
    //     uint256 toId,
    //     uint256 amount
    // ) external override nonReentrant {
    //     require(amount != 0, "cannot shift zero amount");
    //     require(fromId != toId, "cannot shift into same Relic");
    //     _requireApprovedOrOwner(fromId);
    //     _requireApprovedOrOwner(toId);

    //     PositionInfo storage fromPosition = positionForId[fromId];
    //     uint256 fromAmount = fromPosition.amount;
    //     require(amount <= fromAmount, "amount exceeds deposited");

    //     uint256 poolId = fromPosition.poolId;
    //     PositionInfo storage toPosition = positionForId[toId];
    //     require(poolId == toPosition.poolId, "Relics not of the same pool");

    //     uint256 toAmount = toPosition.amount;
    //     toPosition.entry =
    //         (fromAmount * fromPosition.entry + toAmount * toPosition.entry) /
    //         (fromAmount + toAmount);

    //     uint256 newFromAmount = fromAmount - amount;
    //     fromPosition.amount = newFromAmount;

    //     uint256 newToAmount = toAmount + amount;
    //     toPosition.amount = newToAmount;

    //     (
    //         uint256 fromLevel,
    //         uint256 oldToLevel,
    //         uint256 newToLevel
    //     ) = _shiftLevelBalances(
    //             fromId,
    //             toId,
    //             poolId,
    //             amount,
    //             toAmount,
    //             newToAmount
    //         );

    //     uint256 accRewardPerShare = _updatePool(poolId);
    //     uint256 fromMultiplier = accRewardPerShare *
    //         levels[poolId].allocPoint[fromLevel];
    //     uint256 pendingFrom = (fromAmount * fromMultiplier) /
    //         ACC_REWARD_PRECISION -
    //         fromPosition.rewardDebt;
    //     if (pendingFrom != 0) {
    //         fromPosition.rewardCredit += pendingFrom;
    //     }
    //     uint256 pendingTo = (toAmount *
    //         levels[poolId].allocPoint[oldToLevel] *
    //         accRewardPerShare) /
    //         ACC_REWARD_PRECISION -
    //         toPosition.rewardDebt;
    //     if (pendingTo != 0) {
    //         toPosition.rewardCredit += pendingTo;
    //     }
    //     fromPosition.rewardDebt =
    //         (newFromAmount * fromMultiplier) /
    //         ACC_REWARD_PRECISION;
    //     toPosition.rewardDebt =
    //         (newToAmount *
    //             accRewardPerShare *
    //             levels[poolId].allocPoint[newToLevel]) /
    //         ACC_REWARD_PRECISION;

    //     emit Shift(fromId, toId, amount);
    // }

    /// @notice Transfer entire position (including rewards) from one Relic into another, burning it
    /// and updating maturity in the receiving Relic
    /// @param fromId The NFT ID of the Relic to transfer from
    /// @param toId The NFT ID of the Relic being transferred to
    function merge(uint256 fromId, uint256 toId)
        external
        override
        nonReentrant
    {
        require(fromId != toId, "cannot merge same Relic");
        _requireApprovedOrOwner(fromId);
        _requireApprovedOrOwner(toId);

        PositionInfo storage fromPosition = positionForId[fromId];
        uint256 fromAmount = fromPosition.amount;

        uint256 poolId = fromPosition.poolId;
        PositionInfo storage toPosition = positionForId[toId];
        require(poolId == toPosition.poolId, "Relics not of the same pool");

        uint256 toAmount = toPosition.amount;
        uint256 newToAmount = toAmount + fromAmount;
        require(newToAmount != 0, "cannot merge empty Relics");
        toPosition.entry =
            (fromAmount * fromPosition.entry + toAmount * toPosition.entry) /
            newToAmount;

        toPosition.amount = newToAmount;

        (
            uint256 fromLevel,
            uint256 oldToLevel,
            uint256 newToLevel
        ) = _shiftLevelBalances(
                fromId,
                toId,
                poolId,
                fromAmount,
                toAmount,
                newToAmount
            );

        uint256 accRewardPerShare = _updatePool(poolId);
        uint256 pendingTo = (accRewardPerShare *
            (fromAmount *
                levels[poolId].allocPoint[fromLevel] +
                toAmount *
                levels[poolId].allocPoint[oldToLevel])) /
            ACC_REWARD_PRECISION +
            fromPosition.rewardCredit -
            fromPosition.rewardDebt -
            toPosition.rewardDebt;
        if (pendingTo != 0) {
            toPosition.rewardCredit += pendingTo;
        }
        toPosition.rewardDebt =
            (newToAmount *
                accRewardPerShare *
                levels[poolId].allocPoint[newToLevel]) /
            ACC_REWARD_PRECISION;

        _burn(fromId);
        delete positionForId[fromId];

        emit Merge(fromId, toId, fromAmount);
    }

    function _shiftLevelBalances(
        uint256 fromId,
        uint256 toId,
        uint256 poolId,
        uint256 amount,
        uint256 toAmount,
        uint256 newToAmount
    )
        internal
        returns (
            uint256 fromLevel,
            uint256 oldToLevel,
            uint256 newToLevel
        )
    {
        fromLevel = positionForId[fromId].level;
        oldToLevel = positionForId[toId].level;
        newToLevel = _updateLevel(toId);
        if (fromLevel != newToLevel) {
            levels[poolId].balance[fromLevel] -= amount;
        }
        if (oldToLevel != newToLevel) {
            levels[poolId].balance[oldToLevel] -= toAmount;
        }
        if (fromLevel != newToLevel && oldToLevel != newToLevel) {
            levels[poolId].balance[newToLevel] += newToAmount;
        } else if (fromLevel != newToLevel) {
            levels[poolId].balance[newToLevel] += amount;
        } else if (oldToLevel != newToLevel) {
            levels[poolId].balance[newToLevel] += toAmount;
        }
    }

    /// @notice Calculate how much the owner will actually receive on harvest, given available reward tokens
    /// @param _pendingReward Amount of reward token owed
    /// @return received The minimum between amount owed and amount available
    function _receivedReward(uint256 _pendingReward)
        internal
        view
        returns (uint256 received)
    {
        uint256 available = rewardToken.balanceOf(address(this));
        received = (available > _pendingReward) ? _pendingReward : available;
    }

    /// @notice Gets the base emission rate from external, upgradable contract
    function _baseEmissionsPerSecond(uint256 lastRewardTime)
        internal
        view
        returns (uint256 rate)
    {
        rate = emissionCurve.getRate(lastRewardTime);
        require(rate <= 6e18, "maximum emission rate exceeded");
    }

    /*
     + @notice Utility function to find weights without any underflows or zero division problems.
     + @param addedValue New value being added
     + @param oldValue Current amount of x
    */
    function _findWeight(uint256 addedValue, uint256 oldValue)
        internal
        pure
        returns (uint256 weightNew)
    {
        if (oldValue == 0) {
            weightNew = 1e18;
        } else {
            if (oldValue < addedValue) {
                uint256 weightOld = (oldValue * 1e18) / (addedValue + oldValue);
                weightNew = 1e18 - weightOld;
            } else if (addedValue < oldValue) {
                weightNew = (addedValue * 1e18) / (addedValue + oldValue);
            } else {
                weightNew = 1e18 / 2;
            }
        }
    }

    /*
     + @notice Updates the user's entry time based on the weight of their deposit or withdrawal
     + @param amount The amount of the deposit / withdrawal
     + @param relicId The NFT ID of the position being updated
    */
    function _updateEntry(uint256 amount, uint256 relicId) internal {
        PositionInfo storage position = positionForId[relicId];
        uint256 weight = _findWeight(amount, position.amount);
        uint256 maturity = block.timestamp - position.entry;
        position.entry += (maturity * weight) / 1e18;
    }

    /*
     + @notice Updates the position's level based on entry time
     + @param relicId The NFT ID of the position being updated
     + @return newLevel Level of position after update
    */
    function _updateLevel(uint256 relicId) internal returns (uint256 newLevel) {
        newLevel = levelOnUpdate(relicId);
        PositionInfo storage position = positionForId[relicId];
        if (position.level != newLevel) {
            position.level = newLevel;
            emit LevelChanged(relicId, newLevel);
        }
    }

    /*
     + @notice returns The total deposits of the pool's token, weighted by maturity level allocation.
     + @param pid The index of the pool. See `poolInfo`.
     + @return The amount of pool tokens held by the contract
    */
    function _poolBalance(uint256 pid) internal view returns (uint256 total) {
        LevelInfo storage levelInfo = levels[pid];
        uint256 length = levelInfo.balance.length;
        for (uint256 i; i < length; i = _uncheckedInc(i)) {
            total += levelInfo.balance[i] * levelInfo.allocPoint[i];
        }
    }

    function isApprovedOrOwner(address spender, uint256 relicId)
        external
        view
        override
        returns (bool)
    {
        return _isApprovedOrOwner(spender, relicId);
    }

    /// @notice Require the sender is either the owner of the Relic or approved to transfer it
    /// @param relicId The NFT ID of the Relic
    function _requireApprovedOrOwner(uint256 relicId) internal view {
        require(
            _isApprovedOrOwner(msg.sender, relicId),
            "not owner or approved"
        );
    }

    /// @dev Utility function to bypass overflow checking, saving gas
    function _uncheckedInc(uint256 i) internal pure returns (uint256) {
        unchecked {
            return i + 1;
        }
    }

    /// @dev Utility function to bypass underflow checking, saving gas
    function _uncheckedDec(uint256 i) internal pure returns (uint256) {
        unchecked {
            return i - 1;
        }
    }

    function _mint(address to) private returns (uint256 id) {
        id = ++nonce;
        _safeMint(to, id);
    }

    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 tokenId
    ) internal override(ERC721, ERC721Enumerable) {
        ERC721Enumerable._beforeTokenTransfer(from, to, tokenId);
    }
}
