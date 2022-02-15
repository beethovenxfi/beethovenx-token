// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./TimeBasedMasterChefRewarder.sol";
import "../governance/MasterChefOperator.sol";
import "../token/BeethovenxMasterChef.sol";

contract MasterChefRewarderFactory is AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR");
    uint256 public constant DEFAULT_REWARDER_FARM_ALLOCATION = 10;

    address public defaultAdmin;

    struct RewarderConfig {
        address admin;
        address lpToken;
        uint256 rewardsPerSecond;
        bool approved;
        uint256 timelockEta;
        bool activated;
    }

    MasterChefOperator public immutable masterChefOperator;
    BeethovenxMasterChef public immutable masterChef;

    RewarderConfig[] public rewarderConfigs;
    TimeBasedMasterChefRewarder[] public deployedRewarders;

    event RewarderPrepared(
        address lpToken,
        address rewarder,
        address rewardToken,
        uint256 rewardPerSecond,
        address admin,
        address sender
    );

    event RewarderApproved(address lpToken, address rewarder, address admin);
    event RewarderActivated(
        address lpToken,
        address rewarder,
        uint256 pid,
        address admin
    );

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
                rewardPerSecond,
                false,
                0,
                false
            )
        );

        TimeBasedMasterChefRewarder rewarder = new TimeBasedMasterChefRewarder(
            IERC20(rewardToken),
            0,
            address(masterChef)
        );
        deployedRewarders.push(rewarder);

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
        emit RewarderApproved(config.lpToken, address(rewarder), msg.sender);
    }

    function activateRewarder(uint256 deploymentId)
        external
        onlyRole(OPERATOR_ROLE)
    {
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
        rewarder.setRewardPerSecond(config.rewardsPerSecond);
        rewarder.transferOwnership(config.admin);

        emit RewarderActivated(
            config.lpToken,
            address(rewarder),
            poolId,
            msg.sender
        );
    }

    function rewarderDeploymentLength() external view returns (uint256) {
        return deployedRewarders.length;
    }
}
