// SPDX-License-Identifier: MIT

pragma solidity ^0.8.15;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/IERC721Enumerable.sol";
import "./IEmissionCurve.sol";
import "./INFTDescriptor.sol";
import "./IRewarder.sol";

/*
 + @notice Info for each Reliquary position.
 + `amount` LP token amount the position owner has provided
 + `rewardDebt` OATH accumalated before the position's entry or last harvest
 + `rewardCredit` OATH owed to the user on next harvest
 + `entry` Used to determine the maturity of the position
 + `poolId` ID of the pool to which this position belongs
 + `level` Index of this position's level within the pool's array of levels
*/
struct PositionInfo {
    uint256 amount;
    uint256 rewardDebt;
    uint256 rewardCredit;
    uint256 entry; // position owner's relative entry into the pool.
    uint256 poolId; // ensures that a single Relic is only used for one pool.
    uint256 level;
}

/*
 + @notice Info of each Reliquary pool
 + `accOathPerShare` Accumulated OATH per share of pool (1 / 1e12)
 + `lastRewardTime` Last timestamp the accumulated OATH was updated
 + `allocPoint` Pool's individual allocation - ratio of the total allocation
 + `name` Name of pool to be displayed in NFT image
*/
struct PoolInfo {
    uint256 accOathPerShare;
    uint256 lastRewardTime;
    uint256 allocPoint;
    string name;
}

/*
 + @notice Level that determines how maturity is rewarded
 + `requiredMaturity` The minimum maturity (in seconds) required to reach this Level
 + `allocPoint` Level's individual allocation - ratio of the total allocation
 + `balance` Total number of tokens deposited in positions at this Level
*/
struct LevelInfo {
    uint256[] requiredMaturity;
    uint256[] allocPoint;
    uint256[] balance;
}

interface IReliquary is IERC721Enumerable {
    function burn(uint256 tokenId) external;

    function setEmissionCurve(IEmissionCurve _emissionCurve) external;

    function supportsInterface(bytes4 interfaceId) external view returns (bool);

    function addPool(
        uint256 allocPoint,
        IERC20 _poolToken,
        IRewarder _rewarder,
        uint256[] calldata requiredMaturity,
        uint256[] calldata allocPoints,
        string memory name,
        INFTDescriptor _nftDescriptor
    ) external;

    function modifyPool(
        uint256 pid,
        uint256 allocPoint,
        IRewarder _rewarder,
        string calldata name,
        INFTDescriptor _nftDescriptor,
        bool overwriteRewarder
    ) external;

    function pendingOath(uint256 relicId)
        external
        view
        returns (uint256 pending);

    function massUpdatePools(uint256[] calldata pids) external;

    function updatePool(uint256 pid) external;

    function createRelicAndDeposit(
        address to,
        uint256 pid,
        uint256 amount
    ) external returns (uint256 id);

    function deposit(uint256 amount, uint256 relicId) external;

    function withdraw(uint256 amount, uint256 relicId) external;

    function harvest(uint256 relicId) external;

    function withdrawAndHarvest(uint256 amount, uint256 relicId) external;

    function emergencyWithdraw(uint256 relicId) external;

    function updatePosition(uint256 relicId) external;

    function split(
        uint256 relicId,
        uint256 amount,
        address to
    ) external returns (uint256 newId);

    function shift(
        uint256 fromId,
        uint256 toId,
        uint256 amount
    ) external;

    function merge(uint256 fromId, uint256 toId) external;

    // State

    function oath() external view returns (IERC20);

    function nftDescriptor(uint256) external view returns (INFTDescriptor);

    function emissionCurve() external view returns (IEmissionCurve);

    function getPoolInfo(uint256) external view returns (PoolInfo memory);

    function getLevelInfo(uint256) external view returns (LevelInfo memory);

    function poolToken(uint256) external view returns (IERC20);

    function rewarder(uint256) external view returns (IRewarder);

    function getPositionForId(uint256)
        external
        view
        returns (PositionInfo memory);

    function totalAllocPoint() external view returns (uint256);

    function poolLength() external view returns (uint256);
}
