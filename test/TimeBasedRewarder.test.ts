import { BeethovenxMasterChef, BeethovenxToken, TimeBasedRewarder } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers } from "hardhat"
import {
  advanceBlock,
  advanceTime,
  advanceTimeAndBlock,
  advanceToTime,
  bn,
  deployChef,
  deployContract,
  deployERC20Mock,
  latest,
  setAutomineBlocks,
} from "./utilities"
import { expect } from "chai"

describe("TimeBasedRewarder", function () {
  let beets: BeethovenxToken
  let chef: BeethovenxMasterChef
  let owner: SignerWithAddress
  let dev: SignerWithAddress
  let treasury: SignerWithAddress
  let marketing: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    dev = signers[1]
    treasury = signers[2]
    marketing = signers[3]
    alice = signers[4]
    bob = signers[5]
    carol = signers[6]
  })

  beforeEach(async function () {
    beets = await deployContract("BeethovenxToken", [])
    const startBlock = 0
    const beetsPerBlock = bn(6)

    chef = await deployChef(beets.address, treasury.address, beetsPerBlock, startBlock)
    await beets.transferOwnership(chef.address)
  })

  it("sets intial state correctly", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewardsPerSecond = bn(5)
    const rewarder: TimeBasedRewarder = await deployContract("TimeBasedRewarder", [rewardToken.address, rewardsPerSecond, chef.address])

    expect(await rewarder.rewardPerSecond()).to.equal(rewardsPerSecond)
    expect(await rewarder.rewardToken()).to.equal(rewardToken.address)
  })

  it("adds masterchef pool with specified allocation points", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewardsPerSecond = bn(5)
    const rewarder: TimeBasedRewarder = await deployContract("TimeBasedRewarder", [rewardToken.address, rewardsPerSecond, chef.address])

    await chef.add(10, rewardToken.address, rewarder.address)

    const allocationPoint = 20
    await rewarder.add(0, allocationPoint)
    const { allocPoint } = await rewarder.poolInfo(0)
    expect(allocPoint).to.equal(allocationPoint)
  })

  it("reverts when adding a pool which already exists", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewardsPerSecond = bn(5)
    const rewarder: TimeBasedRewarder = await deployContract("TimeBasedRewarder", [rewardToken.address, rewardsPerSecond, chef.address])
    await chef.add(10, rewardToken.address, rewarder.address)

    await rewarder.add(0, 10)
    await expect(rewarder.add(0, 10)).to.be.revertedWith("Pool already exists")
  })

  it("sets existing pool allocation points", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewardsPerSecond = bn(5)
    const rewarder: TimeBasedRewarder = await deployContract("TimeBasedRewarder", [rewardToken.address, rewardsPerSecond, chef.address])

    await chef.add(10, rewardToken.address, rewarder.address)

    const initialAllocationPoints = 20
    await rewarder.add(0, initialAllocationPoints)
    const { allocPoint } = await rewarder.poolInfo(0)
    expect(allocPoint).to.equal(initialAllocationPoints)
    const updatedAllocationPoints = 30
    await rewarder.set(0, updatedAllocationPoints)
    const { allocPoint: newAllocationPoints } = await rewarder.poolInfo(0)
    expect(newAllocationPoints).to.equal(updatedAllocationPoints)
  })

  it("reverts when setting allocation points for a non existent pool", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewardsPerSecond = bn(5)
    const rewarder: TimeBasedRewarder = await deployContract("TimeBasedRewarder", [rewardToken.address, rewardsPerSecond, chef.address])

    await expect(rewarder.set(0, 10)).to.be.revertedWith("Pool does not exist")
  })

  it("transfers correct amount of rewarder tokens on harvest call for single pool", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder: TimeBasedRewarder = await deployContract("TimeBasedRewarder", [rewardToken.address, rewardsPerSecond, chef.address])

    await chef.add(10, rewardToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await rewardToken.transfer(alice.address, bn(75))
    await rewardToken.transfer(bob.address, bn(25))

    await setAutomineBlocks(false)
    await rewardToken.connect(bob).approve(chef.address, bn(25))
    await chef.connect(bob).deposit(0, bn(25), bob.address)

    await rewardToken.connect(alice).approve(chef.address, bn(75))
    await chef.connect(alice).deposit(0, bn(75), alice.address)
    await setAutomineBlocks(true)
    await advanceBlock()
    const before = await latest()

    // we advance by 100 seconds
    await advanceToTime(before.toNumber() + 100)
    await advanceBlock()

    expect(await rewarder.pendingToken(0, alice.address)).to.equal(rewardsPerSecond.mul(100).mul(3).div(4))
    expect(await rewarder.pendingToken(0, bob.address)).to.equal(rewardsPerSecond.mul(100).div(4))
  })
})
