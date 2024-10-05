// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SonicBeetsMigrator {
    IERC20 public immutable OPERABEETS;
    IERC20 public immutable SONICBEETS;
    address public immutable TREASURY;

    bool public sonicToOperaEnabled = false;
    bool public operaToSonicEnabled = false;

    address public admin;

    constructor(
        IERC20 _OPERABEETS,
        IERC20 _SONICBEETS,
        address _TREASURY
    ) {
        OPERABEETS = _OPERABEETS;
        SONICBEETS = _SONICBEETS;
        TREASURY = _TREASURY;
        admin = msg.sender;
    }

    function setAdmin(address _admin) public {
        require(msg.sender == admin, "only admin");
        admin = _admin;
    }

    function enableOperaToSonic(bool _toggle) external {
        require(msg.sender == admin, "only admin");
        operaToSonicEnabled = _toggle;
    }

    function enableSonicToOpera(bool _toggle) external {
        require(msg.sender == admin, "only admin");
        sonicToOperaEnabled = _toggle;
    }

    function exchangeOperaToSonic(uint256 amount) public {
        require(operaToSonicEnabled, "migration disabled");
        OPERABEETS.transferFrom(msg.sender, address(this), amount);
        SONICBEETS.transfer(msg.sender, amount);
    }

    function exchangeSonicToOpera(uint256 amount) public {
        require(sonicToOperaEnabled, "migration disabled");
        SONICBEETS.transferFrom(msg.sender, address(this), amount);
        OPERABEETS.transfer(msg.sender, amount);
    }

    function withdrawOperaBeets() public {
        require(msg.sender == admin, "only admin");
        OPERABEETS.transfer(TREASURY, OPERABEETS.balanceOf(address(this)));
    }

    function withdrawSonicBeets() public {
        require(msg.sender == admin, "only admin");
        SONICBEETS.transfer(TREASURY, SONICBEETS.balanceOf(address(this)));
    }
}
