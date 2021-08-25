// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

//
// This contract handles swapping to and from xBeethovenx, Beethovenx Balancer's staking token.
contract BeethovenxBar is ERC20("BeethovenxBar", "nBEETX"){
    using SafeMath for uint256;
    IERC20 public beethovenx;

    // Define the Beethoven token contract
    constructor(IERC20 _beethovenx) public {
        beethovenx = _beethovenx;
    }

    // Locks Beethovenx and mints nBeethovenx
    function enter(uint256 _amount) public {
        // Gets the amount of Beethovenx locked in the contract
        uint256 totalBeethovenx = beethovenx.balanceOf(address(this));
        // Gets the amount of xBeethovenx in existence
        uint256 totalShares = totalSupply();
        // If no xBeethovenx exists, mint it 1:1 to the amount put in
        if (totalShares == 0 || totalBeethovenx == 0) {
            _mint(msg.sender, _amount);
        } 
        // Calculate and mint the amount of nBeethovenx the Beethovenx is worth. The ratio will change overtime, as nBeethovenx is burned/minted and Beethovenx deposited + gained from fees / withdrawn.
        else {
            uint256 what = _amount.mul(totalShares).div(totalBeethovenx);
            _mint(msg.sender, what);
        }
        // Lock the Beethovenx in the contract
        beethovenx.transferFrom(msg.sender, address(this), _amount);

    }

    // Leave the bar. Claim back your SUSHIs.
    // Unlocks the staked + gained Beethovenx and burns nBeethovenx
    function leave(uint256 _share) public {
        // Gets the amount of nBeethovenx in existence
        uint256 totalShares = totalSupply();
        // Calculates the amount of Beethovenx the nBeethovenx is worth
        uint256 what = _share.mul(beethovenx.balanceOf(address(this))).div(totalShares);
        _burn(msg.sender, _share);
        beethovenx.transfer(msg.sender, what);
    }
}
