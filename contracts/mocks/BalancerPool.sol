// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IBalancerVault.sol";

contract BalancerPool is IBalancerVault, ERC20("BalancerToken", "BPT") {
    constructor(uint256 initialSupply) {
        _mint(msg.sender, initialSupply);
    }

    function joinPool(
        bytes32,
        address,
        address recipient,
        JoinPoolRequest memory request
    ) external payable override {
        ERC20(request.assets[0]).transferFrom(
            msg.sender,
            address(this),
            request.maxAmountsIn[0]
        );
        _mint(recipient, request.maxAmountsIn[0]);
    }

    function mint(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
