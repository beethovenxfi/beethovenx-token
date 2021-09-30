// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

//
// This contract handles swapping to and from nBEETX, BEETX's staking token.
contract BeethovenxBar is ERC20("BeethovenxBar", "nBEETX") {
    IERC20 public beetx;

    // Define the Beetx token contract
    constructor(IERC20 _beetx) {
        beetx = _beetx;
    }

    // Locks Beethovenx and mints nBeethovenx
    function enter(uint256 _amount) public {
        // Gets the amount of Beethovenx locked in the contract
        uint256 totalBeetx = beetx.balanceOf(address(this));
        // Gets the amount of xBeethovenx in existence
        uint256 totalShares = totalSupply();
        // If no xBeethovenx exists, mint it 1:1 to the amount put in
        if (totalShares == 0 || totalBeetx == 0) {
            _mint(msg.sender, _amount);
        }
        // Calculate and mint the amount of nBEETX the BBEETX is worth. The ratio will change overtime, as nBEETX is burned/minted and BEETX deposited + gained from fees / withdrawn.
        else {
            uint256 what = (_amount * totalShares) / totalBeetx;
            _mint(msg.sender, what);
        }
        // Lock the BEETX in the contract
        beetx.transferFrom(msg.sender, address(this), _amount);
    }

    // Leave the bar. Claim back your BEETX's.
    // Unlocks the staked + gained BEETX and burns nBEETX
    function leave(uint256 _share) public {
        // Gets the amount of nBEETX in existence
        uint256 totalShares = totalSupply();
        // Calculates the amount of BEETX the nBEETX is worth
        uint256 what = (_share * beetx.balanceOf(address(this))) / totalShares;
        _burn(msg.sender, _share);
        beetx.transfer(msg.sender, what);
    }
}
