// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IBalancerVault.sol";
import "./BalancerPool.sol";

contract BalancerVault is IBalancerVault {
    mapping(bytes32 => BalancerPool) poolsById;
    mapping(bytes32 => uint256[]) amountsByPool;

    uint256 lastChangeBlockNumber;

    function registerPool() external override returns (bytes32 poolId) {
        poolId = bytes32(abi.encode(msg.sender));
        BalancerPool pool = BalancerPool(msg.sender);
        poolsById[poolId] = pool;
        IERC20[] memory tokens = pool.tokenList();
        for (uint256 i = 0; i < tokens.length; i++) {
            amountsByPool[poolId].push(0);
        }
    }

    function joinPool(
        bytes32 poolId,
        address,
        address recipient,
        JoinPoolRequest memory request
    ) external payable override {
        BalancerPool pool = poolsById[poolId];
        uint256 totalAmount = 0;
        for (uint256 i = 0; i < request.assets.length; i++) {
            require(
                address(pool.poolTokens(i)) == request.assets[i],
                "Token mismatch"
            );
            ERC20(request.assets[i]).transferFrom(
                msg.sender,
                address(this),
                request.maxAmountsIn[i]
            );
            totalAmount += request.maxAmountsIn[i];
            amountsByPool[poolId][i] += request.maxAmountsIn[i];
        }
        lastChangeBlockNumber = block.number;
        pool.mint(recipient, totalAmount);
    }

    function getPoolTokens(bytes32 poolId)
        external
        view
        override
        returns (
            IERC20[] memory tokens,
            uint256[] memory balances,
            uint256 lastChangeBlock
        )
    {
        BalancerPool pool = poolsById[poolId];
        tokens = pool.tokenList();
        balances = amountsByPool[poolId];
        lastChangeBlock = lastChangeBlockNumber;
    }
}
