// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@boringcrypto/boring-solidity/contracts/libraries/BoringMath.sol";
import "@boringcrypto/boring-solidity/contracts/BoringBatchable.sol";
import "@boringcrypto/boring-solidity/contracts/BoringOwnable.sol";
import "./BeethovenxToken.sol";
import "./libraries/SignedSafeMath.sol";
import "./interfaces/IRewarder.sol";


// Have fun reading it. Hopefully it's bug-free. God bless.
contract BeethovenxMasterChef is BoringOwnable {
    using BoringMath for uint256;
    using BoringMath128 for uint128;
    using BoringERC20 for IERC20;
    using SignedSafeMath for int256;
    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        //
        // We do some fancy math here. Basically, any point in time, the amount of SUSHIs
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accBeethovenxPerShare) - user.rewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accBeethovenxPerShare` (and `lastRewardBlock`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
    }
    // Info of each pool.
    struct PoolInfo {
//        IERC20 lpToken; // Address of LP token contract.
        // we have a fixed number of BEETX tokens released per block, each pool gets his fraction based on the allocPoint
        uint256 allocPoint; // How many allocation points assigned to this pool. the fraction  BEETXs to distribute per block.
        uint256 lastRewardBlock; // Last block number that BEETXs distribution occurs.
        uint256 accBeetxPerShare; // Accumulated BEETXs per share, times 1e12. See below.
    }
    // The BEETX TOKEN!
    BeethovenxToken public beetx;
    // Dev address.
    address public devaddr;

    // Treasury address.
    address public treasuryaddr;

    // BEETHOVEn tokens created per block.
    uint256 public beetxPerBlock;

    uint256 private constant ACC_BEETX_PRECISION = 1e12;

    // Percentage of pool rewards that goto the devs.
    uint256 public devPercent;
    // Percentage of pool rewards that goes to the treasury.
    uint256 public treasuryPercent;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens per pool. poolId => address => userInfo
    /// @notice Address of the LP token for each MCV2 pool.
    IERC20[] public lpToken;

    /// @notice Address of each `IRewarder` contract in MCV2.
    IRewarder[] public rewarder;

    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;
    // The block number when BEETX mining starts.
    uint256 public startBlock;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount, address indexed to);
    event Harvest(address indexed user, uint256 indexed pid, uint256 amount);
    event LogPoolAddition(uint256 indexed pid, uint256 allocPoint, IERC20 indexed lpToken, IRewarder indexed rewarder);
    event LogSetPool(uint256 indexed pid, uint256 allocPoint, IRewarder indexed rewarder, bool overwrite);
    event LogUpdatePool(uint256 indexed pid, uint64 lastRewardBlock, uint256 lpSupply, uint256 accBeetxPerShare);
    event SetDevAddress(address indexed oldAddress, address indexed newAddress);
    event UpdateEmissionRate(address indexed user, uint256 _joePerSec);

    event EmergencyWithdraw(
        address indexed user,
        uint256 indexed pid,
        uint256 amount
    );

    constructor(
        BeethovenxToken _beethovenx,
        address _devaddr,
        address _treasuryaddr,
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
        beetx = _beethovenx;
        devaddr = _devaddr;
        treasuryaddr = _treasuryaddr;
        beetxPerBlock = _beetxPerBlock;
        startBlock = _startBlock;
        devPercent = _devPercent;
        treasuryPercent = _treasuryPercent;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(
        uint256 _allocPoint,
        IERC20 _lpToken,
        IRewarder _rewarder
    ) public onlyOwner {
        uint256 lastRewardBlock =
            block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        lpToken.push(_lpToken);
        rewarder.push(_rewarder);

        poolInfo.push(
            PoolInfo({
                allocPoint: _allocPoint,
                lastRewardBlock: lastRewardBlock,
                accBeetxPerShare: 0
            })
        );
        emit LogPoolAddition(lpToken.length.sub(1), allocPoint, _lpToken, _rewarder);
    }

    // Update the given pool's BEETHOVEN allocation point. Can only be called by the owner.
    function set(
        uint256 _pid,
        uint256 _allocPoint,
        IRewarder _rewarder,
        bool overwrite
    ) public onlyOwner {
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(
            _allocPoint
        );
        if (overwrite) { rewarder[_pid] = _rewarder; }
        poolInfo[_pid].allocPoint = _allocPoint.to64();
    }

    // View function to see pending BEETHOVENs on frontend.
    function pendingBeetx(uint256 _pid, address _user)
        external
        view
        returns (uint256 pending)
    {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        // how many beethovenxs per lp token
        uint256 accBeetxPerShare = pool.accBeetxPerShare;
        // total staked lp tokens in this pool
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            // just use blocks ?
//            uint256 multiplier =
//                getMultiplier(pool.lastRewardBlock, block.number);
//
//            uint256 beethovenxReward =
//                multiplier.mul(beethovenxPerBlock).mul(pool.allocPoint).div(
//                    totalAllocPoint
//                );
            uint256 multiplier = block.number.sub(pool.lastRewardBlock);
            uint256 beetxReward = multiplier
            .mul(beethovenxPerBlock)
            .mul(pool.allocPoint)
            .div(totalAllocPoint)
            .mul(1000 - devPercent - treasuryPercent)
            .div(1000);
            accBeetxPerShare = accBeetxPerShare.add(
                beetxReward.mul(ACC_BEETX_PRECISION).div(lpSupply)
            );
        }
        pending = user.amount.mul(accBeetxPerShare).div(ACC_BEETX_PRECISION).sub(user.rewardDebt);
    }

    // Update reward vairables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 pid) public returns (PoolInfo memory pool){
        pool = poolInfo[pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }

        if (block.number > pool.lastRewardBlock) {
            // total lp tokens
            uint256 lpSupply = lpToken[pid].balanceOf(address(this));
            if (lpSupply > 0) {
//                uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
                uint256 multiplier = block.number.sub(pool.lastRewardBlock);
                // rewards for this pool based on his allocation points
//                uint256 beethovenxReward =
//                    multiplier.mul(beethovenxPerBlock).mul(pool.allocPoint).div(
//                        totalAllocPoint
//                    );

                uint256 beetxReward = multiplier.mul(beetxPerBlock).mul(pool.allocPoint).div(
                    totalAllocPoint
                );
                uint256 lpPercent = 1000 - devPercent - treasuryPercent;
                beetx.mint(devaddr, beetxReward.mul(devPercent).div(1000));
                beetx.mint(treasuryaddr, beetxReward.mul(treasuryPercent).div(1000));
                beetx.mint(address(this), beetxReward.mul(lpPercent).div(1000));
                pool.accBeetxPerShare = pool.accJoePerShare.add(
                    beetxReward.mul(ACC_BEETX_PRECISION).div(lpSupply).mul(lpPercent).div(1000)
                );
            }
            pool.lastRewardBlock = block.number;
            poolInfo[pid] = pool;
            emit LogUpdatePool(pid, pool.lastRewardBlock, lpSupply, pool.accSushiPerShare);
        }
    }

    // Deposit LP tokens to MasterChef for BEETHOVEN allocation.
    function deposit(uint256 _pid, uint256 _amount) public {

        PoolInfo memory pool = updatePool(_pid);
        UserInfo storage user = userInfo[_pid][to];

        // Effects
        user.amount = user.amount.add(_amount);
        user.rewardDebt = user.rewardDebt.add(int256(_amount.mul(pool.accBeetxPerShare) / ACC_BEETX_PRECISION));

        // Interactions
        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward(_pid, to, to, 0, user.amount);
        }

        lpToken[_pid].safeTransferFrom(msg.sender, address(this), _amount);

        emit Deposit(msg.sender, _pid, _amount, to);
    }

    // Withdraw LP tokens from MasterChef.
    function withdraw(uint256 _pid, uint256 _amount) public {

        PoolInfo memory pool = updatePool(_pid);
        UserInfo storage user = userInfo[_pid][msg.sender];

        // Effects
        user.rewardDebt = user.rewardDebt.sub(int256(_amount.mul(pool.accBeetxPerShare) / ACC_BEETX_PRECISION));
        user.amount = user.amount.sub(_amount);

        // Interactions
        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward(_pid, msg.sender, to, 0, user.amount);
        }

        lpToken[_pid].safeTransfer(to, _amount);

        emit Withdraw(msg.sender, _pid, _amount, to);
    }

    /// @notice Harvest proceeds for transaction sender to `to`.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @param to Receiver of BEETHOVENX rewards.
    function harvest(uint256 _pid, address _to) public {
        PoolInfo memory pool = updatePool(_pid);
        UserInfo storage user = userInfo[_pid][msg.sender];
        int256 accumulatedBeetx = int256(user.amount.mul(pool.accBeetxPerShare) / ACC_BEETX_PRECISION);
        uint256 _pendingBeetx = accumulatedBeetx.sub(user.rewardDebt).toUInt256();

        // Effects
        user.rewardDebt = accumulatedBeetx;

        // Interactions
        if (_pendingBeetx != 0) {
            safeBeetxTransfer(_to, _pendingBeetx);
        }

        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward( _pid, msg.sender, _to, _pendingBeetx, user.amount);
        }

        emit Harvest(msg.sender, _pid, _pendingBeetx);
    }


    /// @notice Withdraw LP tokens from MCV2 and harvest proceeds for transaction sender to `to`.
    /// @param pid The index of the pool. See `poolInfo`.
    /// @param amount LP token amount to withdraw.
    /// @param to Receiver of the LP tokens and BEETHOVENX rewards.
    function withdrawAndHarvest(uint256 _pid, uint256 _amount, address _to) public {
        PoolInfo memory pool = updatePool(_pid);
        UserInfo storage user = userInfo[_pid][msg.sender];
        int256 accumulatedBeetx = int256(user.amount.mul(pool.accBeetxPerShare) / ACC_BEETX_PRECISION);
        uint256 _pendingBeetx = accumulatedBeetx.sub(user.rewardDebt).toUInt256();

        user.rewardDebt = accumulatedBeetx.sub(int256(_amount.mul(pool.accBeetxPerShare) / ACC_BEETX_PRECISION));
        user.amount = user.amount.sub(_amount);

        safeBeetxTransfer(_to, _pendingBeetx);

        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward(_pid, msg.sender, _to, _pendingBeetx, user.amount);
        }

        lpToken[_pid].safeTransfer(_to, _amount);

        emit Withdraw(msg.sender, _pid, _amount, _to);
        emit Harvest(msg.sender, _pid, _pendingBeetx);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;

        IRewarder _rewarder = rewarder[_pid];
        if (address(_rewarder) != address(0)) {
            _rewarder.onBeetxReward(_pid, msg.sender, to, 0, 0);
        }

        // Note: transfer can fail or succeed if `amount` is zero.
        lpToken[_pid].safeTransfer(to, amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount, to);
    }

    // Safe beethovenx transfer function, just in case if rounding error causes pool to not have enough BEETHOVENs.
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
        require(msg.sender == devaddr, "dev: wut?");
        devaddr = _devaddr;
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
