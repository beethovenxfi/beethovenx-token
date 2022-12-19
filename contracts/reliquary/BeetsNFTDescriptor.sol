// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import '@openzeppelin/contracts/utils/Strings.sol';
import '../interfaces/INFTDescriptor.sol';
import '../interfaces/IReliquary.sol';

contract BeetsNFTDescriptor is INFTDescriptor {
    using Strings for uint;

    string private constant IPFS = 'https://beethoven-assets.s3.eu-central-1.amazonaws.com/reliquary';

    IReliquary public immutable reliquary;

    constructor(IReliquary _reliquary) {
        reliquary = _reliquary;
    }

    /// @notice Generate tokenURI as a base64 encoding from live on-chain values
    function constructTokenURI(uint relicId) external view override returns (string memory uri) {
        PositionInfo memory position = reliquary.getPositionForId(relicId);
        uri = string.concat(IPFS, '/', position.level.toString(), '.png');
    }
}
