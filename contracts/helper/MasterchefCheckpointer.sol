// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.7;

import "../token/BeethovenxMasterChef.sol";

contract MasterchefCheckpointer {
    BeethovenxMasterChef public immutable masterchef;

    constructor(BeethovenxMasterChef _masterchef) {
        masterchef = _masterchef;
    }

    function checkpointUsers(uint256 pid, address[] calldata userAddresses) external {
        for (uint256 i = 0; i < userAddresses.length; i++) {
            masterchef.deposit(pid, 0, userAddresses[i]);
        }
    }
}
