// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract BeethovenxOrchestra is ERC20("FreshBeets", "fBEETS") {
    using SafeERC20 for IERC20;

    IERC20 public fidelioDuetto;

    constructor(IERC20 _fidelioDuetto) public {
        fidelioDuetto = _fidelioDuetto;
    }

    function enter(uint256 _amount) public {
        if (_amount > 0) {
            uint256 totalLockedFidelioDuettoSupply = fidelioDuetto.balanceOf(
                address(this)
            );

            uint256 totalFreshBeets = totalSupply();

            fidelioDuetto.transferFrom(msg.sender, address(this), _amount);
            // If no fBeets exists, mint it 1:1 to the amount put in
            if (totalFreshBeets == 0 || totalLockedFidelioDuettoSupply == 0) {
                _mint(msg.sender, _amount);
            }
            // Calculate and mint the amount of fBeets the blp is worth. The ratio will change overtime
            else {
                uint256 shareOfFreshBeets = (_amount * totalFreshBeets) /
                    totalLockedFidelioDuettoSupply;

                _mint(msg.sender, shareOfFreshBeets);
            }
        }
    }

    function leave(uint256 _shareOfFreshBeets) public {
        if (_shareOfFreshBeets > 0) {
            uint256 totalLockedFidelioDuettoSupply = fidelioDuetto.balanceOf(
                address(this)
            );
            uint256 totalFreshBeets = totalSupply();
            // Calculates the amount of fidelioDuetto the fBeets are worth
            uint256 amount = (_shareOfFreshBeets *
                totalLockedFidelioDuettoSupply) / totalFreshBeets;
            _burn(msg.sender, _shareOfFreshBeets);
            fidelioDuetto.transfer(msg.sender, amount);
        }
    }
}
