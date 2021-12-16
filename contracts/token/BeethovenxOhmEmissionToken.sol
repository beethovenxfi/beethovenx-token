// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BeethovenxOhmEmissionToken is
    ERC20("BeethovenxOhmEmissionToken", "OHMYBEETS"),
    Ownable
{
    constructor(address _tokenHolderAddress) {
        _mint(_tokenHolderAddress, 100e18);
        transferOwnership(_tokenHolderAddress);
    }
}
