// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

interface INFTDescriptor {
    function constructTokenURI(uint256 relicId)
        external
        view
        returns (string memory);
}
