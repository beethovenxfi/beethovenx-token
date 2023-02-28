// SPDX-License-Identifier: MIT
pragma solidity ^0.8.15;

import "@openzeppelin/contracts/utils/Strings.sol";
import "../interfaces/INFTDescriptor.sol";
import "../interfaces/IReliquary.sol";

contract BeetsNftDescriptor is INFTDescriptor {
    using Strings for uint256;

    string private constant S3 = "https://beethoven-assets.s3.eu-central-1.amazonaws.com/reliquary";

    string public constant termsOfService = "https://beets.fi/terms-of-service";

    IReliquary public immutable reliquary;

    constructor(IReliquary _reliquary) {
        reliquary = _reliquary;
    }

    /// @notice Returns a link to the stored image
    function constructTokenURI(uint256 relicId) external view override returns (string memory uri) {
        PositionInfo memory position = reliquary.getPositionForId(relicId);
        uri = string.concat(S3, "/", position.level.toString(), ".png");
    }
}
