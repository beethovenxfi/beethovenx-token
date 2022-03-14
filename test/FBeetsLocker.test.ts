import { expect } from "chai"
import {
  advanceBlock,
  advanceBlocks,
  advanceTime,
  advanceTimeAndBlock,
  advanceToTime,
  bn,
  deployContract,
  deployERC20Mock,
  getBlockTime,
  latest,
  setAutomineBlocks,
} from "./utilities"
import { ethers } from "hardhat"
import { BeetsBar, ERC20Mock, FBeetsLocker } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"

describe("fBeets locking contract", function () {
  const DENOMINATOR = 10000
  const EPOCH_DURATION = 86400 * 7
  const LOCK_DURATION = EPOCH_DURATION * 16

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
    bpt = await deployERC20Mock("BEETS_FTM", "BPT", 10000)
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
    expect(await locker.name()).to.eq("Locked fBeets Token")
    expect(await locker.symbol()).to.eq("lfBeets")
    expect(await locker.decimals()).to.eq(18)

    const actualFirstEpoch = await locker.epochs(0)
    expect(actualFirstEpoch.supply.toNumber()).to.eq(0)
    expect(actualFirstEpoch.startTime.toNumber()).to.eq(expectedFirstEpoch)
  })

  it("does not allow setting an lock duration which is not a multiple of the epoch duration", async () => {
    await expect(deployContract<FBeetsLocker>("FBeetsLocker", [fBeets.address, EPOCH_DURATION, EPOCH_DURATION * 1.5])).to.be.revertedWith(
      "_epochDuration has to be a multiple of _lockDuration"
    )
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

    // we advance 2 weeks
    await advanceTimeAndBlock(2 * oneWeekInSeconds)

    /*
        after contract creation it created the current epoch (at deploy time),
        now we are 2 weeks ahead, meaning that last, current and next epoch should be missing
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
    expect(actualThirdEpoch.supply).to.equal(0)

    const actualFourthEpoch = await locker.epochs(3)
    expect(actualFourthEpoch.startTime).to.equal(startEpoch + 3 * oneWeekInSeconds)
    expect(actualFourthEpoch.supply).to.equal(lockAmount)
  })

  it("locks token from start of next epoch for 16 weeks", async () => {
    /*
        tokens get locked from the start of the next epoch for 16 weeks. this means if you enter at wednesday,
        which is the last day of the epoch, your tokens will be locked for 16 weeks + 1day. Therefore, if you lock your tokens on
        a thursday at 12:00 UTC, your total lock time will be 16 weeks + 12 hours.

        We expect
          - locked amount is transferred from user to contract
          - the locked amount is added to the users total balance
          - the locked amount is added to the user locking period (start of next epoch + total lock duration)
          - locked amount is added to the next epoch
          - locked amount is added to global locked amount
          - emits Locked event with locked amount for user address
     */

    const expectedLockedAmount = bn(100)
    await mintFBeets(bob, expectedLockedAmount)

    // we lock those fBeets up!
    await fBeets.connect(bob).approve(locker.address, expectedLockedAmount)

    const lockingEpoch = (await currentEpoch()) + EPOCH_DURATION

    await expect(locker.connect(bob).lock(bob.address, expectedLockedAmount))
      .to.emit(locker, "Locked")
      .withArgs(bob.address, expectedLockedAmount, lockingEpoch)

    // check if tokens have been transferred
    expect(await fBeets.balanceOf(bob.address)).to.equal(0)
    expect(await fBeets.balanceOf(locker.address)).to.equal(expectedLockedAmount)

    expect(await locker.totalLockedSupply()).to.equal(expectedLockedAmount)

    const userBalance = await locker.balances(bob.address)
    expect(userBalance.lockedAmount).to.equal(expectedLockedAmount)

    // amount should be locked in the second epoch where epoch 0 is the current epoch and epoch 1 is the next
    const epoch = await locker.epochs(1)

    expect(epoch.startTime).to.equal(lockingEpoch)
    expect(epoch.supply).to.equal(expectedLockedAmount)

    /*
        for each lock period, which lasts from the start of the next epoch + 16 weeks, an entry
        is created with the unlock time and the amount of tokens locked in this period
     */

    const userLock = await locker.userLocks(bob.address, 0)
    expect(userLock.locked).to.equal(expectedLockedAmount)
    expect(userLock.unlockTime).to.equal(lockingEpoch + LOCK_DURATION)
  })

  it("adds locked amount to same user lock period when locking multiple times within the same epoch", async () => {
    /*
        locks added within the same epoch will be added to the same locking period.

        ATTENTION: this test may fail when time passes to new epoch between 2 lock calls
     */
    const firstEpoch = (await currentEpoch()) + EPOCH_DURATION
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)

    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceBlocks(20)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)

    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)

    const expectedUnlockTime = firstEpoch + LOCK_DURATION
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
    await expect(locker.connect(bob).processExpiredLocks(false)).to.revertedWith("No expired locks present")
  })
  it("reverts if the user has no locks", async () => {
    await expect(locker.connect(bob).processExpiredLocks(false)).to.revertedWith("Account has no locks")
  })

  it("withdraws all expired locks to specified account", async () => {
    /*
        we should be able to withdraw all expired locks where unlock time has passed
     */
    const firstEpoch = (await currentEpoch()) + EPOCH_DURATION
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
    await expect(locker.connect(bob).processExpiredLocks(false)).to.emit(locker, "Withdrawn").withArgs(bob.address, firstLockAmount, false)

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
    await expect(locker.connect(bob).withdrawExpiredLocksTo(alice.address))
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

  it("allows to relock expired locks for the current epoch", async () => {
    /*
        when relocking, you can relock for the current epoch thus avoiding waiting for the new epoch
     */
    const firstEpoch = (await currentEpoch()) + EPOCH_DURATION
    /*
        expired locks can also be relocked instead of withdrawn
     */
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
    // second lock will be in the 3rd epoch
    const secondUnlockTime = firstEpoch + EPOCH_DURATION + LOCK_DURATION

    await advanceToTime(firstUnlockTime)

    /*
       we trigger relocking which should also emit the Withdrawn event and then emit again the Lock
       event
     */
    await expect(locker.connect(bob).processExpiredLocks(true))
      .to.emit(locker, "Withdrawn")
      .withArgs(bob.address, firstLockAmount, true)
      .to.emit(locker, "Locked")
      .withArgs(bob.address, firstLockAmount, firstUnlockTime)

    // now a third user lock with the relocked amount should have been created

    const bobsThirdLock = await locker.userLocks(bob.address, 2)

    expect(bobsThirdLock.locked).to.equal(firstLockAmount)
    expect(bobsThirdLock.unlockTime).to.equal(firstEpoch + LOCK_DURATION + LOCK_DURATION)
    // total supply & user balance should still be the full amount
    expect(await locker.totalLockedSupply()).to.equal(firstLockAmount.add(secondLockAmount))
    const bobsBalanceAfterFirstRelock = await locker.balances(bob.address)
    expect(bobsBalanceAfterFirstRelock.lockedAmount).to.equal(firstLockAmount.add(secondLockAmount))
    // the first user lock (index 0) has been processed, so the next unlock index to check would be index 1
    expect(bobsBalanceAfterFirstRelock.nextUnlockIndex).to.equal(1)

    // now advance to unlock time of second lock period
    await advanceToTime(secondUnlockTime)

    // we trigger unlocking again
    await expect(locker.connect(bob).processExpiredLocks(true))
      .to.emit(locker, "Withdrawn")
      .withArgs(bob.address, secondLockAmount, true)
      .to.emit(locker, "Locked")
      .withArgs(bob.address, secondLockAmount, secondUnlockTime)

    // now a first user lock with the relocked amount should have been created for alice
    const bobsFourthLock = await locker.userLocks(bob.address, 3)

    expect(bobsFourthLock.locked).to.equal(secondLockAmount)
    expect(bobsFourthLock.unlockTime).to.equal(firstEpoch + EPOCH_DURATION + LOCK_DURATION + LOCK_DURATION)
    // total supply & user balance should still be the full amount
    expect(await locker.totalLockedSupply()).to.equal(firstLockAmount.add(secondLockAmount))

    // bob  should still have the amount of both locks
    const bobsBalanceAfterSecondRelock = await locker.balances(bob.address)
    expect(bobsBalanceAfterSecondRelock.lockedAmount).to.equal(firstLockAmount.add(secondLockAmount))
    // both locks have been processed, so next one to check would be index 2
    expect(bobsBalanceAfterSecondRelock.nextUnlockIndex).to.equal(2)
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
    await locker.connect(bob).processExpiredLocks(false)
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

  it("includes all locked tokens which are not expired or in the future balanceOf", async () => {
    /*
        the `balanceOf(user)` call includes all locked tokens which are not expired

         we create the following setup:
          - 1 lock expired
          - 1 lock from previous epoch (eligible)
          - 1 new lock which will be in the next (future epoch)
          - 1 relocked

     */

    const firstUnlockTime = (await currentEpoch()) + EPOCH_DURATION + LOCK_DURATION
    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)
    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)
    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)

    // now we advance to the first unlock time and relock them

    // now we advance to the second unlock time
    await advanceToTime(firstUnlockTime, true)

    // the first lock is now not eligible anymore
    expect(await locker.balanceOf(bob.address)).to.equal(secondLockAmount)
    // now we relock them which should make them eligible again immediately
    await locker.connect(bob).processExpiredLocks(true)
    expect(await locker.balanceOf(bob.address)).to.equal(firstLockAmount.add(secondLockAmount))

    // now we expire the second lock
    await advanceToTime(firstUnlockTime + EPOCH_DURATION)

    // we lock more beets in this epoch which should not be eligible
    const thirdLockAmount = bn(300)
    await mintFBeets(bob, thirdLockAmount)
    await fBeets.connect(bob).approve(locker.address, thirdLockAmount)
    await locker.connect(bob).lock(bob.address, thirdLockAmount)

    expect(await locker.balanceOf(bob.address)).to.equal(firstLockAmount)
  })

  it("returns balanceOf for a specific epoch", async () => {
    /*
        we can also get the balanceOf at a specific epoch, the epoch we provide does
        not count towards it. so its as the epoch we provide is the current epoch
     */
    const firstEpoch = (await currentEpoch()) + EPOCH_DURATION

    // if there are no locks, it should return 0
    expect(await locker.balanceAtEpochOf(0, bob.address)).to.equal(0)

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

  it("returns total locked supply", async () => {
    /*
        the totalSupply should return the total amount of properly locked tokens, meaning
        no expired locks and also not locks of a future epoch. So we create an expired lock, an active
        lock and a lock for the next epoch
     */

    const firstEpoch = (await currentEpoch()) + EPOCH_DURATION
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

    const currentEpochLockAmount = bn(400)
    await mintFBeets(carol, currentEpochLockAmount)
    await fBeets.connect(carol).approve(locker.address, currentEpochLockAmount)
    await locker.connect(carol).lock(carol.address, currentEpochLockAmount)

    expect(await locker.totalSupply()).to.equal(activeLockAmount)
  })

  it("returns a total supply of 0 for the first epoch", async () => {
    // since the current epoch doesnt count, total supply has to be 0
    const lockAmount = bn(100)
    await mintFBeets(bob, lockAmount)
    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)

    expect(await locker.totalSupply()).to.equal(0)
  })

  it("exposed total locked supply at a specific epoch", async () => {
    /*
        we can also get the total locked supply for a specific epoch index
     */
    const firstEpoch = (await currentEpoch()) + EPOCH_DURATION

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

    const thirdLockAmount = bn(300)
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
    // the last epoch is the upcoming next epoch, so we need the 2nd last epoch
    expect(await locker.totalSupplyAtEpoch(epochCount.toNumber() - 2)).to.equal(secondLockAmount.add(thirdLockAmount))
  })

  it("returns the total locked token supply of a user", async () => {
    /*
         we can get the total locked tokens of a user in the contract including expired tokens
         and the tokens of the current epoch
     */

    const lockAmount = bn(100)
    await mintFBeets(bob, lockAmount)
    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)

    expect(await locker.lockedBalanceOf(bob.address)).to.equal(lockAmount)
  })

  it("finds the matching epoch of a timestamp", async () => {
    // lets create 10 epochs
    const firstEpoch = await currentEpoch()
    // so we need 9 more epochs
    await advanceTime(EPOCH_DURATION * 9)

    // fill in 10 epochs plus the next upcoming one
    await locker.checkpointEpoch()
    expect(await locker.epochCount()).to.equal(11)

    expect(await locker.findEpochId(firstEpoch)).to.equal(0)

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

    const firstEpoch = (await currentEpoch()) + EPOCH_DURATION

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
    const secondLockUnlockTime = firstEpoch + EPOCH_DURATION + EPOCH_DURATION + LOCK_DURATION
    await advanceToTime(secondLockUnlockTime)

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
      [thirdLockAmount, bn(secondLockUnlockTime + EPOCH_DURATION + LOCK_DURATION, 0)],
      [fourthLockedAmount, bn(secondLockUnlockTime + EPOCH_DURATION * 2 + LOCK_DURATION, 0)],
    ])
  })

  it("returns pending upcoming locks in the next epoch", async () => {
    // new locks get added to the next epoch, we want to be able to get the amount of those
    const firstEpoch = (await currentEpoch()) + EPOCH_DURATION

    const firstLockAmount = bn(100)
    await mintFBeets(bob, firstLockAmount)
    await fBeets.connect(bob).approve(locker.address, firstLockAmount)
    await locker.connect(bob).lock(bob.address, firstLockAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    const secondLockAmount = bn(200)
    await mintFBeets(bob, secondLockAmount)
    await fBeets.connect(bob).approve(locker.address, secondLockAmount)
    await locker.connect(bob).lock(bob.address, secondLockAmount)

    // now the pending locks should be the second lock
    expect(await locker.pendingLockOf(bob.address)).to.equal(secondLockAmount)
  })

  it("allows owner to add reward token with a distributor contract", async () => {
    /*
          we create an entry for each reward token which
           - sets last update time to current time
           - sets the period finish to the current time
           - whitelists the reward distributor
       */
    const rewardToken = await deployERC20Mock("RewardToken", "REW", 10_000)
    const transaction = await locker.addReward(rewardToken.address, rewarder.address)
    const blockTime = await getBlockTime(transaction.blockHash!)
    const rewardData = await locker.rewardData(rewardToken.address)
    expect(rewardData.lastUpdateTime).to.equal(blockTime)
    expect(rewardData.periodFinish).to.equal(blockTime)
    // check for whitelisting
    expect(await locker.rewardDistributors(rewardToken.address, rewarder.address)).to.be.true
  })

  it("rejects adding of reward if sender is not owner", async () => {
    const rewardToken = await deployERC20Mock("RewardToken", "REW", 10_000)
    await expect(locker.connect(bob).addReward(rewardToken.address, rewarder.address)).to.be.revertedWith("Ownable: caller is not the owner")
  })

  it("rejects if reward token has already been added", async () => {
    const rewardToken = await deployERC20Mock("RewardToken", "REW", 10_000)
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
    const rewardToken = await deployERC20Mock("RewardToken", "REW", 10_000)
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
    const rewardToken = await deployERC20Mock("RewardToken", "REW", 10_000)
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

  it("initializes the reward data correctly on first reward distribution", async () => {
    /*

        We expect
         - updates the reward rate to amount / epoch since its the first reward
         - updates last updated & reward period finish timestamp to block time + epoch duration
         - sets the reward per token to 0
     */
    const { rewardToken } = await aRewardToken()
    const rewardAmount = bn(100)
    await locker.addReward(rewardToken.address, rewarder.address)
    await rewardToken.connect(rewarder).approve(locker.address, rewardAmount)

    const tx = await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, rewardAmount)
    const blockTime = await getBlockTime(tx.blockHash!)

    const rewardData = await locker.rewardData(rewardToken.address)
    expect(rewardData.lastUpdateTime).to.equal(blockTime)
    expect(rewardData.periodFinish).to.equal(blockTime.add(EPOCH_DURATION))
    expect(rewardData.rewardRate).to.equal(rewardAmount.div(EPOCH_DURATION))
    expect(rewardData.rewardPerTokenStored).to.equal(0)
    expect(await rewardToken.balanceOf(locker.address)).to.equal(rewardAmount)
  })

  it("transfer funds on reward distribution to locker contract", async () => {
    const { rewardToken, totalSupply } = await aRewardToken()
    const rewardAmount = bn(100)
    await locker.addReward(rewardToken.address, rewarder.address)
    await rewardToken.connect(rewarder).approve(locker.address, rewardAmount)
    await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, rewardAmount)
    expect(await rewardToken.balanceOf(locker.address)).to.equal(rewardAmount)
    expect(await rewardToken.balanceOf(rewarder.address)).to.equal(totalSupply.sub(rewardAmount))
  })

  it("emits event when rewards are added", async () => {
    const { rewardToken, totalSupply } = await aRewardToken()
    const rewardAmount = bn(100)
    await locker.addReward(rewardToken.address, rewarder.address)
    await rewardToken.connect(rewarder).approve(locker.address, rewardAmount)

    // we have to make the timestamp of the next block predictable so we know the end period of the reward.
    // therefore  we advance 5 seconds from the latest block
    const latestBlockTime = await latest()
    const nextBlockTimestamp = latestBlockTime.toNumber() + 5
    await advanceToTime(nextBlockTimestamp)

    await expect(locker.connect(rewarder).notifyRewardAmount(rewardToken.address, rewardAmount))
      .to.emit(locker, "RewardAdded")
      .withArgs(rewardToken.address, rewardAmount, rewardAmount.div(EPOCH_DURATION), nextBlockTimestamp + EPOCH_DURATION)
  })

  it("adjusts the reward data accordingly in case of multiple reward distributions in the same reward period", async () => {
    /*
        in case a rewarder distributes multiple times before the reward period has finished, we expect it
          - to extend the reward period for another epoch duration
          - to adjust the reward rate according to the remaining amount + new reward amount
          - updates the reward per token until the current timestamp for the previous reward rate
     */

    // first we need to lock some fBeets so the reward per token is calculated
    const lockAmount = bn(200)
    await mintFBeets(bob, lockAmount)
    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)
    // now prepare the rewards
    const { rewardToken } = await aRewardToken()
    const firstRewardAmount = bn(100)
    const secondRewardAmount = bn(100)
    const totalRewardAmount = firstRewardAmount.add(secondRewardAmount)

    await locker.addReward(rewardToken.address, rewarder.address)

    await rewardToken.connect(rewarder).approve(locker.address, totalRewardAmount)
    const firstDistributionTx = await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, firstRewardAmount)
    const firstDistributionBlockTime = await getBlockTime(firstDistributionTx.blockHash!)

    // now we advance for half an epoch
    await advanceTime(EPOCH_DURATION / 2)
    const secondDistributionTx = await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, secondRewardAmount)
    const secondDistributionBlockTime = await getBlockTime(secondDistributionTx.blockHash!)

    /*
      now we expect
       - last updated time the block time of second reward
       - reward end period to be block time of second reward + epoch duration
       - reward rate: (remaining rewards + second rewards) / epoch duration
       - reward per token updated with first distribution reward rate until second distribution time
     */

    const remainingRewardsOfFirstDistribution = firstDistributionBlockTime
      .add(EPOCH_DURATION)
      .sub(secondDistributionBlockTime)
      .mul(firstRewardAmount.div(EPOCH_DURATION))
    const expectedRewardRateAfterSecondDistribution = remainingRewardsOfFirstDistribution.add(secondRewardAmount).div(EPOCH_DURATION)

    const rewardData = await locker.rewardData(rewardToken.address)
    expect(rewardData.lastUpdateTime).to.equal(secondDistributionBlockTime)
    expect(rewardData.periodFinish).to.equal(secondDistributionBlockTime.add(EPOCH_DURATION))
    expect(rewardData.rewardRate).to.equal(expectedRewardRateAfterSecondDistribution)

    expect(rewardData.rewardPerTokenStored).to.equal(
      firstRewardAmount
        .div(EPOCH_DURATION)
        .mul(EPOCH_DURATION / 2)
        .mul(bn(1))
        .div(lockAmount)
    )
  })

  it("distributes rewards to users according to their total balance", async () => {
    /*
      tokens are distributed according to the total balance of locked tokens. also expired and tokens of the current
      epoch count towards it in contrary to the voting (balanceOf).

      Our test scenario will be that bob enters first with some amount, then after an epoch, alice enters with the
      same amount and finally bob enters again with some more.
     */
    const bobTotalAmount = bn(400)
    const bobFirstLockAmount = bobTotalAmount.div(2)
    const bobSecondLockAmount = bobTotalAmount.div(2)
    await mintFBeets(bob, bobTotalAmount)
    await fBeets.connect(bob).approve(locker.address, bobTotalAmount)
    await locker.connect(bob).lock(bob.address, bobFirstLockAmount)

    const aliceLockAmount = bn(200)
    await mintFBeets(alice, aliceLockAmount)
    await fBeets.connect(alice).approve(locker.address, aliceLockAmount)
    // now prepare the rewards
    const { rewardToken } = await aRewardToken()
    const firstRewardAmount = bn(100)
    const secondRewardAmount = bn(100)
    const totalRewardAmount = firstRewardAmount.add(secondRewardAmount)

    await locker.addReward(rewardToken.address, rewarder.address)

    await rewardToken.connect(rewarder).approve(locker.address, totalRewardAmount)
    const firstDistributionTx = await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, firstRewardAmount)
    const firstDistributionBlockTime = await getBlockTime(firstDistributionTx.blockHash!)

    await advanceTime(EPOCH_DURATION / 4)

    // now alice enters the game
    const tx = await locker.connect(alice).lock(alice.address, aliceLockAmount)
    const aliceEnteringBlockTime = await getBlockTime(tx.blockHash!)

    // now lets figure out the claimable rewards for bob until the lock of alice
    const firstRewardDuration = aliceEnteringBlockTime.sub(firstDistributionBlockTime)
    const rewardDataFirstDistribution = await locker.rewardData(rewardToken.address)
    const firstRewardRate = rewardDataFirstDistribution.rewardRate
    const bobRewardsUntilAliceLock = await locker.claimableRewards(bob.address)
    expect(bobRewardsUntilAliceLock[0].token).to.equal(rewardToken.address)
    expect(bobRewardsUntilAliceLock[0].amount).to.equal(firstRewardDuration.mul(firstRewardRate))

    await advanceTime(EPOCH_DURATION / 4)

    // now we add some more rewards
    const secondDistributionTx = await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, secondRewardAmount)
    const secondDistributionBlockTime = await getBlockTime(secondDistributionTx.blockHash!)

    await advanceTime(EPOCH_DURATION / 4)

    // now bob locks more
    const bobSecondLockTx = await locker.connect(bob).lock(bob.address, bobSecondLockAmount)
    const bobSecondLockBlockTime = await getBlockTime(bobSecondLockTx.blockHash!)

    await advanceTime(EPOCH_DURATION / 4)
    // we want to get rewards on same block for bob & alice to make calculations easier
    await setAutomineBlocks(false)
    await locker.connect(bob).getReward()
    await locker.connect(alice).getReward()
    await advanceBlock()
    await setAutomineBlocks(true)
    const getRewardBlockTime = await latest()
    /*
        so now lets try to wrap our head around what alice and bob should have. Bob gets the full reward rate
        until alice locks the same amount. from alices' lock until second reward distribution, both get half of the
        reward rate. After the second reward distribution, both still get half of the reward rate, but the reward
        reate has increased. After the second lock of bob, alice only gets 1/3 of the reward rate

        bob:
          (lockOfAliceTs - firstRewardTs) * firstRewardRate +
            (secondRewardTs - lockOfAliceTs) * (firstRewardRate / 2) +
              (secondLockOfBobTs - secondRewardTs) * (secondRewardRate / 2) +
                (getRewardTs - secondLockOfBobTs) * (secondRewardRate * 2/3)

        => 151200 * 165343915343915 + 151200 * 165343915343915/2 + 151200 * 248015873015872 /2 + 151200 * 248015873015872 * 2/3

       alice:
          (secondRewardTs - lockOfAliceTs) * (firstRewardRate /2) +
            (secondLockOfBobTs - secondRewardTs) * (secondRewardRate / 2) +
              (getRewardTs - secondLockOfBobTs) * (secondRewardRate / 3)
     */

    const rewardDataSecondDistribution = await locker.rewardData(rewardToken.address)
    const secondRewardRate = rewardDataSecondDistribution.rewardRate

    const firstPeriod = aliceEnteringBlockTime.sub(firstDistributionBlockTime)
    const secondPeriod = secondDistributionBlockTime.sub(aliceEnteringBlockTime)
    const thirdPeriod = bobSecondLockBlockTime.sub(secondDistributionBlockTime)
    const fourthPeriod = getRewardBlockTime.sub(bobSecondLockBlockTime)

    const expectedBobAmount = firstPeriod
      .mul(firstRewardRate)
      .add(secondPeriod.mul(firstRewardRate).mul(bn(1)).div(2).div(bn(1)))
      .add(thirdPeriod.mul(secondRewardRate).mul(bn(1)).div(2).div(bn(1)))
      .add(fourthPeriod.mul(secondRewardRate).mul(bn(1)).div(3).mul(2).div(bn(1)))

    const expectedAliceAmount = secondPeriod
      .mul(firstRewardRate)
      .mul(bn(1))
      .div(2)
      .div(bn(1))
      .add(thirdPeriod.mul(secondRewardRate).mul(bn(1)).div(2).div(bn(1)))
      .add(fourthPeriod.mul(secondRewardRate).mul(bn(1)).div(3).div(bn(1)))

    console.log([firstPeriod.toString(), secondPeriod.toString(), thirdPeriod.toString(), fourthPeriod.toString()])
    // ATTENTION: this test fails some times when the periods are not exactly EPOCH / 4 = (151200) cause of rounding errors
    expect(await rewardToken.balanceOf(bob.address)).to.equal(expectedBobAmount)
    expect(await rewardToken.balanceOf(alice.address)).to.equal(expectedAliceAmount)
  })

  it("emits event when reward was payed", async () => {
    const lockAmount = bn(200)
    await mintFBeets(bob, lockAmount)
    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)
    // now prepare the rewards
    const { rewardToken } = await aRewardToken()
    const rewardAmount = bn(100)

    await locker.addReward(rewardToken.address, rewarder.address)

    await rewardToken.connect(rewarder).approve(locker.address, rewardAmount)
    await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, rewardAmount)

    await advanceTime(EPOCH_DURATION)

    await expect(locker.connect(bob).getReward())
      .to.emit(locker, "RewardPaid")
      .withArgs(bob.address, rewardToken.address, rewardAmount.div(EPOCH_DURATION).mul(EPOCH_DURATION))
  })

  it("returns reward per locked token for a specific reward token", async () => {
    /*
      we can get the rewards you get for the current reward period for a reward token per token locked
     */
    const lockAmount = bn(200)
    await mintFBeets(bob, lockAmount)
    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)
    // now prepare the rewards
    const { rewardToken } = await aRewardToken()
    const rewardAmount = bn(100)

    await locker.addReward(rewardToken.address, rewarder.address)

    await rewardToken.connect(rewarder).approve(locker.address, rewardAmount)
    await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, rewardAmount)

    await advanceTime(EPOCH_DURATION / 2)
    /*
        we have a total locked amount of `lockedAmount` tokens and a distribution
        time of half an epoch. therefore the reward per token should be
        epoch duration / 2 *  reward rate / total locked supply
     */
    const expectedRewardPerToken = bn(EPOCH_DURATION, 0).div(2).mul(rewardAmount.div(EPOCH_DURATION)).div(lockAmount)
    expect(await locker.rewardPerToken(rewardToken.address)).to.equal(expectedRewardPerToken)
  })

  it("returns last reward time per reward token", async () => {
    /*
        rewards are always distributed during an epoch from the time of distribution. so the last reward time
        for a token is the lesser of either the current block time or the finish of the reward period
     */
    const { rewardToken } = await aRewardToken()
    const rewardAmount = bn(100)

    await locker.addReward(rewardToken.address, rewarder.address)

    await rewardToken.connect(rewarder).approve(locker.address, rewardAmount)
    const rewardTx = await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, rewardAmount)
    const rewardBlockTime = await getBlockTime(rewardTx.blockHash!)

    await advanceTimeAndBlock(EPOCH_DURATION / 2)

    // the last reward  time should now be the reward block time + half an epoch

    expect(await locker.lastTimeRewardApplicable(rewardToken.address)).to.equal(rewardBlockTime.add(EPOCH_DURATION / 2))

    await advanceTimeAndBlock(EPOCH_DURATION)

    // now we passed the end of the reward period, so the last reward time should be the reward block time + epoch duration
    expect(await locker.lastTimeRewardApplicable(rewardToken.address)).to.equal(rewardBlockTime.add(EPOCH_DURATION))
  })

  it("allows to kick out expired locks after 4 epochs since lock has expired for a small reward", async () => {
    /*
        because rewards are distributed based on the total tokens in the contract independent of their locking
        state (expired / current epoch) due to the issue that its hard to find the total supply of the 'eligible'
        tokens, there is a mechanism to incentivize others to kick out locks that are expired for more than
        defined epochs. There is a kick incentive which scales linear with the amount of epochs the lock is overdue.
     */

    const lockAmount = bn(200)
    await mintFBeets(bob, lockAmount)
    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)

    // now we advance by lock duration + kick delay
    const kickEpochDelay = await locker.kickRewardEpochDelay()
    await advanceTime(EPOCH_DURATION + LOCK_DURATION + EPOCH_DURATION * kickEpochDelay.toNumber())

    // now we should be able to kick bob out with an incentive of 1 epoch overdue
    await locker.connect(alice).kickExpiredLocks(bob.address)

    const kickRewardPerEpoch = await locker.kickRewardPerEpoch()
    const kickRewardDenominator = await locker.denominator()

    // so the reward is lockAmount * epochs overdue * kick reward per epoch / kick reward denominator
    const rewardAfter1Epoch = lockAmount.mul(1).mul(kickRewardPerEpoch).div(kickRewardDenominator)

    expect(await fBeets.balanceOf(bob.address)).to.equal(lockAmount.sub(rewardAfter1Epoch))
    expect(await fBeets.balanceOf(alice.address)).to.equal(rewardAfter1Epoch)

    // now lets see if it also works with 2 epochs overdue

    const carolFirstLockAmount = bn(200)
    await mintFBeets(carol, carolFirstLockAmount)
    await fBeets.connect(carol).approve(locker.address, carolFirstLockAmount)
    await locker.connect(carol).lock(carol.address, carolFirstLockAmount)

    await advanceTime(EPOCH_DURATION)
    // and one with 1 epochs overdue
    const carolSecondLockAmount = bn(400)
    await mintFBeets(carol, carolSecondLockAmount)
    await fBeets.connect(carol).approve(locker.address, carolSecondLockAmount)
    await locker.connect(carol).lock(carol.address, carolSecondLockAmount)

    await advanceTime(EPOCH_DURATION + LOCK_DURATION + EPOCH_DURATION * kickEpochDelay.toNumber())

    // we create another lock which is still good
    const thirdLockAmount = bn(100)
    await mintFBeets(carol, thirdLockAmount)
    await fBeets.connect(carol).approve(locker.address, thirdLockAmount)
    await locker.connect(carol).lock(carol.address, thirdLockAmount)

    /*
      now we should be able to kick alice out with an incentive of 2 epochs for first lock amount
      and 1 epoch for second lock amount
    */
    await locker.connect(alice).kickExpiredLocks(carol.address)
    // so the reward is lockAmount * epochs overdue * kick reward per epoch / kick reward denominator
    const rewardAlice = carolFirstLockAmount
      .mul(2)
      .mul(kickRewardPerEpoch)
      .div(kickRewardDenominator)
      .add(carolSecondLockAmount.mul(1).mul(kickRewardPerEpoch).div(kickRewardDenominator))

    expect(await fBeets.balanceOf(carol.address)).to.equal(carolFirstLockAmount.add(carolSecondLockAmount).sub(rewardAlice))
    expect(await fBeets.balanceOf(alice.address)).to.equal(rewardAfter1Epoch.add(rewardAlice))
  })

  it("allows owner to recover erc20 tokens on contract which are not reward tokens", async () => {
    /*
        there is an emergency hook to recover erc20 tokens which are not part of the rewards
     */

    const someErc20 = await deployERC20Mock("Some token", "ST", 200)
    const erc20Amount = bn(200)

    await someErc20.transfer(locker.address, erc20Amount)

    await expect(locker.recoverERC20(someErc20.address, erc20Amount)).to.emit(locker, "Recovered").withArgs(someErc20.address, erc20Amount)
    expect(await someErc20.balanceOf(owner.address)).to.equal(erc20Amount)
  })

  it("reverts when trying to withdraw a reward token", async () => {
    const { rewardToken } = await aRewardToken()
    const rewardAmount = bn(100)

    await locker.addReward(rewardToken.address, rewarder.address)

    await rewardToken.connect(rewarder).approve(locker.address, rewardAmount)
    await locker.connect(rewarder).notifyRewardAmount(rewardToken.address, rewardAmount)

    await expect(locker.recoverERC20(rewardToken.address, rewardAmount)).to.be.revertedWith("Cannot withdraw reward token")
  })

  it("reverts when trying to withdraw the locking token", async () => {
    const lockAmount = bn(100)
    await mintFBeets(bob, lockAmount)
    await fBeets.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)
    await expect(locker.recoverERC20(fBeets.address, lockAmount)).to.be.revertedWith("Cannot withdraw locking token")
  })

  async function aRewardToken(tokenRewarder: SignerWithAddress = rewarder, supply: number = 10_000) {
    const rewardToken = await deployERC20Mock("RewardToken", "REW", supply)
    await rewardToken.connect(owner).transfer(rewarder.address, bn(supply))

    return { rewardToken, totalSupply: bn(supply) }
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
