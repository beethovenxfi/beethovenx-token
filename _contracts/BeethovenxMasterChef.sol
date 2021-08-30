// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;


import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "hardhat/console.sol";
import "./BeethovenxToken.sol";
import "./interfaces/IRewarder.sol";


// Have fun reading it. Hopefully it's still bug-free
contract BeethovenxMasterChef is Ownable {
    using  SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        //
        // We do some fancy math here. Basically, any point in time, the amount of BEETX
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accBeetxPerShare) - user.rewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accBeetxPerShare` (and `lastRewardBlock`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
    }
    // Info of each pool.
    struct PoolInfo {
        // we have a fixed number of BEETX tokens released per block, each pool gets his fraction based on the allocPoint
        uint256 allocPoint; // How many allocation points assigned to this pool. the fraction  BEETXs to distribute per block.
        uint256 lastRewardBlock; // Last block number that BEETXs distribution occurs.
        uint256 accBeetxPerShare; // Accumulated BEETXs per share, times 1e12. See below.
    }
    // The BEETX TOKEN!
    BeethovenxToken public beetx;
    // Dev address.
    address public devAddress;

    // Treasury address.
    address public treasuryAddress;

    // BEETX tokens created per block.
    uint256 public beetxPerBlock;

    uint256 private constant ACC_BEETX_PRECISION = 1e12;

    // Percentage of pool rewards that goto the devs.
    uint256 public devPercent;
    // Percentage of pool rewards that goes to the treasury.
    uint256 public treasuryPercent;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens per pool. poolId => address => userInfo
    /// @notice Address of the LP token for each MCV pool.
    IERC20[] public lpTokens;

    EnumerableSet.AddressSet private lpTokenAddresses;


    /// @notice Address of each `IRewarder` contract in MCV.
    IRewarder[] public rewarder;

    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;
    // The block number when BEETX mining starts.
    uint256 public startBlock;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amount);
    event LogPoolAddition(uint256 indexed pid, uint256 allocPoint, IERC20 indexed lpToken, IRewarder indexed rewarder);
    event LogSetPool(uint256 indexed pid, uint256 allocPoint, IRewarder indexed rewarder, bool overwrite);
    event LogUpdatePool(uint256 indexed pid, uint256 lastRewardBlock, uint256 lpSupply, uint256 accBeetxPerShare);
    event SetDevAddress(address indexed oldAddress, address indexed newAddress);
    event UpdateEmissionRate(address indexed user, uint256 _beetxPerSec);

    constructor(
        BeethovenxToken _beetx,
        address _devAddress,
        address _treasuryAddress,
        uint256 _beetxPerBlock,
        uint256 _startBlock,
        uint256 _devPercent,
        uint256 _treasuryPercent
    ) public {
        require(
            0 <= _devPercent && _devPercent <= 1000,
            "constructor: invalid dev percent value"
        );
        require(
            0 <= _treasuryPercent && _treasuryPercent <= 1000,
            "constructor: invalid treasury percent value"
        );
        require(
            _devPercent + _treasuryPercent <= 1000,
            "constructor: total percent over max"
        );
        beetx = _beetx;
        devAddress = _devAddress;
        treasuryAddress = _treasuryAddress;
        beetxPerBlock = _beetxPerBlock;
        startBlock = _startBlock;
        devPercent = _devPercent;
        treasuryPercent = _treasuryPercent;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    function add(
        uint256 _allocPoint,
        IERC20 _lpToken,
        IRewarder _rewarder
    ) public onlyOwner {
        require(
            Address.isContract(address(_lpToken)),
            "add: LP token must be a valid contract"
        );
        require(
            Address.isContract(address(_rewarder)) ||
            address(_rewarder) == address(0),
            "add: rewarder must be contract or zero"
        );
        require(!lpTokenAddresses.contains(address(_lpToken)), "add: LP already added");

        massUpdatePools();

        uint256 lastRewardBlock =
            block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint + _allocPoint;
        lpTokens.push(_lpToken);
        lpTokenAddresses.add(address(_lpToken));
        rewarder.push(_rewarder);

        poolInfo.push(
            PoolInfo({
                allocPoint: _allocPoint,
                lastRewardBlock: lastRewardBlock,
                accBeetxPerShare: 0
            })
        );
        emit LogPoolAddition(lpTokens.length - 1, _allocPoint, _lpToken, _rewarder);
    }

    function _lpTokensContain(IERC20 lpToken) internal pure {

    }

    // Update the given pool's BEETX allocation point. Can only be called by the owner.
    function set(
        uint256 _pid,
        uint256 _allocPoint,
        IRewarder _rewarder,
        bool overwrite
    ) public onlyOwner {
        require(
            Address.isContract(address(_rewarder)) ||
            address(_rewarder) == address(0),
            "set: rewarder must be contract or zero"
        );
        massUpdatePools();

        totalAllocPoint = totalAllocPoint - poolInfo[_pid].allocPoint + _allocPoint;
        poolInfo[_pid].allocPoint = _allocPoint;
        if (overwrite) { rewarder[_pid] = _rewarder; }
        emit LogSetPool(_pid, _allocPoint, overwrite ? _rewarder : rewarder[_pid], overwrite);
    }

    // View function to see pending BEETXs on frontend.
    function pendingBeetx(uint256 _pid, address _user)
        external
        view
        returns (uint256 pending)
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        // how many BEETXs per lp token
        uint256 accBeetxPerShare = pool.accBeetxPerShare;
        // total staked lp tokens in this pool
        uint256 lpSupply = lpTokens[_pid].balanceOf(address(this));

        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 blocksSinceLastReward = block.number - pool.lastRewardBlock;
            // based on the pool weight (allocation points) we calculate the beetx rewarded for this specific pool
            uint256 beetxRewards = blocksSinceLastReward * beetxPerBlock * pool.allocPoint / totalAllocPoint;

            // we take parts of the rewards for dev & treasury, these can be subject to change, so we recalculate it
            // a value of 1000 = 100%
            uint256 poolPercent = 1000 - devPercent - treasuryPercent;
            uint256 beetxRewardsForPool = beetxRewards * poolPercent / 1000;

            // we calculate the new amount of accumulated beetx per LP token
            accBeetxPerShare = accBeetxPerShare + (beetxRewardsForPool * ACC_BEETX_PRECISION / lpSupply);
        }
        // based on the number of LP tokens the user owns, we calculate the pending amount by subtracting the amount
        // which he is not eligible for (joined the pool later) or has already harvested
        pending = user.amount * accBeetxPerShare / ACC_BEETX_PRECISION - user.rewardDebt;
    }

    // Update reward vairables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public returns (PoolInfo memory pool){
        pool = poolInfo[_pid];

        if (block.number > pool.lastRewardBlock) {
            // total lp tokens staked for this pool
            uint256 lpSupply = lpTokens[_pid].balanceOf(address(this));
            if (lpSupply > 0) {
//                uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
                uint256 blocksSinceLastReward = block.number - pool.lastRewardBlock;
                // rewards for this pool based on his allocation points

                uint256 beetxRewards = blocksSinceLastReward * beetxPerBlock * pool.allocPoint / totalAllocPoint;

                // we take parts of the rewards for dev & treasury, these can be subject to change, so we recalculate it
                // a value of 1000 = 100%
                uint256 poolPercent = 1000 - devPercent - treasuryPercent;

                uint256 beetxRewardsForPool = beetxRewards * poolPercent / 1000;

                beetx.mint(devAddress, beetxRewards * devPercent / 1000);
                beetx.mint(treasuryAddress, beetxRewards * treasuryPercent / 1000);
                beetx.mint(address(this), beetxRewardsForPool);
                pool.accBeetxPerShare = pool.accBeetxPerShare + (beetxRewardsForPool * ACC_BEETX_PRECISION / lpSupply);
            }
            pool.lastRewardBlock = block.number;
            poolInfo[_pid] = pool;
            emit LogUpdatePool(_pid, pool.lastRewardBlock, lpSupply, pool.accBeetxPerShare);
        }
    }

    // Deposit LP tokens to MasterChef for BEETX allocation.
    function deposit(uint256 _pid, uint256 _amount, address _to) public {

        PoolInfo memory pool = updatePool(_pid);
        UserInfo storage user = userInfo[_pid][_to];

        user.amount = user.amount + _amount;
        // since we add more LP tokens, we have to keep track of the rewards he is not eligible for
        // if we would not do that, he would get rewards like he added them since the beginning of this pool
        // note that only the accBeetxPerShare have the precision applied
        user.rewardDebt = user.rewardDebt + _amount * pool.accBeetxPerShare / ACC_BEETX_PRECISION;

        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward(_pid, _to, _to, 0, user.amount);
        }


        lpTokens[_pid].safeTransferFrom( msg.sender, address(this), _amount);

        emit Deposit(msg.sender, _pid, _amount, _to);
    }

    /// @notice Harvest proceeds for transaction sender to `_to`.
    /// @param _pid The index of the pool. See `poolInfo`.
    /// @param _to Receiver of BEETX rewards.
    function harvest(uint256 _pid, address _to) public {
        PoolInfo memory pool = updatePool(_pid);
        UserInfo storage user = userInfo[_pid][msg.sender];

        // this would  be the amount if the user joined right from the start of the farm
        uint256 accumulatedBeetx = user.amount * pool.accBeetxPerShare / ACC_BEETX_PRECISION;
        // subtracting the rewards the user is not eligible for
        uint256 _pendingBeetx = accumulatedBeetx - user.rewardDebt;

        // we set the new rewardDebt to the current accumulated amount of rewards for his amount of LP token
        user.rewardDebt = accumulatedBeetx;

        if (_pendingBeetx != 0) {
            safeBeetxTransfer(_to, _pendingBeetx);
        }

        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward( _pid, msg.sender, _to, _pendingBeetx, user.amount);
        }

        emit Harvest(msg.sender, _pid, _pendingBeetx);
    }


    /// @notice Withdraw LP tokens from MCV and harvest proceeds for transaction sender to `_to`.
    /// @param _pid The index of the pool. See `poolInfo`.
    /// @param _amount LP token amount to withdraw.
    /// @param _to Receiver of the LP tokens and BEETX rewards.
    function withdrawAndHarvest(uint256 _pid, uint256 _amount, address _to) public {
        PoolInfo memory pool = updatePool(_pid);
        UserInfo storage user = userInfo[_pid][msg.sender];

        // this would  be the amount if the user joined right from the start of the farm
        uint256 accumulatedBeetx = user.amount * pool.accBeetxPerShare / ACC_BEETX_PRECISION;
        // subtracting the rewards the user is not eligible for
        uint256 _pendingBeetx = accumulatedBeetx - user.rewardDebt;

        user.rewardDebt = accumulatedBeetx - _amount * pool.accBeetxPerShare / ACC_BEETX_PRECISION;
        user.amount = user.amount - _amount;

        safeBeetxTransfer(_to, _pendingBeetx);

        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward(_pid, msg.sender, _to, _pendingBeetx, user.amount);
        }

        lpTokens[_pid].safeTransfer(_to, _amount);

        emit Withdraw(msg.sender, _pid, _amount, _to);
        emit Harvest(msg.sender, _pid, _pendingBeetx);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid, address _to) public {
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;

        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward(_pid, msg.sender, _to, 0, 0);
        }

        // Note: transfer can fail or succeed if `amount` is zero.
        lpTokens[_pid].safeTransfer(_to, amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount, _to);
    }

    // Safe BEETX transfer function, just in case if rounding error causes pool to not have enough BEETHOVENs.
    function safeBeetxTransfer(address _to, uint256 _amount) internal {
        uint256 beetxBal = beetx.balanceOf(address(this));
        if (_amount > beetxBal) {
            beetx.transfer(_to, beetxBal);
        } else {
            beetx.transfer(_to, _amount);
        }
    }

    // Update dev address by the previous dev.
    function dev(address _devaddr) public {
        require(msg.sender == devAddress, "dev: wut?");
        devAddress = _devaddr;
    }

    function setDevPercent(uint256 _newDevPercent) public onlyOwner {
        require(
            0 <= _newDevPercent && _newDevPercent <= 1000,
            "setDevPercent: invalid percent value"
        );
        require(
            treasuryPercent + _newDevPercent <= 1000,
            "setDevPercent: total percent over max"
        );
        devPercent = _newDevPercent;
    }

    // Update treasury address by the previous treasury.
    function treasury(address _treasuryAddress) public {
        require(msg.sender == treasuryAddress, "setTreasuryAddress: wut?");
        treasuryAddress = _treasuryAddress;
    }

    function setTreasuryPercent(uint256 _newTreasuryPercent) public onlyOwner {
        require(
            0 <= _newTreasuryPercent && _newTreasuryPercent <= 1000,
            "setTreasuryPercent: invalid percent value"
        );
        require(
            devPercent + _newTreasuryPercent <= 1000,
            "setTreasuryPercent: total percent over max"
        );
        treasuryPercent = _newTreasuryPercent;
    }

    // Pancake has to add hidden dummy pools inorder to alter the emission,
    // here we make it simple and transparent to all.
    function updateEmissionRate(uint256 _beetxPerBlock) public onlyOwner {
        massUpdatePools();
        beetxPerBlock = _beetxPerBlock;
        emit UpdateEmissionRate(msg.sender, _beetxPerBlock);
    }
}
