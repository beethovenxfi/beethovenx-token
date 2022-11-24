// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../token/BeethovenxMasterChef.sol";
import "./BeetsConstantEmissionCurve.sol";
import "../interfaces/IReliquary.sol";

import "hardhat/console.sol";

/**
 *
 * This helper will harvest all beets to reliquary and based on the beets available adjust the beets/s on reliquary.
 * The new rate will be based on the amount harvested and the time since the last harvest: rate = amountHarvested / secondsSindLastHarves
 *
 */

contract ReliquaryBeetsStreamer is
    ERC20("ReliquaryStreamerBPT", "rqBPT"),
    Ownable
{
    uint256 public constant MAX_SUPPLY = 10; // 10 tokens only

    BeethovenxMasterChef public masterchef;
    IReliquary public reliquary;
    uint256 public masterchefPoolId;
    address emergencyHarvestTarget;
    ERC20 public beets;

    uint256 public lastTransferTimestamp = 0;

    uint256 private immutable secondsIn7Days = 604800;

    constructor(
        BeethovenxMasterChef _masterchef,
        uint256 _masterchefPoolId,
        IReliquary _reliquary,
        ERC20 _beets,
        address _emergencyHarvestTarget
    ) {
        masterchef = _masterchef;
        masterchefPoolId = _masterchefPoolId;
        reliquary = _reliquary;
        beets = _beets;
        emergencyHarvestTarget = _emergencyHarvestTarget;
    }

    // mints one BPT and deposits it into the masterchef
    function deposit() external onlyOwner {
        require(
            totalSupply() + 1 <= MAX_SUPPLY,
            "rqBPT::mint: cannot exceed max supply"
        );
        _mint(address(this), 1);
        _approve(address(this), address(masterchef), 1);
        masterchef.deposit(masterchefPoolId, 1, address(this));
    }

    function startNewEpoch() external onlyOwner {
        // harvest and send the beets to the reliquary
        masterchef.harvest(masterchefPoolId, address(this));
        uint256 beetsHarvested = beets.balanceOf(address(this));
        beets.transfer(address(reliquary), beetsHarvested);

        // calculate new emission rate based on emission rate from masterchef
        uint256 secondsSinceLastHarvest = block.timestamp -
            lastTransferTimestamp;

        BeetsConstantEmissionCurve curve = BeetsConstantEmissionCurve(
            address(reliquary.emissionCurve())
        );

        if (lastTransferTimestamp == 0) {
            secondsSinceLastHarvest = secondsIn7Days;
        }

        uint256 newBeetsPerSecond = beetsHarvested / secondsSinceLastHarvest;
        curve.setRate(newBeetsPerSecond);

        lastTransferTimestamp = block.timestamp;
    }

    function emergencyHarvest() external onlyOwner {
        masterchef.harvest(masterchefPoolId, emergencyHarvestTarget);
    }
}
