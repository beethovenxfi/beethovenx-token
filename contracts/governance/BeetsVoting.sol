// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "./FBeetsLocker.sol";

contract BeetsVoting is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    FBeetsLocker public immutable locker;
    uint256 public minDelegationDuration;

    struct VoteDelegation {
        address delegate;
        uint256 minDelegationTime;
    }

    // user address => vote delegation
    mapping(address => VoteDelegation) public voteDelegations;

    // mapping between user and addresses which got delegated
    mapping(address => EnumerableSet.AddressSet) private _delegations;

    event SetDelegate(address indexed delegator, address indexed delegate);
    event ClearDelegate(address indexed delegator, address indexed delegate);

    //erc20-like interface
    string private constant _name = "Voting fBeets Token";
    string private constant _symbol = "vfBeets";
    uint8 private constant _decimals = 18;

    constructor(FBeetsLocker _locker, uint256 _minDelegationDuration) {
        locker = _locker;
        minDelegationDuration = _minDelegationDuration;
    }

    function decimals() public pure returns (uint8) {
        return _decimals;
    }

    function name() public pure returns (string memory) {
        return _name;
    }

    function symbol() public pure returns (string memory) {
        return _symbol;
    }

    /// @notice Delegates votes of sender to `delegate`
    /// @param delegate Address of delegate
    function setDelegate(address delegate) external {
        require(delegate != msg.sender, "Cannot delegate to self");
        require(delegate != address(0), "Cannot delegate to 0x0");

        VoteDelegation storage currentDelegation = voteDelegations[msg.sender];

        require(
            currentDelegation.delegate != delegate,
            "Already delegated to this address"
        );

        // if his votes are already delegated, we need to ensure that the minimum delegation time has passed
        require(
            currentDelegation.minDelegationTime == 0 ||
                currentDelegation.minDelegationTime <= block.timestamp,
            "Delegation is locked"
        );

        // ok we are good to delegate those votes, first we have to remove it from the previous delegate if it exists
        if (currentDelegation.delegate != address(0)) {
            _delegations[currentDelegation.delegate].remove(msg.sender);
            emit ClearDelegate(msg.sender, currentDelegation.delegate);
        }
        // now we create a new vote delegation for the delegate and the minimum delegation duration
        voteDelegations[msg.sender] = VoteDelegation(
            delegate,
            block.timestamp + minDelegationDuration
        );
        // and add it to the delegate's set of delegated addresses
        _delegations[delegate].add(msg.sender);
        emit SetDelegate(msg.sender, delegate);
    }

    /// @notice Clears delegation of sender if min duration has passed
    function clearDelegate() external {
        VoteDelegation storage currentDelegation = voteDelegations[msg.sender];
        require(currentDelegation.delegate != address(0), "No delegate set");
        require(
            currentDelegation.minDelegationTime <= block.timestamp,
            "Delegation is locked"
        );

        // remove it from the delegate
        _delegations[currentDelegation.delegate].remove(msg.sender);
        emit ClearDelegate(msg.sender, currentDelegation.delegate);
        // and clear the delegation entry
        voteDelegations[msg.sender] = VoteDelegation(address(0), 0);
    }

    /// @notice Voting power of sender plus delegated votes
    function balanceOf(address user) external view returns (uint256) {
        // first we check if the user has delegated his votes
        if (voteDelegations[user].delegate != address(0)) {
            return 0;
        }
        // if not, we take his balance and add the balance of all addresses which delegated
        uint256 amount = locker.balanceOf(user);

        EnumerableSet.AddressSet storage delegates = _delegations[user];

        for (uint256 i = 0; i < delegates.length(); i++) {
            amount += locker.balanceOf(delegates.at(i));
        }

        return amount;
    }

    /// @notice Set minimum duration in seconds for a delegation
    /// @param duration Duration in seconds
    function setMinDelegationDuration(uint256 duration) external onlyOwner {
        minDelegationDuration = duration;
    }

    /// @notice Returns all addresses which delegated to `delegate`
    /// @param delegate the address to get delegations for
    function delegations(address delegate)
        external
        view
        returns (address[] memory)
    {
        return _delegations[delegate].values();
    }
}
