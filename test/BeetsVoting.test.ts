import { advanceTime, advanceTimeAndBlock, bn, deployContract, deployERC20Mock, duration } from "./utilities"
import { ethers } from "hardhat"
import { BeetsVoting, ERC20Mock, FBeetsLocker } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber } from "ethers"

describe("BeetsVoting", function () {
  const EPOCH_DURATION = 86400 * 7
  const LOCK_DURATION = EPOCH_DURATION * 17

  let bpt: ERC20Mock
  let fBeets: ERC20Mock
  let locker: FBeetsLocker
  let owner: SignerWithAddress
  let jerry: SignerWithAddress
  let tim: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    jerry = signers[1]
    tim = signers[2]
    alice = signers[3]
    bob = signers[4]
    carol = signers[5]
  })

  beforeEach(async function () {
    bpt = await deployERC20Mock("BEETS_FTM", "BPT", 10000)
    fBeets = await deployERC20Mock("fBeets", "fBeets", 10_000)
    locker = await deployContract<FBeetsLocker>("FBeetsLocker", [fBeets.address, EPOCH_DURATION, LOCK_DURATION])
  })

  it("sets correct initial state", async () => {
    const minDelegationDuration = duration.days("7")
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, minDelegationDuration])

    expect(await voter.minDelegationDuration()).to.equal(minDelegationDuration)
    expect(await voter.locker()).to.equal(locker.address)
  })

  it("returns balance of user with no vote delegation", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])

    const bobAmount = bn(100)
    const aliceAmount = bn(50)
    await lockfBeets(bob, bobAmount)
    await lockfBeets(alice, aliceAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    expect(await voter.balanceOf(bob.address)).to.equal(bobAmount)
    expect(await voter.balanceOf(alice.address)).to.equal(aliceAmount)
  })

  it("returns balance of user plus delegated votes", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])

    const bobAmount = bn(100)
    const aliceAmount = bn(50)
    const carolAmount = bn(50)
    await lockfBeets(bob, bobAmount)
    await lockfBeets(alice, aliceAmount)
    await lockfBeets(carol, carolAmount)
    await lockfBeets(jerry, bn(100))

    // we delegate 2 addresses to bob
    await voter.connect(alice).setDelegate(bob.address)
    await voter.connect(carol).setDelegate(bob.address)

    await advanceTimeAndBlock(EPOCH_DURATION)

    expect(await voter.balanceOf(bob.address)).to.equal(bobAmount.add(aliceAmount).add(carolAmount))
  })

  it("returns 0 voting power if vote is delegated", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])

    const bobAmount = bn(100)
    const aliceAmount = bn(50)
    await lockfBeets(bob, bobAmount)
    await lockfBeets(alice, aliceAmount)

    await voter.connect(alice).setDelegate(bob.address)

    await advanceTimeAndBlock(EPOCH_DURATION)

    // since we delegate the votes of alice, her balance should be 0
    expect(await voter.balanceOf(alice.address)).to.equal(0)
  })

  it("applies votes to new delegate when changed", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])

    const bobAmount = bn(100)
    const aliceAmount = bn(50)
    const carolAmount = bn(50)
    await lockfBeets(bob, bobAmount)
    await lockfBeets(alice, aliceAmount)
    await lockfBeets(carol, carolAmount)

    // first, alice delegates to bob
    await voter.connect(alice).setDelegate(bob.address)

    await advanceTimeAndBlock(EPOCH_DURATION)

    expect(await voter.balanceOf(bob.address)).to.equal(bobAmount.add(aliceAmount))
    expect(await voter.balanceOf(carol.address)).to.equal(carolAmount)

    // now we chagne the delegate to carol
    await voter.connect(alice).setDelegate(carol.address)

    // so bob should only have his votes and alice should have hers + carols
    expect(await voter.balanceOf(bob.address)).to.equal(bobAmount)
    expect(await voter.balanceOf(carol.address)).to.equal(carolAmount.add(aliceAmount))
    expect(await voter.balanceOf(alice.address)).to.equal(0)
  })

  it("rejects re-delegation if minimum delegation duration has not passed", async () => {
    const minDelegationDuration = duration.days("7")
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, minDelegationDuration])

    const bobAmount = bn(100)
    const aliceAmount = bn(50)

    await lockfBeets(bob, bobAmount)
    await lockfBeets(alice, aliceAmount)

    await advanceTime(EPOCH_DURATION)
    await voter.connect(alice).setDelegate(bob.address)

    // we only advance 5 days, so a re-delegation should not be possible
    await advanceTimeAndBlock(duration.days("5").toNumber())

    await expect(voter.connect(alice).setDelegate(carol.address)).to.be.revertedWith("Delegation is locked")
    expect(await voter.balanceOf(bob.address)).to.equal(bobAmount.add(aliceAmount))
  })

  it("allows re-delegation if minimum delegation duration has passed", async () => {
    const minDelegationDuration = duration.days("7")
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, minDelegationDuration])

    const bobAmount = bn(100)
    const aliceAmount = bn(50)

    await lockfBeets(bob, bobAmount)
    await lockfBeets(alice, aliceAmount)

    await advanceTime(EPOCH_DURATION)
    await voter.connect(alice).setDelegate(bob.address)

    // we advance the minDelegationDuration, so re-delegation should be possinle
    await advanceTimeAndBlock(minDelegationDuration.toNumber())

    await expect(voter.connect(alice).setDelegate(carol.address)).not.to.be.reverted
    expect(await voter.balanceOf(bob.address)).to.equal(bobAmount)
    expect(await voter.balanceOf(carol.address)).to.equal(aliceAmount)
  })

  it("emits SetDelegate event when delegating votes", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, duration.days("7")])
    const bobAmount = bn(100)
    await lockfBeets(bob, bobAmount)
    await expect(voter.connect(alice).setDelegate(bob.address)).to.emit(voter, "SetDelegate").withArgs(alice.address, bob.address)
  })

  it("emits ClearDelegate event for previous delegator when re-delegating votes", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])
    const bobAmount = bn(100)
    await lockfBeets(bob, bobAmount)

    await voter.connect(alice).setDelegate(bob.address)
    await expect(voter.connect(alice).setDelegate(carol.address)).to.emit(voter, "ClearDelegate").withArgs(alice.address, bob.address)
  })

  it("rejects delegating votes to yourself", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])
    const bobAmount = bn(100)
    await lockfBeets(bob, bobAmount)

    await expect(voter.connect(bob).setDelegate(bob.address)).to.be.revertedWith("Cannot delegate to self")
  })

  it("rejects delegating votes to address zero", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])
    const bobAmount = bn(100)
    await lockfBeets(bob, bobAmount)

    await expect(voter.connect(bob).setDelegate(ethers.constants.AddressZero)).to.be.revertedWith("Cannot delegate to 0x0")
  })

  it("rejects re-delegating votes to same address", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])
    const bobAmount = bn(100)
    await lockfBeets(bob, bobAmount)
    await voter.connect(bob).setDelegate(alice.address)
    await expect(voter.connect(bob).setDelegate(alice.address)).to.be.revertedWith("Already delegated to this address")
  })

  it("clears delegated votes", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])
    const bobAmount = bn(100)
    const aliceAmount = bn(50)

    await lockfBeets(alice, aliceAmount)
    await lockfBeets(bob, bobAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    await voter.connect(alice).setDelegate(bob.address)
    await voter.connect(alice).clearDelegate()
    expect(await voter.balanceOf(alice.address)).to.equal(aliceAmount)
    expect(await voter.balanceOf(bob.address)).to.equal(bobAmount)
  })

  it("emits ClearDelegate event when removing delegation", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])
    const bobAmount = bn(100)
    const aliceAmount = bn(50)

    await lockfBeets(alice, aliceAmount)
    await lockfBeets(bob, bobAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    await voter.connect(alice).setDelegate(bob.address)
    await expect(voter.connect(alice).clearDelegate()).to.emit(voter, "ClearDelegate").withArgs(alice.address, bob.address)
  })

  it("rejects clearing of delegation when minimum delegation duration has not yet passed", async () => {
    const minDelegationDuration = duration.days("7")
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, minDelegationDuration])
    const bobAmount = bn(100)
    const aliceAmount = bn(50)

    await lockfBeets(alice, aliceAmount)
    await lockfBeets(bob, bobAmount)

    await advanceTimeAndBlock(EPOCH_DURATION)

    await voter.connect(alice).setDelegate(bob.address)
    // we only advance 5 days, so the minimum of 7 days is not reached
    await advanceTimeAndBlock(duration.days("5").toNumber())
    await expect(voter.connect(alice).clearDelegate()).to.be.revertedWith("Delegation is locked")
  })

  it("rejects clearing of delegates if no delegation is set", async () => {
    const voter = await deployContract<BeetsVoting>("BeetsVoting", [locker.address, 0])
    await expect(voter.connect(alice).clearDelegate()).to.be.revertedWith("No delegate set")
  })

  async function lockfBeets(signer: SignerWithAddress, amount: BigNumber) {
    await fBeets.connect(owner).transfer(signer.address, amount)
    await fBeets.connect(signer).approve(locker.address, amount)
    await locker.connect(signer).lock(signer.address, amount)
  }
})
