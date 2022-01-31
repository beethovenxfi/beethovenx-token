# BeethovenX token

## Contracts

### BeethovenxToken
The token uses OpenZeppelins ERC20 base contract and only adds a maximum supply of 250mio BEETS to it.

### BeethovenxMasterChef


The contract is based on SUSHI's version with some adjustments:
 - Upgrade to pragma 0.8.7
 - therefore remove usage of SafeMath (built in overflow check for solidity > 8)
 - Merge sushi's master chef V1 & V2 (no usage of dummy pool)
 - remove withdraw function (without harvest) => requires the rewardDebt to be an signed int instead of uint which requires a lot of casting and has no real usecase for us
 - no dev emissions, but treasury emissions instead
 - treasury percentage is subtracted from emissions instead of added on top
 - update of emission rate with upper limit of 6 BEETS/block
 - more require checks in general

### FBeetsLocker
Based on CVX Staking contract for https://www.convexfinance.com - https://github.com/convex-eth/platform/blob/main/contracts/contracts/CvxLocker.sol

Changes:
- upgrade to solidity 0.8.7
- remove boosted concept
- remove staking of locked tokens

#### Locking mechanism

- locking mechanism is based on epochs
- an epoch is defined by the timestamp of the start of an epoch
- an epoch length is defined by the `epochDuration` where the default is 1 week 
- there is an epoch for each week, there exist no holes (missing epochs)
- the release time for a lock period is set to the current epoch + `lockDuration` which defaults to 17 weeks
- all tokens locked within the same epoch share the same lock and therefore the same unlock time
- withdrawal / re-locking is incentivized by paying a reward for kicking out expired locks (plus grace period)

#### Voting
- locked tokens of the current epoch are not eligible for voting
- locked tokens which are expired (`lockDuration` has passed) are not eligible for voting
- the voting power is represented by the `balanceOf` function
- the total voting power is represented by the `totalSupply` function

#### Rewards

- rewards are shared between users based on the total amount of locked tokens in the contract
- tokens which have been locked in the current epoch and also tokens of expired locks are counted towards the total
- rewards can be claimed at any time

## Tests
Tests are located under the `test/` directory. 

### Scripts:
 - `yarn test`  - Runs all tests
 - `yarn test:coverage` - Runs all tests with coverage report






