// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

//
// This contract handles swapping to and from xBeethoven, Beethoven Balancer's staking token.
contract BeethovenBar is ERC20("BeethovenBar", "xBEETHOVEN"){
    using SafeMath for uint256;
    IERC20 public beethoven;

    // Define the Beethoven token contract
    constructor(IERC20 _beethoven) public {
        beethoven = _beethoven;
    }

    // Locks Beethoven and mints xBeethoven
    function enter(uint256 _amount) public {
        // Gets the amount of Beethoven locked in the contract
        uint256 totalBeethoven = beethoven.balanceOf(address(this));
        // Gets the amount of xBeethoven in existence
        uint256 totalShares = totalSupply();
        // If no xBeethoven exists, mint it 1:1 to the amount put in
        if (totalShares == 0 || totalBeethoven == 0) {
            _mint(msg.sender, _amount);
        } 
        // Calculate and mint the amount of xBeethoven the Beethoven is worth. The ratio will change overtime, as xBeethoven is burned/minted and Beethoven deposited + gained from fees / withdrawn.
        else {
            uint256 what = _amount.mul(totalShares).div(totalBeethoven);
            _mint(msg.sender, what);
        }
        // Lock the Beethoven in the contract
        beethoven.transferFrom(msg.sender, address(this), _amount);

    }

    // Leave the bar. Claim back your SUSHIs.
    // Unlocks the staked + gained Beethoven and burns xBeethoven
    function leave(uint256 _share) public {
        // Gets the amount of xBeethoven in existence
        uint256 totalShares = totalSupply();
        // Calculates the amount of Beethoven the xBeethoven is worth
        uint256 what = _share.mul(beethoven.balanceOf(address(this))).div(totalShares);
        _burn(msg.sender, _share);
        beethoven.transfer(msg.sender, what);
    }
}
