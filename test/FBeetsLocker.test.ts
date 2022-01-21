import { expect } from "chai"
import {
  advanceBlock,
  advanceBlocks,
  advanceTime,
  advanceTimeAndBlock,
  advanceToTime,
  getBlockTime,
  bn,
  deployContract,
  deployERC20Mock,
  latest,
} from "./utilities"
import { ethers } from "hardhat"
import { BeetsBar, ERC20Mock, FBeetsLocker } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import moment from "moment"
import { BigNumber } from "ethers"
import exp from "constants"

describe("fBeets locking contract", function () {
  const DENOMINATOR = 10000
  const EPOCH_DURATION = 86400 * 7
  const LOCK_DURATION = EPOCH_DURATION * 17

  let bpt: ERC20Mock
  let fBeets: BeetsBar
  let locker: FBeetsLocker
  let owner: SignerWithAddress
  let rewarder: SignerWithAddress
  let anotherRewarder: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    rewarder = signers[1]
    anotherRewarder = signers[2]
    alice = signers[3]
    bob = signers[4]
    carol = signers[5]
  })

  beforeEach(async function () {
    bpt = await deployERC20Mock("BEETS_FTM", "BPT", bn(10000))
    fBeets = await deployContract("BeetsBar", [bpt.address])
    locker = await deployContract<FBeetsLocker>("FBeetsLocker", [fBeets.address, EPOCH_DURATION, LOCK_DURATION])
  })

  it("sets correct initial state", async () => {
    /*
        only the lockingToken is set by the constructor, all other
        values are hardcoded in the contract.
        On deployment, the first epoch is created starting from the last
        thursday.
     */
    const expectedFirstEpoch = await currentEpoch()

    expect(await locker.lockingToken()).to.eq(fBeets.address)
    expect(await locker.epochDuration()).to.eq(EPOCH_DURATION)
    expect(await locker.lockDuration()).to.eq(LOCK_DURATION)
    expect(await locker.denominator()).to.eq(DENOMINATOR)
    expect(await locker.totalLockedSupply()).to.eq(0)
    expect(await locker.kickRewardPerEpoch()).to.eq(100)
    expect(await locker.kickRewardEpochDelay()).to.eq(4)
    expect(await locker.isShutdown()).to.be.false
    expect(await locker.name()).to.eq("Vote Locked fBeets Token")
    expect(await locker.symbol()).to.eq("vfBeets")
    expect(await locker.decimals()).to.eq(18)

    const actualFirstEpoch = await locker.epochs(0)
    expect(actualFirstEpoch.supply.toNumber()).to.eq(0)
    expect(actualFirstEpoch.startTime.toNumber()).to.eq(expectedFirstEpoch)
  })

  it("allows only owner to set kick incentive", async () => {
    await expect(locker.connect(bob).setKickIncentive(50, 5)).to.be.revertedWith("Ownable: caller is not the owner")

    await locker.connect(owner).setKickIncentive(50, 3)
    expect(await locker.kickRewardPerEpoch()).to.equal(50)
    expect(await locker.kickRewardEpochDelay()).to.equal(3)
  })

  it("does not allow setting the kick reward per epoch higher than 5% and the reward delay shorter than 2 epochs", async () => {
    await expect(locker.setKickIncentive(501, 4)).to.be.revertedWith("over max rate of 5% per epoch")
    await expect(locker.setKickIncentive(400, 1)).to.be.revertedWith("min delay of 2 epochs required")
  })

  it("only allows owner to set contract in shut down mode", async () => {
    await expect(locker.connect(bob).shutdown()).to.be.revertedWith("Ownable: caller is not the owner")
    await locker.shutdown()
    expect(await locker.isShutdown()).to.be.true
  })

  it("does not allow locking of 0 amount", async () => {
    const fBeetsAmount = bn(100)
    await mintFBeets(bob, fBeetsAmount)
    await fBeets.connect(bob).approve(locker.address, fBeetsAmount)

    // we try to lock 0 fBeets
    await expect(locker.connect(bob).lock(bob.address, bn(0))).to.be.revertedWith("Cannot lock 0 tokens")
  })

  it("does not allow locking when contract is shutdown", async () => {
    const lockAmount = bn(100)
    await mintFBeets(bob, lockAmount)
    await fBeets.connect(bob).approve(locker.address, lockAmount)

    await locker.shutdown()

    await expect(locker.connect(bob).lock(bob.address, bn(100))).to.be.revertedWith("Contract is in shutdown")
    // make sure the funds are still on bob
    expect(await fBeets.balanceOf(bob.address)).to.equal(lockAmount)
  })

  it("fills in any missing epochs before locking", async () => {
    /*
        in case nobody locked for one or more epochs and nobody called the external
        `checkpointEpoch()` function, those epochs did not get created yet so we
        fill in all epochs until the current one before locking
     */

    const oneWeekInSeconds = 604800
    const lockAmount = bn(100)
    await mintFBeets(bob, lockAmount)

    const startEpoch = await currentEpoch()

    // we advance the time 2 weeks
    await advanceTimeAndBlock(2 * oneWeekInSeconds)

    /*
        after contract creation it created the current epoch (at deploy time),
        now we are 2 weeks ahead, meaning that last & current epoch should be missing
        and therefore filled in on a `lock` or `checkpointEpoch` call
     */
    const actualFirstEpoch = await locker.epochs(0)
    expect(actualFirstEpoch.startTime).to.equal(startEpoch)
    expect(actualFirstEpoch.supply).to.equal(0)
    await expect(locker.epochs(1)).to.be.reverted

    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)

    const actualSecondEpoch = await locker.epochs(1)
    expect(actualSecondEpoch.startTime).to.equal(startEpoch + oneWeekInSeconds)
    expect(actualSecondEpoch.supply).to.equal(0)

    const actualThirdEpoch = await locker.epochs(2)
    expect(actualThirdEpoch.startTime).to.equal(startEpoch + 2 * oneWeekInSeconds)
    expect(actualThirdEpoch.supply).to.equal(lockAmount)
  })

  it("locks token from start of current epoch (last thursday) for 17 weeks", async () => {
    /*
        tokens get locked from the start of the currently running epoch for 17 weeks. this means if you enter at wednesday,
        which is the last day of the epoch, your tokens will be locked for 16 weeks + 1day. Therefore, if you lock your tokens on
        a thursday at 12:00 UTC, your total lock time will be 16 weeks + 12 hours.

        We expect
          - locked amount is transferred from user to contract
          - the locked amount is added to the users total balance
          - the locked amount is added to the user locking period (start of epoch + total lock duration)
          - locked amount is added to the epoch
          - locked amount is added to global locked amount
          - emits Locked event with locked amount for user address
     */

    const expectedLockedAmount = bn(100)
    await mintFBeets(bob, expectedLockedAmount)

    // we lock those fBeets up!
    await fBeets.connect(bob).approve(locker.address, expectedLockedAmount)

    await expect(locker.connect(bob).lock(bob.address, expectedLockedAmount))
      .to.emit(locker, "Locked")
      .withArgs(bob.address, expectedLockedAmount)

    // check if tokens have been transferred
    expect(await fBeets.balanceOf(bob.address)).to.equal(0)
    expect(await fBeets.balanceOf(locker.address)).to.equal(expectedLockedAmount)

    // we always keep the total amount of locked tokens over all users
    expect(await locker.totalLockedSupply()).to.equal(expectedLockedAmount)

    // we also keep the total amount of locked tokens for each user
    const userBalance = await locker.balances(bob.address)
    expect(userBalance.lockedAmount).to.equal(expectedLockedAmount)

    // then we keep the total amount of locked tokens for each epoch
    const epoch = await locker.epochs(0)

    expect(epoch.startTime).to.equal(await currentEpoch())
    expect(epoch.supply).to.equal(expectedLockedAmount)

    /*
        for each lock period, which lasts from the start of the current epoch + 17 weeks, an entry
        is created with the unlock time and the amount of tokens locked in this period
     */

    const userLock = await locker.userLocks(bob.address, 0)
    expect(userLock.locked).to.equal(expectedLockedAmount)
    expect(userLock.unlockTime).to.equal((await currentEpoch()) + LOCK_DURATION)
  })

  it("adds locked amount to same user lock period when locking multiple times within the same epoch", async () => {
    /*
        locks added within the same epoch will be added to the same locking period.

        ATTENTION: this test may fail when time passes to new epoch between 2 lock calls
     */
    const firstEpoch = await currentEpoch()
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)

    // lets advance 1 epoch
    await advanceTimeAndBlock(EPOCH_DURATION)

    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceBlocks(20)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)

    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)

    const expectedUnlockTime = firstEpoch + EPOCH_DURATION + LOCK_DURATION
    const actualUserLock = await locker.userLocks(bob.address, 0)

    expect(actualUserLock.locked).to.equal(firstLockAmount.add(secondLockAmount))
    expect(actualUserLock.unlockTime).to.equal(expectedUnlockTime)
  })

  it("does not allow to withdraw if no locks have expired", async () => {
    /*
        transaction should revert in case no locks have expired and therefore no tokens can be withdrawn
     */
    const expectedLockedAmount = bn(100)
    await mintFBeets(bob, expectedLockedAmount)

    await fBeets.connect(bob).approve(locker.address, expectedLockedAmount)
    await locker.connect(bob).lock(bob.address, expectedLockedAmount)
    // now we advance the time to 1 sec before unlock time
    await advanceToTime((await currentEpoch()) + LOCK_DURATION - 1)
    await expect(locker.connect(bob).processExpiredLocks(false, bob.address)).to.revertedWith("No expired locks present")
  })
  it("reverts if the user has no locks", async () => {
    await expect(locker.connect(bob).processExpiredLocks(false, bob.address)).to.revertedWith("Account has no locks")
  })

  it("withdraws all expired locks to specified account", async () => {
    /*
        we should be able to withdraw all expired locks where unlock time has passed
     */
    const firstEpoch = await currentEpoch()
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)

    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)
    const firstUnlockTime = firstEpoch + LOCK_DURATION

    // lets advance 1 epoch so we lock in 2 periods
    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)

    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)
    const secondUnlockTime = firstEpoch + EPOCH_DURATION + LOCK_DURATION

    // lets double check that both locks are present
    const firstLock = await locker.userLocks(bob.address, 0)
    const secondLock = await locker.userLocks(bob.address, 1)
    expect(firstLock.locked).to.equal(firstLockAmount)
    expect(firstLock.unlockTime).to.equal(firstUnlockTime)
    expect(secondLock.locked).to.equal(secondLockAmount)
    expect(secondLock.unlockTime).to.equal(secondUnlockTime)

    // now we advance to the unlock time of the first lock
    await advanceToTime(firstUnlockTime)
    // we trigger unlocking which should also emit the Withdrawn event
    await expect(locker.connect(bob).processExpiredLocks(false, bob.address))
      .to.emit(locker, "Withdrawn")
      .withArgs(bob.address, firstLockAmount, false)

    /*
        now the amount of the first lock should be back at bob and subtracted
        from the total lock amount & user balance
    */

    expect(await fBeets.balanceOf(bob.address)).to.equal(firstLockAmount)
    expect(await fBeets.balanceOf(locker.address)).to.equal(secondLockAmount)
    expect(await locker.totalLockedSupply()).to.equal(secondLockAmount)
    const userBalanceAfterFirstWithdraw = await locker.balances(bob.address)
    expect(userBalanceAfterFirstWithdraw.lockedAmount).to.equal(secondLockAmount)
    // the first user lock (index 0) has been processed, so the next unlock index to check would be index 1
    expect(userBalanceAfterFirstWithdraw.nextUnlockIndex).to.equal(1)

    // now advance to unlock time of second lock period
    await advanceToTime(secondUnlockTime)

    // we trigger unlocking again but this time we withdraw to alice
    await expect(locker.connect(bob).processExpiredLocks(false, alice.address))
      .to.emit(locker, "Withdrawn")
      .withArgs(bob.address, secondLockAmount, false)
    expect(await fBeets.balanceOf(alice.address)).to.equal(secondLockAmount)
    expect(await fBeets.balanceOf(locker.address)).to.equal(0)
    expect(await locker.totalLockedSupply()).to.equal(0)
    const userBalanceAfterSecondWithdraw = await locker.balances(bob.address)
    expect(userBalanceAfterSecondWithdraw.lockedAmount).to.equal(0)
    // both locks have been processed, so next one to check would be index 2
    expect(userBalanceAfterSecondWithdraw.nextUnlockIndex).to.equal(2)
  })

  it("allows to relock expired locks", async () => {
    const firstEpoch = await currentEpoch()
    /*
        expired locks can also be relocked instead of withdrawn, we can also relock them
        to a different account
     */
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)

    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)
    const firstUnlockTime = (await currentEpoch()) + LOCK_DURATION

    // lets advance 1 epoch so we lock in 2 periods
    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)

    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)
    const secondUnlockTime = firstEpoch + EPOCH_DURATION + LOCK_DURATION

    await advanceToTime(firstUnlockTime)

    /*
       we trigger relocking which should also emit the Withdrawn event and then emit again the Lock
       event
     */
    await expect(locker.connect(bob).processExpiredLocks(true, bob.address))
      .to.emit(locker, "Withdrawn")
      .withArgs(bob.address, firstLockAmount, true)
      .to.emit(locker, "Locked")
      .withArgs(bob.address, firstLockAmount)

    // now a third user lock with the relocked amount should have been created

    const bobsNewLockAfterFirstRelock = await locker.userLocks(bob.address, 2)

    expect(bobsNewLockAfterFirstRelock.locked).to.equal(firstLockAmount)
    expect(bobsNewLockAfterFirstRelock.unlockTime).to.equal(firstEpoch + LOCK_DURATION + LOCK_DURATION)
    // total supply & user balance should still be the full amount
    expect(await locker.totalLockedSupply()).to.equal(firstLockAmount.add(secondLockAmount))
    const bobsBalanceAfterFirstRelock = await locker.balances(bob.address)
    expect(bobsBalanceAfterFirstRelock.lockedAmount).to.equal(firstLockAmount.add(secondLockAmount))
    // the first user lock (index 0) has been processed, so the next unlock index to check would be index 1
    expect(bobsBalanceAfterFirstRelock.nextUnlockIndex).to.equal(1)

    // now advance to unlock time of second lock period
    await advanceToTime(secondUnlockTime)

    // we trigger unlocking again but this time we relock to alice
    await expect(locker.connect(bob).processExpiredLocks(true, alice.address))
      .to.emit(locker, "Withdrawn")
      .withArgs(bob.address, secondLockAmount, true)
      .to.emit(locker, "Locked")
      .withArgs(alice.address, secondLockAmount)

    // now a first user lock with the relocked amount should have been created for alice
    const aliceFirstLock = await locker.userLocks(alice.address, 0)

    expect(aliceFirstLock.locked).to.equal(secondLockAmount)
    expect(aliceFirstLock.unlockTime).to.equal(firstEpoch + EPOCH_DURATION + LOCK_DURATION + LOCK_DURATION)
    // total supply & user balance should still be the full amount
    expect(await locker.totalLockedSupply()).to.equal(firstLockAmount.add(secondLockAmount))

    // bob should have only have first amount as balance left
    const bobsBalanceAfterSecondRelock = await locker.balances(bob.address)
    expect(bobsBalanceAfterSecondRelock.lockedAmount).to.equal(firstLockAmount)
    // both locks have been processed, so next one to check would be index 2
    expect(bobsBalanceAfterSecondRelock.nextUnlockIndex).to.equal(2)

    // alice should have bobs first amount as balance and index 0 for next unlock index since no unlocks have been processes yet
    const aliceBalanceAfterSecondRelock = await locker.balances(alice.address)
    expect(aliceBalanceAfterSecondRelock.lockedAmount).to.equal(secondLockAmount)
    expect(aliceBalanceAfterSecondRelock.nextUnlockIndex).to.equal(0)
  })

  it("allows withdrawal of all tokens (locked or unlocked) when in shutdown", async () => {
    /*
        the contract can be set into shutdown mode when all locked tokens can be withdrawn no matter
        if they are locked or not.

        For this test, we gonna set up an expired and an active lock and see if we
        can withdraw everything when in shutdown mode
     */
    const firstUnlockTime = (await currentEpoch()) + LOCK_DURATION
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)
    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)
    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)

    // now we advance to the first unlock time so they are not locked anymore
    await advanceToTime(firstUnlockTime, true)
    await locker.shutdown()
    expect(await locker.isShutdown()).to.be.true
    await locker.connect(bob).processExpiredLocks(false, bob.address)
    expect(await fBeets.balanceOf(bob.address)).to.equal(firstLockAmount.add(secondLockAmount))
  })

  it("reverts when trying to lock tokens when in shutdown mode", async () => {
    const lockAmount = bn(100)
    await mintFBeets(bob, lockAmount)

    await locker.shutdown()

    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await expect(locker.connect(bob).lock(bob.address, lockAmount)).to.be.revertedWith("Contract is in shutdown")
    expect(await fBeets.balanceOf(bob.address)).to.be.equal(lockAmount)
  })

  it("includes all locked tokens which are not expired except the ones for the current epoch in the user balanceOf", async () => {
    /*
        the `balanceOf(user)` call includes all locked tokens which are NOT:
         -  part of the current epoch
         - expired (unlock time > current time)

         we create the following setup:
          - 1 lock expired
          - 1 lock from previous epoch (eligible)
          - 1 lock in current epoch

     */

    const firstUnlockTime = (await currentEpoch()) + LOCK_DURATION
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)
    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)
    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)

    // now we advance to the first unlock time so they are not eligible anymore
    await advanceToTime(firstUnlockTime)

    // we lock more beets in this epoch which should not be eligible
    const thirdLockAmount = bn(300)
    await mintFBeets(bob, thirdLockAmount)
    await fBeets.connect(bob).approve(locker.address, thirdLockAmount)
    await locker.connect(bob).lock(bob.address, thirdLockAmount)

    expect(await locker.balanceOf(bob.address)).to.equal(secondLockAmount)
  })

  it("exposed balanceOf for a specific epoch", async () => {
    /*
        we can also get the balanceOf at a specific epoch, the epoch we provide does
        not count towards it. so its as the epoch we provide is the current epoch
     */
    const firstEpoch = await currentEpoch()

    const firstUnlockTime = firstEpoch + LOCK_DURATION
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)
    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)
    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)
    expect(await locker.balanceOf(bob.address)).to.equal(firstLockAmount.add(secondLockAmount))

    // now we advance to the first unlock time so they are not eligible anymore
    await advanceToTime(firstUnlockTime)
    // we need to generate all the epochs
    await locker.checkpointEpoch()

    // now balanceOf is only the balance of the second deposit
    expect(await locker.balanceOf(bob.address)).to.equal(secondLockAmount)
    // which is the same as
    expect(await locker.balanceAtEpochOf(17, bob.address)).to.equal(secondLockAmount)
    // but an epoch before, both locked amounts are eligible
    expect(await locker.balanceAtEpochOf(16, bob.address)).to.equal(firstLockAmount.add(secondLockAmount))
  })

  it("exposes total locked supply", async () => {
    /*
        the totalSupply should return the total amount of properly locked tokens, meaning
        no expired locks and also not locks of the current epoch. So we create an expired lock, an active
        lock and a lock for the current epoch
     */

    const firstEpoch = await currentEpoch()
    const firstUnlockTime = firstEpoch + LOCK_DURATION

    const expiredLockAmount = bn(100)
    await mintFBeets(bob, expiredLockAmount)
    await fBeets.connect(bob).approve(locker.address, expiredLockAmount)
    await locker.connect(bob).lock(bob.address, expiredLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const activeLockAmount = bn(200)
    await mintFBeets(alice, activeLockAmount)
    await fBeets.connect(alice).approve(locker.address, activeLockAmount)
    await locker.connect(alice).lock(bob.address, activeLockAmount)

    // now we advance to the first unlock time so they are not eligible anymore
    await advanceToTime(firstUnlockTime)

    const currentEpochLockAmount = bn(200)
    await mintFBeets(carol, currentEpochLockAmount)
    await fBeets.connect(carol).approve(locker.address, currentEpochLockAmount)
    await locker.connect(carol).lock(carol.address, currentEpochLockAmount)

    expect(await locker.totalSupply()).to.equal(activeLockAmount)
  })

  it("exposed total locked supply at a specific epoch", async () => {
    /*
        we can also get the total locked supply for a specific epoch index
     */
    const firstEpoch = await currentEpoch()

    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)
    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(alice, secondLockAmount)
    await fBeets.connect(alice).approve(locker.address, secondLockAmount)
    await locker.connect(alice).lock(bob.address, secondLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const thirdLockAmount = bn(200)
    await mintFBeets(carol, thirdLockAmount)
    await fBeets.connect(carol).approve(locker.address, thirdLockAmount)
    await locker.connect(carol).lock(carol.address, thirdLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)
    // fill in next epoch so we can query the total supply for it
    await locker.checkpointEpoch()

    expect(await locker.totalSupplyAtEpoch(0)).to.equal(0)
    expect(await locker.totalSupplyAtEpoch(1)).to.equal(firstLockAmount)
    expect(await locker.totalSupplyAtEpoch(2)).to.equal(firstLockAmount.add(secondLockAmount))
    expect(await locker.totalSupplyAtEpoch(3)).to.equal(firstLockAmount.add(secondLockAmount).add(thirdLockAmount))

    /*
      now we let the first lock expire so the supply at the last epoch should then
      only be the second and third lock amount
     */
    await advanceToTime(firstEpoch + LOCK_DURATION)

    await locker.checkpointEpoch()
    const epochCount = await locker.epochCount()
    expect(await locker.totalSupplyAtEpoch(epochCount.toNumber() - 1)).to.equal(secondLockAmount.add(thirdLockAmount))
  })

  it("finds the matching epoch of a timestamp", async () => {
    // lets create 10 epochs
    const firstEpoch = await currentEpoch()
    await advanceTime(EPOCH_DURATION * 10)

    // fill in 10 epochs plus the next one
    await locker.checkpointEpoch()
    expect(await locker.epochCount()).to.equal(11)

    expect(await locker.findEpochId(firstEpoch + EPOCH_DURATION + EPOCH_DURATION / 2)).to.equal(1)
    // first epoch + 4 epoch durations should be the start of the 5th epoch which means epoch index 4
    expect(await locker.findEpochId(firstEpoch + EPOCH_DURATION * 4)).to.equal(4)

    // first epoch + 6 epochs - 1 second should be the 6th epoch with index 5
    expect(await locker.findEpochId(firstEpoch + EPOCH_DURATION * 6 - 1)).to.equal(5)
  })

  it("returns locking overview of user tokens", async () => {
    /*
        we want an overview of the user tokens in regards to
         - how many tokens are total in there
         - how many tokens are expired and can be unlocked
         - how many tokens are actively locked
         - active locking periods with unlock time and amount
     */

    const firstEpoch = await currentEpoch()

    const firstUnlockTime = firstEpoch + LOCK_DURATION
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)
    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)
    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)

    // now we make both locks expired
    await advanceToTime(firstEpoch + EPOCH_DURATION + LOCK_DURATION)

    // and create 2 more locks which are active
    const thirdLockAmount = bn(300)
    await mintFBeets(bob, thirdLockAmount)
    await fBeets.connect(bob).approve(locker.address, thirdLockAmount)
    await locker.connect(bob).lock(bob.address, thirdLockAmount)

    await advanceTime(EPOCH_DURATION)

    const fourthLockedAmount = bn(400)
    await mintFBeets(bob, fourthLockedAmount)
    await fBeets.connect(bob).approve(locker.address, fourthLockedAmount)
    await locker.connect(bob).lock(bob.address, fourthLockedAmount)

    const lockedBalances = await locker.lockedBalances(bob.address)
    expect(lockedBalances.locked).to.equal(thirdLockAmount.add(fourthLockedAmount))
    expect(lockedBalances.unlockable).to.equal(firstLockAmount.add(secondLockAmount))
    expect(lockedBalances.total).to.equal(firstLockAmount.add(secondLockAmount).add(thirdLockAmount).add(fourthLockedAmount))
    expect(lockedBalances.lockData).to.deep.equal([
      [thirdLockAmount, bn(firstEpoch + EPOCH_DURATION + LOCK_DURATION + LOCK_DURATION, 0)],
      [fourthLockedAmount, bn(firstEpoch + EPOCH_DURATION * 2 + LOCK_DURATION + LOCK_DURATION, 0)],
    ])
  })

  it("allows owner to add reward token with a distributor contract", async () => {
    /*
          we create an entry for each reward token which
           - sets last update time to current time
           - sets the period finish to the current time
           - whitelists the reward distributor
       */
    const rewardToken = await deployERC20Mock("RewardToken", "REW", bn(10_000))
    const transaction = await locker.addReward(rewardToken.address, rewarder.address)
    const blockTime = await getBlockTime(transaction.blockHash!)
    const rewardData = await locker.rewardData(rewardToken.address)
    expect(rewardData.lastUpdateTime).to.equal(blockTime)
    expect(rewardData.periodFinish).to.equal(blockTime)
    // check for whitelisting
    expect(await locker.rewardDistributors(rewardToken.address, rewarder.address)).to.be.true
  })

  it("rejects adding of reward if sender is not owner", async () => {
    const rewardToken = await deployERC20Mock("RewardToken", "REW", bn(10_000))
    await expect(locker.connect(bob).addReward(rewardToken.address, rewarder.address)).to.be.revertedWith("Ownable: caller is not the owner")
  })

  it("rejects if reward token has already been added", async () => {
    const rewardToken = await deployERC20Mock("RewardToken", "REW", bn(10_000))
    await locker.addReward(rewardToken.address, rewarder.address)
    await expect(locker.addReward(rewardToken.address, rewarder.address)).to.be.revertedWith("Reward token already added")
  })

  it("rejects if reward token is the locking token", async () => {
    // the token which will be locked cannot be rewarded
    await expect(locker.addReward(fBeets.address, rewarder.address)).to.be.revertedWith("Rewarding the locking token is not allowed")
  })

  it("allows owner to change whitelisting of reward distributor", async () => {
    /*
        we can black / whitelist reward distributors
     */
    const rewardToken = await deployERC20Mock("RewardToken", "REW", bn(10_000))
    await locker.addReward(rewardToken.address, rewarder.address)
    await locker.approveRewardDistributor(rewardToken.address, rewarder.address, false)
    expect(await locker.rewardDistributors(rewardToken.address, rewarder.address)).to.be.false
    await locker.approveRewardDistributor(rewardToken.address, rewarder.address, true)
    expect(await locker.rewardDistributors(rewardToken.address, rewarder.address)).to.be.true
  })

  it("allows owner to add additional reward distributor for a token", async () => {
    /*
        there can also be multiple reward distributors for the same reward token
     */
    const rewardToken = await deployERC20Mock("RewardToken", "REW", bn(10_000))
    await locker.addReward(rewardToken.address, rewarder.address)
    await locker.approveRewardDistributor(rewardToken.address, anotherRewarder.address, true)
    expect(await locker.rewardDistributors(rewardToken.address, rewarder.address)).to.be.true
    expect(await locker.rewardDistributors(rewardToken.address, anotherRewarder.address)).to.be.true
  })

  it("rejects when changing reward distributor approval of a token which has not been added yet", async () => {
    const rewardToken = await deployERC20Mock("RewardToken", "REW", bn(10_000))
    await expect(locker.approveRewardDistributor(rewardToken.address, anotherRewarder.address, true)).to.be.revertedWith(
      "Reward token has not been added"
    )
  })

  it("allows to kick out expired locks after 4 epochs since lock has expired for a small reward", async () => {
    /*

     */
  })

  function aLockedBalance(lockedAmount: BigNumber, unlockTime: number) {
    return { locked: lockedAmount, unlockTime: bn(unlockTime, 0) }
  }

  async function mintFBeets(user: SignerWithAddress, amount: BigNumber) {
    await bpt.transfer(user.address, amount)
    await bpt.connect(user).approve(fBeets.address, amount)
    await fBeets.connect(user).enter(amount)
  }

  async function currentEpoch() {
    return Math.trunc((await latest()).toNumber() / EPOCH_DURATION) * EPOCH_DURATION
  }
})