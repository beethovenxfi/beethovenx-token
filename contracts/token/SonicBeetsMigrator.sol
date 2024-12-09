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

    function exchangeOperaToSonic(uint256 amount) public {
        require(operaToSonicEnabled, "ERR_MIGRATION_DISABLED");
        require(OPERABEETS.balanceOf(msg.sender) >= amount, "ERR_INSUFFICIENT_BALANCE_USER");
        require(SONICBEETS.balanceOf(address(this)) >= amount, "ERR_INSUFFICIENT_BALANCE");
        OPERABEETS.transferFrom(msg.sender, address(this), amount);
        SONICBEETS.transfer(msg.sender, amount);
    }

    function exchangeSonicToOpera(uint256 amount) public {
        require(sonicToOperaEnabled, "ERR_MIGRATION_DISABLED");
        require(SONICBEETS.balanceOf(msg.sender) >= amount, "ERR_INSUFFICIENT_BALANCE_USER");
        require(OPERABEETS.balanceOf(address(this)) >= amount, "ERR_INSUFFICIENT_BALANCE");
        SONICBEETS.transferFrom(msg.sender, address(this), amount);
        OPERABEETS.transfer(msg.sender, amount);
    }

    function setAdmin(address _admin) public {
        require(msg.sender == admin, "ERR_NOT_ADMIN");
        admin = _admin;
    }

    function enableOperaToSonic(bool _toggle) external {
        require(msg.sender == admin, "ERR_NOT_ADMIN");
        operaToSonicEnabled = _toggle;
    }

    function enableSonicToOpera(bool _toggle) external {
        require(msg.sender == admin, "ERR_NOT_ADMIN");
        sonicToOperaEnabled = _toggle;
    }

    function withdrawOperaBeets() public {
        require(msg.sender == admin, "ERR_NOT_ADMIN");
        OPERABEETS.transfer(TREASURY, OPERABEETS.balanceOf(address(this)));
    }

    function withdrawSonicBeets() public {
        require(msg.sender == admin, "ERR_NOT_ADMIN");
        SONICBEETS.transfer(TREASURY, SONICBEETS.balanceOf(address(this)));
    }
}
