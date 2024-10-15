// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface IBalancerPool {
    /**
     * @dev Returns this Pool's ID, used when interacting with the Vault (to e.g. join the Pool or swap with it).
     */
    function getPoolId() external view returns (bytes32);
}
