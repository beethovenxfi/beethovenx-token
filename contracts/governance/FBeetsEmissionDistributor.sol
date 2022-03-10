// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./BeetsBar.sol";
import "../token/BeethovenxMasterChef.sol";
import "./FBeetsLocker.sol";
import "../interfaces/IBalancerVault.sol";

contract FBeetsEmissionDistributor is
    ERC20("FBEETS EMISSION DISTRIBUTOR", "edfBEETS"),
    AccessControl
{
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR");
    bytes32 public constant DISTRIBUTE_ROLE = keccak256("DISTRIBUTE");

    BeethovenxMasterChef public chef;
    uint256 public farmPid;
    uint256 public fBeetsLockerShare;
    uint256 public constant DENOMINATOR = 1000;

    IERC20 public fidelioDuetteBpt;
    IERC20 public beets;
    BeetsBar public beetsBar;
    FBeetsLocker public locker;

    IBalancerVault public vault;
    bytes32 public fidelioDuettoPoolId;

    constructor(
        IERC20 _fidelioDuettoBpt,
        IERC20 _beets,
        BeetsBar _beetsBar,
        FBeetsLocker _locker,
        BeethovenxMasterChef _chef,
        uint256 _farmPid,
        uint256 _fBeetsLockerShare,
        IBalancerVault _vault,
        bytes32 _balancerPoolId,
        address admin
    ) {
        fidelioDuetteBpt = _fidelioDuettoBpt;
        beets = _beets;
        beetsBar = _beetsBar;
        locker = _locker;
        chef = _chef;
        farmPid = _farmPid;
        fBeetsLockerShare = _fBeetsLockerShare;
        vault = _vault;
        fidelioDuettoPoolId = _balancerPoolId;
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setupRole(OPERATOR_ROLE, admin);
        _setupRole(DISTRIBUTE_ROLE, admin);
    }

    function setFarmId(uint256 id) external onlyRole(OPERATOR_ROLE) {
        farmPid = id;
    }

    function setLocker(FBeetsLocker fbeetsLocker)
        external
        onlyRole(OPERATOR_ROLE)
    {
        locker = fbeetsLocker;
    }

    function depositToChef() external onlyRole(OPERATOR_ROLE) {
        _mint(address(this), 1);
        _approve(address(this), address(chef), 1);
        chef.deposit(farmPid, 1, address(this));
    }

    function withdrawAndDistribute() external onlyRole(OPERATOR_ROLE) {
        chef.withdrawAndHarvest(farmPid, 1, address(this));
        _burn(address(this), 1);
        _distribute();
    }

    function harvestAndDistribute() external onlyRole(DISTRIBUTE_ROLE) {
        chef.harvest(farmPid, address(this));
        _distribute();
    }

    function setFBeetsLockerShare(uint256 newFBeetsLockerShare)
        external
        onlyRole(OPERATOR_ROLE)
    {
        require(newFBeetsLockerShare <= 1000, "Share cannot exceed 100%");
        fBeetsLockerShare = newFBeetsLockerShare;
    }

    function _distribute() internal {
        if (beets.balanceOf(address(this)) > 0) {
            // Only distribute if share for lockers is greater than 0
            if (fBeetsLockerShare > 0) {
                // fBeetsLockerShare of the rewards go to locked fBeets holders
                uint256 rewardsForLockedFBeets = (beets.balanceOf(
                    address(this)
                ) * fBeetsLockerShare) / DENOMINATOR;
                beets.approve(address(locker), rewardsForLockedFBeets);
                locker.notifyRewardAmount(
                    address(beets),
                    rewardsForLockedFBeets
                );
            }

            // Only distribute to BPTs if lockersShare is less than 100%
            if (fBeetsLockerShare < DENOMINATOR) {
                (IERC20[] memory tokens, , ) = vault.getPoolTokens(
                    fidelioDuettoPoolId
                );
                address[] memory assets = new address[](tokens.length);
                uint256[] memory amountsIn = new uint256[](assets.length);
                for (uint256 i = 0; i < tokens.length; i++) {
                    assets[i] = address(tokens[i]);
                    amountsIn[i] = tokens[i].balanceOf(address(this));
                    tokens[i].approve(address(vault), amountsIn[i]);
                }
                uint256 minBptOut = 0;

                vault.joinPool(
                    fidelioDuettoPoolId,
                    address(this),
                    address(this),
                    IBalancerVault.JoinPoolRequest(
                        assets,
                        amountsIn,
                        abi.encode(
                            IBalancerVault.JoinKind.EXACT_TOKENS_IN_FOR_BPT_OUT,
                            amountsIn,
                            minBptOut
                        ),
                        false
                    )
                );

                // now we take the resulting fidelioDuetteBpt's and share them via revenue to the beets bar
                fidelioDuetteBpt.approve(
                    address(beetsBar),
                    fidelioDuetteBpt.balanceOf(address(this))
                );

                beetsBar.shareRevenue(
                    fidelioDuetteBpt.balanceOf(address(this))
                );
            }
        }
    }
}
