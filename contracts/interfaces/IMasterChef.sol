// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./IRewarder.sol";

pragma experimental ABIEncoderV2;

interface IMasterChef {
   struct UserInfo {
       uint256 amount;     // How many LP tokens the user has provided.
       uint256 rewardDebt; // Reward debt. See explanation below.
   }

   struct PoolInfo {
       IERC20 lpToken;           // Address of LP token contract.
       uint256 allocPoint;       // How many allocation points assigned to this pool. SUSHI to distribute per block.
       uint256 lastRewardBlock;  // Last block number that SUSHI distribution occurs.
       uint256 accSushiPerShare; // Accumulated SUSHI per share, times 1e12. See below.
   }

    function lpTokens(uint256) external view returns (address);
    function poolInfo(uint256)
        external
        view
        returns (
            uint256 allocPoint,
            uint256 lastRewardBlock,
            uint256 accBeetsPerShare
        );
   function poolLength() view external returns(uint256);
   function totalAllocPoint() external view returns (uint256);
   function deposit(uint256 _pid, uint256 _amount) external;
   function set(uint256 _pid, uint256 _allocPoint, IRewarder _rewarder, bool overwrite) external;
}