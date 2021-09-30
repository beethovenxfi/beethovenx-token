// SPDX-License-Identifier: MIT

// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;
import "../interfaces/IRewarder.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract RewarderMock is IRewarder {
    using SafeERC20 for IERC20;
    uint256 private immutable rewardMultiplier;
    IERC20 private immutable rewardToken;
    uint256 private constant REWARD_TOKEN_DIVISOR = 1e18;
    address private immutable BEETHOVEN_MASTERCHEF;

    constructor(
        uint256 _rewardMultiplier,
        IERC20 _rewardToken,
        address _BEETHOVEN_MASTERCHEF
    ) {
        rewardMultiplier = _rewardMultiplier;
        rewardToken = _rewardToken;
        BEETHOVEN_MASTERCHEF = _BEETHOVEN_MASTERCHEF;
    }

    function onBeetsReward(
        uint256,
        address user,
        address to,
        uint256 beetsAmount,
        uint256
    ) external override onlyMCV2 {
        uint256 pendingReward =
            (beetsAmount * rewardMultiplier) / REWARD_TOKEN_DIVISOR;
        uint256 rewardBal = rewardToken.balanceOf(address(this));
        if (pendingReward > rewardBal) {
            rewardToken.safeTransfer(to, rewardBal);
        } else {
            rewardToken.safeTransfer(to, pendingReward);
        }
    }

    function pendingTokens(
        uint256 pid,
        address user,
        uint256 beetsAmount
    )
        external
        view
        override
        returns (IERC20[] memory rewardTokens, uint256[] memory rewardAmounts)
    {
        IERC20[] memory _rewardTokens = new IERC20[](1);
        _rewardTokens[0] = (rewardToken);
        uint256[] memory _rewardAmounts = new uint256[](1);
        _rewardAmounts[0] =
            (beetsAmount * rewardMultiplier) /
            REWARD_TOKEN_DIVISOR;
        return (_rewardTokens, _rewardAmounts);
    }

    modifier onlyMCV2 {
        require(
            msg.sender == BEETHOVEN_MASTERCHEF,
            "Only MCV2 can call this function."
        );
        _;
    }
}
