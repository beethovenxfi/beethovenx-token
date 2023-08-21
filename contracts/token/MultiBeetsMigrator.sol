// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MultiBeetsMigrator {
    IERC20 public immutable MULTIBEETS;
    IERC20 public immutable LZBEETS;
    address public immutable TREASURY;

    bool public enabled = false;

    address public admin;

    constructor(
        IERC20 _MULTIBEETS,
        IERC20 _LZBEETS,
        address _TREASURY
    ) {
        MULTIBEETS = _MULTIBEETS;
        LZBEETS = _LZBEETS;
        TREASURY = _TREASURY;
        admin = msg.sender;
    }

    function setAdmin(address _admin) public {
        require(msg.sender == admin, "only admin");
        admin = _admin;
    }

    function enable(bool _toggle) external {
        require(msg.sender == admin, "only admin");
        enabled = _toggle;
    }

    function exchange(uint256 amount) public {
        require(enabled, "migration disabled");
        MULTIBEETS.transferFrom(msg.sender, address(this), amount);
        LZBEETS.transfer(msg.sender, amount);
    }

    function withdrawMultiBeets() public {
        require(msg.sender == admin, "only admin");
        MULTIBEETS.transfer(TREASURY, MULTIBEETS.balanceOf(address(this)));
    }

    function withdrawLzBeets() public {
        require(msg.sender == admin, "only admin");
        LZBEETS.transfer(TREASURY, LZBEETS.balanceOf(address(this)));
    }
}
