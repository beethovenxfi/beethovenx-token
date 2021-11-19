// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract BeetsBar is ERC20("FreshBeets", "fBEETS") {
    using SafeERC20 for IERC20;

    IERC20 public vestingToken;

    event Enter(
        address indexed user,
        uint256 vestingInAmount,
        uint256 mintedAmount
    );
    event Leave(
        address indexed user,
        uint256 vestingOutAmount,
        uint256 burnedAmount
    );
    event ShareRevenue(uint256 amount);

    constructor(IERC20 _vestingToken) {
        vestingToken = _vestingToken;
    }

    function enter(uint256 _amount) external {
        if (_amount > 0) {
            uint256 totalLockedTokenSupply = vestingToken.balanceOf(
                address(this)
            );

            uint256 totalFreshBeets = totalSupply();

            vestingToken.transferFrom(msg.sender, address(this), _amount);
            uint256 mintAmount;
            // If no fBeets exists, mint it 1:1 to the amount put in
            if (totalFreshBeets == 0 || totalLockedTokenSupply == 0) {
                mintAmount = _amount;
            }
            // Calculate and mint the amount of fBeets the blp is worth. The ratio will change overtime
            else {
                uint256 shareOfFreshBeets = (_amount * totalFreshBeets) /
                    totalLockedTokenSupply;

                mintAmount = shareOfFreshBeets;
            }
            _mint(msg.sender, mintAmount);
            emit Enter(msg.sender, _amount, mintAmount);
        }
    }

    function leave(uint256 _shareOfFreshBeets) external {
        if (_shareOfFreshBeets > 0) {
            uint256 totalVestedTokenSupply = vestingToken.balanceOf(
                address(this)
            );
            uint256 totalFreshBeets = totalSupply();
            // Calculates the amount of vestingToken the fBeets are worth
            uint256 amount = (_shareOfFreshBeets * totalVestedTokenSupply) /
                totalFreshBeets;
            _burn(msg.sender, _shareOfFreshBeets);
            vestingToken.transfer(msg.sender, amount);

            emit Leave(msg.sender, amount, _shareOfFreshBeets);
        }
    }

    function shareRevenue(uint256 _amount) external {
        vestingToken.transferFrom(msg.sender, address(this), _amount);
        emit ShareRevenue(_amount);
    }
}
