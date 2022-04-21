// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 customDecimals,
        uint256 supply
    ) ERC20(name, symbol) {
        _decimals = customDecimals;
        _mint(msg.sender, supply);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
