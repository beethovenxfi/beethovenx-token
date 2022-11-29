// SPDX-License-Identifier: MIT

pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../token/BeethovenxMasterChef.sol";
import "./BeetsConstantEmissionCurve.sol";
import "../interfaces/IReliquary.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 *
 * This helper will harvest all beets to reliquary and based on the beets available adjust the beets/s on reliquary.
 * The new rate will be based on the amount harvested and the time since the last harvest: rate = amountHarvested / secondsSindLastHarves
 *
 */

contract ReliquaryBeetsStreamer is
    ERC20("ReliquaryStreamerBPT", "rqBPT"),
    AccessControl
{
    uint256 public constant MAX_SUPPLY = 10; // 10 tokens only

    BeethovenxMasterChef public masterchef;
    IReliquary public reliquary;
    uint256 public masterchefPoolId;
    address emergencyHarvestTarget;
    ERC20 public beets;

    uint256 public lastTransferTimestamp = 0;

    /// @notice Access control roles.
    bytes32 public constant OPERATOR = keccak256("OPERATOR");

    constructor(
        BeethovenxMasterChef _masterchef,
        uint256 _masterchefPoolId,
        IReliquary _reliquary,
        ERC20 _beets,
        address _emergencyHarvestTarget,
        address admin
    ) {
        masterchef = _masterchef;
        masterchefPoolId = _masterchefPoolId;
        reliquary = _reliquary;
        beets = _beets;
        emergencyHarvestTarget = _emergencyHarvestTarget;
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setupRole(OPERATOR, admin);
    }

    // mints one BPT and deposits it into the masterchef
    function deposit() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(
            totalSupply() + 1 <= MAX_SUPPLY,
            "rqBPT::mint: cannot exceed max supply"
        );
        _mint(address(this), 1);
        _approve(address(this), address(masterchef), 1);
        masterchef.deposit(masterchefPoolId, 1, address(this));
    }

    function startNewEpoch() external onlyRole(OPERATOR) {
        require(lastTransferTimestamp != 0, "Must be initialized");
        // harvest and send the beets to the reliquary
        uint256 beetsHarvested = masterchef.pendingBeets(
            masterchefPoolId,
            address(this)
        );
        masterchef.harvest(masterchefPoolId, address(reliquary));

        // calculate new emission rate based on emission rate from masterchef
        uint256 secondsSinceLastHarvest = block.timestamp -
            lastTransferTimestamp;

        BeetsConstantEmissionCurve curve = BeetsConstantEmissionCurve(
            address(reliquary.emissionCurve())
        );

        uint256 newBeetsPerSecond = beetsHarvested / secondsSinceLastHarvest;
        require(
            newBeetsPerSecond <= 1e18,
            "New rate is above 1 beets per second"
        );
        curve.setRate(newBeetsPerSecond);

        lastTransferTimestamp = block.timestamp;
    }

    function initialize(uint256 emissionStartTimestamp)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(lastTransferTimestamp == 0, "Already initialized");
        lastTransferTimestamp = emissionStartTimestamp;
    }

    function emergencyHarvest() external onlyRole(DEFAULT_ADMIN_ROLE) {
        masterchef.harvest(masterchefPoolId, emergencyHarvestTarget);
    }
}
