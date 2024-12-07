// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract Beets is ERC20, Ownable {
    uint256 public constant YEAR_IN_SECONDS = 365 days;
    // 10% per year is the hardcoded max inflation rate, as defined in BIP-##
    uint256 public constant MAX_INFLATION_PER_YEAR = 1e17;

    uint256 public startTimestampCurrentYear;

    uint256 public amountMintedCurrentYear;

    uint256 public startingSupplyCurrentYear;

    error MaxInflationRateForCurrentYearReached();
    error CurrentYearHasNotEnded();
    error CurrentYearEnded();

    constructor(uint256 _initialSupply)
        ERC20("Beets", "BEETS")
        Ownable()
    {
        _mint(msg.sender, _initialSupply);

        startTimestampCurrentYear = block.timestamp;

        startingSupplyCurrentYear = totalSupply();

        amountMintedCurrentYear = 0;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        if (block.timestamp > getEndTimestampCurrentYear()) {
            revert CurrentYearEnded();
        }

        amountMintedCurrentYear += amount;

        if (amountMintedCurrentYear > getMaxAllowedSupplyCurrentYear()) {
            revert MaxInflationRateForCurrentYearReached();
        }

        _mint(to, amount);
    }

    function incrementYear() public onlyOwner {
        if (block.timestamp <= getEndTimestampCurrentYear()) {
            revert CurrentYearHasNotEnded();
        }

        startTimestampCurrentYear += YEAR_IN_SECONDS;

        amountMintedCurrentYear = 0;

        startingSupplyCurrentYear = totalSupply();
    }

    function getMaxAllowedSupplyCurrentYear() public view returns (uint256) {
        return startingSupplyCurrentYear + (startingSupplyCurrentYear * MAX_INFLATION_PER_YEAR) / 1 ether;
    }

    function getEndTimestampCurrentYear() public view returns (uint256) {
        return startTimestampCurrentYear + YEAR_IN_SECONDS;
    }
}
