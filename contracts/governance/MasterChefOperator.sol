// SPDX-License-Identifier: MIT
pragma solidity 0.8.7;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./Timelock.sol";
import "../interfaces/IRewarder.sol";

contract MasterChefOperator is AccessControl {
    using EnumerableSet for EnumerableSet.UintSet;

    bytes32 public constant STAGE_ROLE = keccak256("STAGING");
    bytes32 public constant COMMIT_ROLE = keccak256("COMMITTING");

    struct FarmModification {
        uint256 pid;
        uint256 allocationPoints;
        IRewarder rewarder;
        bool overwriteRewarder;
    }

    struct FarmAddition {
        IERC20 lpToken;
        uint256 allocationPoints;
        IRewarder rewarder;
    }

    enum TransactionType {
        QUEUE,
        EXECUTE
    }

    // mapping eta => changes
    mapping(uint256 => FarmAddition[]) public farmAdditions;
    mapping(uint256 => FarmModification[]) public farmModifications;

    // eta's which have already been used
    mapping(uint256 => bool) public usedFarmChangeEtas;

    EnumerableSet.UintSet private _queuedFarmChangeEtas;

    Timelock public immutable timelock;
    address public immutable masterChef;

    constructor(
        Timelock _timelock,
        address _masterChef,
        address admin,
        address stagingAdmin
    ) {
        timelock = _timelock;
        masterChef = _masterChef;
        _setupRole(DEFAULT_ADMIN_ROLE, admin);
        _setupRole(COMMIT_ROLE, admin);
        _setupRole(STAGE_ROLE, stagingAdmin);
    }

    function acceptTimelockAdmin() external onlyRole(COMMIT_ROLE) {
        timelock.acceptAdmin();
    }

    function commitSetPendingTimelockAdmin(
        address admin,
        uint256 eta,
        TransactionType txType
    ) external onlyRole(COMMIT_ROLE) {
        if (txType == TransactionType.QUEUE) {
            timelock.queueTransaction(
                address(timelock),
                0,
                "setPendingAdmin(address)",
                abi.encode(admin),
                eta
            );
        } else {
            timelock.executeTransaction(
                address(timelock),
                0,
                "setPendingAdmin(address)",
                abi.encode(admin),
                eta
            );
        }
    }

    function commitSetTreasuryAddress(
        address treasury,
        uint256 eta,
        TransactionType txType
    ) external onlyRole(COMMIT_ROLE) {
        if (txType == TransactionType.QUEUE) {
            timelock.queueTransaction(
                masterChef,
                0,
                "treasury(address)",
                abi.encode(treasury),
                eta
            );
        } else {
            timelock.executeTransaction(
                masterChef,
                0,
                "treasury(address)",
                abi.encode(treasury),
                eta
            );
        }
    }

    function commitEmissionChange(
        uint256 beetsPerBlock,
        uint256 eta,
        TransactionType txType
    ) external onlyRole(COMMIT_ROLE) {
        if (txType == TransactionType.QUEUE) {
            timelock.queueTransaction(
                masterChef,
                0,
                "updateEmissionRate(uint256)",
                abi.encode(beetsPerBlock),
                eta
            );
        } else {
            timelock.executeTransaction(
                masterChef,
                0,
                "updateEmissionRate(uint256)",
                abi.encode(beetsPerBlock),
                eta
            );
        }
    }

    function stageFarmAdditions(FarmAddition[] calldata farmsToAdd, uint256 eta)
        external
        updateEtas(eta)
        onlyRole(STAGE_ROLE)
    {
        for (uint256 i = 0; i < farmsToAdd.length; i++) {
            farmAdditions[eta].push(farmsToAdd[i]);
        }
    }

    function stageFarmModifications(
        FarmModification[] calldata farmsToEdit,
        uint256 eta
    ) external updateEtas(eta) onlyRole(STAGE_ROLE) {
        for (uint256 i = 0; i < farmsToEdit.length; i++) {
            farmModifications[eta].push(farmsToEdit[i]);
        }
    }

    function commitFarmChanges(uint256 eta, TransactionType txType)
        external
        onlyRole(COMMIT_ROLE)
    {
        if (txType == TransactionType.QUEUE) {
            queueFarmModifications(eta);
        } else {
            executeFarmModifications(eta);
        }
    }

    function queueFarmModifications(uint256 eta) internal {
        FarmModification[] storage farmEditTxs = farmModifications[eta];
        for (uint256 i = 0; i < farmEditTxs.length; i++) {
            timelock.queueTransaction(
                masterChef,
                0,
                "set(uint256,uint256,address,bool)",
                abi.encode(
                    farmEditTxs[i].pid,
                    farmEditTxs[i].allocationPoints,
                    farmEditTxs[i].rewarder,
                    farmEditTxs[i].overwriteRewarder
                ),
                eta
            );
        }
        FarmAddition[] storage farmAddTxs = farmAdditions[eta];
        for (uint256 i = 0; i < farmAddTxs.length; i++) {
            timelock.queueTransaction(
                masterChef,
                0,
                "add(uint256,address,address)",
                abi.encode(
                    farmAddTxs[i].allocationPoints,
                    farmAddTxs[i].lpToken,
                    farmAddTxs[i].rewarder
                ),
                eta
            );
        }

        usedFarmChangeEtas[eta] = true;
    }

    function executeFarmModifications(uint256 eta) internal {
        FarmModification[] storage farmEditTxs = farmModifications[eta];
        for (uint256 i = 0; i < farmEditTxs.length; i++) {
            timelock.executeTransaction(
                masterChef,
                0,
                "set(uint256,uint256,address,bool)",
                abi.encode(
                    farmEditTxs[i].pid,
                    farmEditTxs[i].allocationPoints,
                    farmEditTxs[i].rewarder,
                    farmEditTxs[i].overwriteRewarder
                ),
                eta
            );
        }

        FarmAddition[] storage farmAddTxs = farmAdditions[eta];
        for (uint256 i = 0; i < farmAddTxs.length; i++) {
            timelock.executeTransaction(
                masterChef,
                0,
                "add(uint256,address,address)",
                abi.encode(
                    farmAddTxs[i].allocationPoints,
                    farmAddTxs[i].lpToken,
                    farmAddTxs[i].rewarder
                ),
                eta
            );
        }
    }

    function queuedFarmChangeEtas() external view returns (uint256[] memory) {
        return _queuedFarmChangeEtas.values();
    }

    function farmAdditionsForEta(uint256 eta)
        external
        view
        returns (FarmAddition[] memory)
    {
        return farmAdditions[eta];
    }

    function farmModificationsForEta(uint256 eta)
        external
        view
        returns (FarmModification[] memory)
    {
        return farmModifications[eta];
    }


    function queueTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data,
        uint256 eta
    ) public onlyRole(COMMIT_ROLE) returns (bytes32) {
        return timelock.queueTransaction(target, value, signature, data, eta);
    }

    function cancelTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data,
        uint256 eta
    ) public onlyRole(COMMIT_ROLE) {
        return timelock.cancelTransaction(target, value, signature, data, eta);
    }

    function executeTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data,
        uint256 eta
    ) public payable onlyRole(COMMIT_ROLE) returns (bytes memory) {
        return timelock.executeTransaction(target, value, signature, data, eta);
    }

    modifier updateEtas(uint256 eta) {
        require(!usedFarmChangeEtas[eta], "ETA already used, chose other eta");
        _queuedFarmChangeEtas.add(eta);
        _;
    }
}
