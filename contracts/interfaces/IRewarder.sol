// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";


interface IRewarder {
    function onBeetxReward(uint256 pid, address user, address recipient, uint256 sushiAmount, uint256 newLpAmount) external;
//    function pendingTokens(uint256 pid, address user, uint256 beetxAmount) external view returns (IERC20[] memory, uint256[] memory);
}
