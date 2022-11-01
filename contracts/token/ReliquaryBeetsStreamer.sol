// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./BeethovenxMasterChef.sol";
import "hardhat/console.sol";

contract ReliquaryBeetsStreamer is
    ERC20("ReliquaryStreamerBPT", "rqBPT"),
    Ownable
{
    uint256 public constant MAX_SUPPLY = 10; // 10 tokens only

    BeethovenxMasterChef public masterchef;
    address public reliquaryAddress;
    uint256 public masterchefPoolId;

    constructor(
        BeethovenxMasterChef _masterchef,
        uint256 _masterchefPoolId,
        address _reliquary
    ) {
        masterchef = _masterchef;
        masterchefPoolId = _masterchefPoolId;
        reliquaryAddress = _reliquary;
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

    function harvestToReliquary() external onlyOwner {
        masterchef.harvest(masterchefPoolId, reliquaryAddress);
    }
}
