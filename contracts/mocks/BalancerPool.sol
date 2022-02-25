// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IBalancerVault.sol";
import "./BalancerVault.sol";

contract BalancerPool is ERC20 {
    IBalancerVault vault;
    IERC20[] public poolTokens;
    bytes32 public poolId;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        IBalancerVault _vault,
        IERC20[] memory _poolTokens
    ) ERC20(_name, _symbol) {
        poolTokens = _poolTokens;
        vault = _vault;
        _mint(msg.sender, _initialSupply);
    }

    function register() external {
        poolId = vault.registerPool();
    }

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }

    function tokenList() external view returns (IERC20[] memory) {
        return poolTokens;
    }
}
