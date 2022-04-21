// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TimeBasedMasterChefRewarder.sol";
import "../governance/MasterChefOperator.sol";
import "../token/BeethovenxMasterChef.sol";

/*
    This factory automates deployment & configuration of rewarders. Anyone can prepare
    a rewarder which then needs to be approved by an admin (usually multisig). Once approved,
    a farm addition for the desired liquidity pool is staged on the master chef operator.
    In a next step, the staged farm addition has to be queued & executed on the master chef operator.
    Once this is done, the admin provided in the rewarder config can activate it, setting the
    emission rate and enabling the newly added master chef farm for emissions.

    To utilize contract verification by matching similar source, we dont provide the reward token
    in the constructor, but set it after creation with a one off setter.
*/

contract MasterChefRewarderFactory is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR");
    uint256 public constant DEFAULT_REWARDER_FARM_ALLOCATION = 10;

    address public defaultAdmin;

    struct RewarderConfig {
        address admin;
        address lpToken;
        address rewardToken;
        uint256 rewardsPerSecond;
        bool approved;
        uint256 timelockEta;
        bool activated;
    }

    MasterChefOperator public immutable masterChefOperator;
    BeethovenxMasterChef public immutable masterChef;

    RewarderConfig[] public rewarderConfigs;
    TimeBasedMasterChefRewarder[] public deployedRewarders;
    // admin address => deploymentIds
    mapping(address => uint256[]) public _deploymentIdsByAdmin;

    event RewarderPrepared(
        address lpToken,
        address rewarder,
        address rewardToken,
        uint256 rewardPerSecond,
        address admin,
        address sender
    );

    event RewarderApproved(address rewarder);
    event RewarderActivated(address rewarder);

    constructor(
        MasterChefOperator _masterChefOperator,
        BeethovenxMasterChef _masterChef,
        address _admin
    ) {
        masterChefOperator = _masterChefOperator;
        masterChef = _masterChef;
        defaultAdmin = _admin;
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
        _setupRole(OPERATOR_ROLE, _admin);
    }

    /// @notice Deploys a new rewarder contract with emissions set to 0 which needs approval by the admin
    /// @param lpToken LP token of the pool the rewarder is deployed for
    /// @param rewardToken The reward token
    /// @param rewardPerSecond The emissions for the reward token once the rewarder is activated
    /// @param admin The owner of the admin, only he can activate the rewarder and ownership is transferred on activation. If zero address provided, it defaults to the factory admin
    function prepareRewarder(
        address lpToken,
        address rewardToken,
        uint256 rewardPerSecond,
        address admin
    ) external returns (address) {
        address rewarderAdmin = admin != address(0) ? admin : defaultAdmin;
        rewarderConfigs.push(
            RewarderConfig(
                rewarderAdmin,
                lpToken,
                rewardToken,
                rewardPerSecond,
                false,
                0,
                false
            )
        );

        TimeBasedMasterChefRewarder rewarder = new TimeBasedMasterChefRewarder(
            address(masterChef)
        );
        // we dont provide the reward token in the constructor for contract verification reasons
        rewarder.initializeRewardToken(ERC20(rewardToken));
        deployedRewarders.push(rewarder);
        _deploymentIdsByAdmin[rewarderAdmin].push(deployedRewarders.length - 1);

        emit RewarderPrepared(
            lpToken,
            address(rewarder),
            rewardToken,
            rewardPerSecond,
            rewarderAdmin,
            msg.sender
        );
        return address(rewarder);
    }

    /// @notice Approves the rewarder prepared under the deployment ID and stages a new farm on the master chef operator
    /// @param deploymentId The deploymentId to approve
    /// @param timelockEta ETA for farm addition on the master chef operator timelock
    function approveRewarder(uint256 deploymentId, uint256 timelockEta)
        external
        onlyRole(OPERATOR_ROLE)
    {
        require(
            !rewarderConfigs[deploymentId].approved,
            "Rewarder already approved"
        );

        RewarderConfig storage config = rewarderConfigs[deploymentId];
        TimeBasedMasterChefRewarder rewarder = deployedRewarders[deploymentId];

        config.approved = true;
        config.timelockEta = timelockEta;

        MasterChefOperator.FarmAddition[]
            memory farmAdditions = new MasterChefOperator.FarmAddition[](1);
        farmAdditions[0] = MasterChefOperator.FarmAddition(
            IERC20(config.lpToken),
            0,
            rewarder
        );

        masterChefOperator.stageFarmAdditions(farmAdditions, timelockEta);
        emit RewarderApproved(address(rewarder));
    }

    /// @notice Sets the configured emission rate and adds the added master chef farm for emissions
    /// @param deploymentId The deploymenId to activate
    /// @param configurePool if true, tries to infer the master chef pool
    function activateRewarder(uint256 deploymentId, bool configurePool)
        external
    {
        require(
            msg.sender == rewarderConfigs[deploymentId].admin,
            "Only rewarder admin can activate it"
        );
        require(
            rewarderConfigs[deploymentId].approved,
            "Rewarder has not been approved yet"
        );

        require(
            !rewarderConfigs[deploymentId].activated,
            "Rewarder already activated"
        );

        RewarderConfig storage config = rewarderConfigs[deploymentId];
        TimeBasedMasterChefRewarder rewarder = deployedRewarders[deploymentId];
        config.activated = true;
        // we need to find the farm pool ID for the rewarder, since it has been added lately, we start from the top
        if (configurePool) {
            uint256 poolId = masterChef.poolLength();
            require(poolId > 0);

            bool poolFound = false;
            do {
                poolId--;

                if (
                    address(masterChef.lpTokens(poolId)) == config.lpToken &&
                    masterChef.rewarder(poolId) == rewarder
                ) {
                    poolFound = true;
                }
            } while (poolId > 0 && !poolFound);

            if (!poolFound) {
                revert("Pool for lp token not found");
            }

            // we configure the farm in the rewarder
            rewarder.add(poolId, DEFAULT_REWARDER_FARM_ALLOCATION);
        }
        rewarder.setRewardPerSecond(config.rewardsPerSecond);
        // and transfer ownership to the admin
        rewarder.transferOwnership(config.admin);

        emit RewarderActivated(address(rewarder));
    }

    /// @notice Total amount of prepared rewarders
    function rewarderDeploymentLength() external view returns (uint256) {
        return deployedRewarders.length;
    }

    function deploymentIdsByAdmin(address admin)
        external
        view
        returns (uint256[] memory)
    {
        return _deploymentIdsByAdmin[admin];
    }
}
