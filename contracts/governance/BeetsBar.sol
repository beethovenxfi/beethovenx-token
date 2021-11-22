// SPDX-License-Identifier: MIT

pragma solidity 0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BeetsBar is ERC20("FreshBeets", "fBEETS"), Ownable {
    using SafeERC20 for IERC20;

    uint256 public constant LOCK_PENALTY_DENOMINATOR = 1000;

    uint256 public lockPenalty;
    IERC20 public vestingToken;
    uint256 public lockPeriod;
    mapping(address => uint256) public userLockStartTs;
    mapping(address => uint256) public userEligibleFreshBeets;

    event Enter(
        address indexed user,
        uint256 vestingInAmount,
        uint256 mintedAmount,
        uint256 lockStartTs
    );
    event Leave(
        address indexed user,
        uint256 vestingOutAmount,
        uint256 burnedAmount,
        uint256 lockStartTs
    );
    event ShareRevenue(uint256 amount);
    event SetLockDuration(uint256 duration);
    event SetLockPenalty(uint256 lockPenality);

    constructor(
        IERC20 _vestingToken,
        uint256 _lockDuration,
        uint256 _lockPenalty
    ) {
        require(
            _lockPenalty <= (LOCK_PENALTY_DENOMINATOR / 2),
            "Lock penalty can be at most 50% of the funds"
        );

        vestingToken = _vestingToken;
        lockPeriod = _lockDuration;
        lockPenalty = _lockPenalty;
    }

    function setLockDuration(uint256 _lockDuration) external onlyOwner {
        lockPeriod = _lockDuration;
        emit SetLockDuration(_lockDuration);
    }

    function setLockPenalty(uint256 _lockPenalty) external onlyOwner {
        require(
            _lockPenalty <= (LOCK_PENALTY_DENOMINATOR / 2),
            "Lock penalty can be at most 50% of the funds"
        );
        lockPenalty = _lockPenalty;
    }

    function enter(uint256 _amount) external {
        if (_amount > 0) {
            uint256 totalLockedTokenSupply = vestingToken.balanceOf(
                address(this)
            );

            uint256 totalFreshBeets = totalSupply();

            vestingToken.transferFrom(msg.sender, address(this), _amount);
            uint256 mintAmount;
            // If no fBeets exists, mint it 1:1 to the amount put in
            if (totalFreshBeets == 0 || totalLockedTokenSupply == 0) {
                mintAmount = _amount;
            }
            // Calculate and mint the amount of fBeets the blp is worth. The ratio will change overtime
            else {
                uint256 shareOfFreshBeets = (_amount * totalFreshBeets) /
                    totalLockedTokenSupply;

                mintAmount = shareOfFreshBeets;
            }

            userEligibleFreshBeets[msg.sender] =
                userEligibleFreshBeets[msg.sender] +
                mintAmount;

            _mint(msg.sender, mintAmount);
            userLockStartTs[msg.sender] = block.timestamp;
            emit Enter(msg.sender, _amount, mintAmount, block.timestamp);
        }
    }

    function leave(uint256 _shareOfFreshBeets) external {
        if (_shareOfFreshBeets > 0) {
            uint256 totalVestedTokenSupply = vestingToken.balanceOf(
                address(this)
            );
            uint256 totalFreshBeets = totalSupply();

            uint256 lockEndTs = userLockStartTs[msg.sender] + lockPeriod;

            uint256 toWithdraw = _shareOfFreshBeets;
            uint256 lockStart = userLockStartTs[msg.sender];
            uint256 currentLockDuration = block.timestamp.sub(lockStart);

            if (lockStart != 0 && currentLockDuration < lockPeriod) {
                uint256 sharesBase = (numberOfShares *
                    (LOCK_PENALTY_DENOMINATOR - lockPenalty)) /
                    LOCK_PENALTY_DENOMINATOR;

                toWithdraw =
                    sharesBase +
                    ((numberOfShares - sharesBase) *
                        (currentLockDuration / lockPeriod));
            }

            // Calculates the amount of vestingToken the fBeets are worth
            uint256 amount = (toWithdraw * totalVestedTokenSupply) /
                totalFreshBeets;

            userEligibleFreshBeets[msg.sender] =
                userEligibleFreshBeets[msg.sender] -
                _shareOfFreshBeets;
            _burn(msg.sender, _shareOfFreshBeets);
            vestingToken.transfer(msg.sender, amount);
            emit Leave(msg.sender, amount, _shareOfFreshBeets);
        }
    }

    function shareRevenue(uint256 _amount) external {
        vestingToken.transferFrom(msg.sender, address(this), _amount);
        emit ShareRevenue(_amount);
    }

    function transfer(address _recipient, uint256 _amount)
        public
        virtual
        override
        returns (bool)
    {
        transferLockDuration(msg.sender, _recipient, _amount);
        super.transfer(_recipient, _amount);
        return true;
    }

    function transferFrom(
        address _sender,
        address _recipient,
        uint256 _amount
    ) public virtual override returns (bool) {
        transferLockDuration(_sender, _recipient, _amount);
        super.transferFrom(_sender, _recipient, _amount);
        return true;
    }

    /**
     * @dev Applies the senders lock duration to the recipient if its longer. Compares
     *      balanceOf with amount transferred so it has to be called before the transfer
     * @param _sender fBeets sender
     * @param _recipient fBeets recipient
     * @param _amount amount to transfer
     *
     */
    function transferLockDuration(
        address _sender,
        address _recipient,
        uint256 _amount
    ) private {
        uint256 senderLockDuration = userLockStartTs[_sender];
        // if the lock duration of the sender is longer than recipient, we take sender lock duration
        if (userLockStartTs[_recipient] < senderLockDuration) {
            userLockStartTs[_recipient] = senderLockDuration;
        }
        // if sender has no more fBeets, reset lock start to 0
        if (balanceOf(_sender) == _amount) {
            userLockStartTs[_sender] = 0;
        }
    }
}
