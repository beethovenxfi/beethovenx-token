// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract Beets is ERC20, Ownable {
    uint256 public constant YEAR_IN_SECONDS = 365 days;
    // 10% per year is the hardcoded max inflation rate, as defined in BIP-##
    uint256 public constant MAX_INFLATION_PER_YEAR = 1e17;

    // The initial start timestamp is defined on deployment. This is the start time of the current year
    // for which the minting cap is calculated.
    uint256 public startTimestampCurrentYear;

    // The amount of tokens we've minted so far for the current year
    uint256 public amountMintedCurrentYear;

    // The starting supply is the total supply at the start of the current year, it's used to calculate the
    // minting cap such that no more than 10% of the starting supply can be minted during the current year.
    uint256 public startingSupplyCurrentYear;

    error MaxInflationRateForCurrentYearReached();
    error CurrentYearHasNotEnded();
    error CurrentYearEnded();

    constructor(uint256 _initialSupply)
        ERC20("Beets", "BEETS")
        Ownable()
    {
        _mint(msg.sender, _initialSupply);

        // The current year starts at the deployment timestamp
        startTimestampCurrentYear = block.timestamp;

        startingSupplyCurrentYear = totalSupply();

        amountMintedCurrentYear = 0;
    }

    function mint(address to, uint256 amount) public onlyOwner {
        if (block.timestamp > getEndTimestampCurrentYear()) {
            // The current year has ended, a call to incrementYear() is required before minting more tokens
            // In the instance that several years have passed, we ensure that no tokens are minted for previous years
            revert CurrentYearEnded();
        }

        amountMintedCurrentYear += amount;

        if (amountMintedCurrentYear > getMaxAllowedSupplyCurrentYear()) {
            revert MaxInflationRateForCurrentYearReached();
        }

        _mint(to, amount);
    }

    /**
     * @notice Increments the current year by one. Must be called before minting more tokens once the current year
     * has ended.
     * @dev In the instance that several years have passed, this function may need to be called multiple times.
     */
    function incrementYear() public onlyOwner {
        if (block.timestamp <= getEndTimestampCurrentYear()) {
            revert CurrentYearHasNotEnded();
        }

        // increment the current year by one
        startTimestampCurrentYear += YEAR_IN_SECONDS;

        // reset the amount minted for the current year
        amountMintedCurrentYear = 0;

        // The starting supply is the current total supply
        startingSupplyCurrentYear = totalSupply();
    }

    /**
     * @notice Calculates the maximum allowed supply for the current year.
     * @return The maximum allowed supply for the current year.
     */
    function getMaxAllowedSupplyCurrentYear() public view returns (uint256) {
        return startingSupplyCurrentYear + (startingSupplyCurrentYear * MAX_INFLATION_PER_YEAR) / 1 ether;
    }

    /**
     * @notice Calculates the end timestamp for the current year.
     * @return The end timestamp for the current year.
     */
    function getEndTimestampCurrentYear() public view returns (uint256) {
        return startTimestampCurrentYear + YEAR_IN_SECONDS;
    }
}
