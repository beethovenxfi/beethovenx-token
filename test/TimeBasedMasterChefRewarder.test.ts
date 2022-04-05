import { BeethovenxMasterChef, BeethovenxToken, TimeBasedMasterChefRewarder } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers } from "hardhat"
import { advanceBlock, advanceToTime, bn, deployChef, deployContract, deployERC20Mock, latest, setAutomineBlocks } from "./utilities"
import { expect } from "chai"

describe("TimeBasedMasterChefRewarder", function () {
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
    const rewarder = await deployRewarder()

    expect(await rewarder.masterChef()).to.equal(chef.address)
    expect(await rewarder.rewardToken()).to.equal(ethers.constants.AddressZero)
    expect(await rewarder.rewardPerSecond()).to.equal(0)
  })

  it("sets reward token", async () => {
    const rewarder: TimeBasedMasterChefRewarder = await deployRewarder()
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    await expect(rewarder.initializeRewardToken(rewardToken.address))
      .to.emit(rewarder, "LogSetRewardToken")
      .withArgs(rewardToken.address, bn(1, 12))
    expect(await rewarder.rewardToken()).to.equal(rewardToken.address)
    expect(await rewarder.accTokenPrecision()).to.equal(bn(1, 12))
  })

  it("sets accTokenPrecision to 12 relative based on reward token decimals", async () => {
    // so if a reward token has 18 decimals, it the precision should be 12, if the reward token has 6 decimals, it should be 18 - 6 + 12 = 24
    const rewarder: TimeBasedMasterChefRewarder = await deployRewarder()
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000), 6)

    await expect(rewarder.initializeRewardToken(rewardToken.address))
      .to.emit(rewarder, "LogSetRewardToken")
      .withArgs(rewardToken.address, bn(1, 24))
    expect(await rewarder.accTokenPrecision()).to.equal(bn(1, 24))
  })

  it("only allows setting of reward token once", async () => {
    const rewarder: TimeBasedMasterChefRewarder = await deployRewarder()
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const anotherRewardToken = await deployERC20Mock("Token 2", "T2", bn(10_000))

    await rewarder.initializeRewardToken(rewardToken.address)
    await expect(rewarder.initializeRewardToken(anotherRewardToken.address)).to.be.revertedWith("Reward token can only be set once")
  })

  it("sets rewards per second", async () => {
    const rewarder = await deployRewarder()

    const updatedRewardsPerSecond = bn(7)
    await expect(rewarder.setRewardPerSecond(updatedRewardsPerSecond)).to.emit(rewarder, "LogRewardPerSecond").withArgs(updatedRewardsPerSecond)
    expect(await rewarder.rewardPerSecond()).to.equal(updatedRewardsPerSecond)
  })

  it("returns pool length", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewardToken2 = await deployERC20Mock("Token 2", "T2", bn(10_000))
    const rewarder: TimeBasedMasterChefRewarder = await deployRewarder()

    await chef.add(10, rewardToken.address, rewarder.address)
    await chef.add(10, rewardToken2.address, rewarder.address)

    const allocationPoint = 20
    await rewarder.add(0, allocationPoint)
    await rewarder.add(1, allocationPoint)

    expect(await rewarder.poolLength()).to.equal(2)
  })

  it("adds masterchef pool with specified allocation points", async () => {
    const lpToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewarder = await deployRewarder()
    await chef.add(10, lpToken.address, rewarder.address)

    const allocationPoint = 20
    await rewarder.add(0, allocationPoint)
    const { allocPoint } = await rewarder.poolInfo(0)
    expect(allocPoint).to.equal(allocationPoint)
  })

  it("reverts when adding a pool which already exists", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewarder = await deployRewarder()
    await chef.add(10, rewardToken.address, rewarder.address)

    await rewarder.add(0, 10)
    await expect(rewarder.add(0, 10)).to.be.revertedWith("Pool already exists")
  })

  it("sets existing pool allocation points", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))
    const rewarder = await deployRewarder()

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
    const rewarder = await deployRewarder()

    await expect(rewarder.set(0, 10)).to.be.revertedWith("Pool does not exist")
  })
  it("returns 0 pending tokens if pool does not exist", async () => {
    const rewarder = await deployRewarder()
    expect(await rewarder.pendingToken(0, alice.address)).to.equal(bn(0))
  })

  it("allows safer reward token transfer with top up function", async () => {
    // as a safety measure, we can use the topUp function to transfer our reward token
    const rewardToken = await deployERC20Mock("Token 1", "T1", 10_000)

    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)

    const topUpAmount = bn(100)
    await rewardToken.approve(rewarder.address, topUpAmount)
    await rewarder.topUpRewards(topUpAmount)
    expect(await rewardToken.balanceOf(rewarder.address)).to.equal(topUpAmount)
    expect(await rewardToken.balanceOf(owner.address)).to.equal(bn(10_000).sub(topUpAmount))
  })

  it("returns correct amount of pending reward tokens for single pool", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(10_000))

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(75))
    await lpToken.transfer(bob.address, bn(25))

    await setAutomineBlocks(false)
    await lpToken.connect(bob).approve(chef.address, bn(25))
    await chef.connect(bob).deposit(0, bn(25), bob.address)

    await lpToken.connect(alice).approve(chef.address, bn(75))
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

  it("returns correct amount of pending reward tokens for reward token with non standard decimals", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000), 6)

    const rewardsPerSecond = bn(5, 6)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(10_000))

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(75))
    await lpToken.transfer(bob.address, bn(25))

    await setAutomineBlocks(false)
    await lpToken.connect(bob).approve(chef.address, bn(25))
    await chef.connect(bob).deposit(0, bn(25), bob.address)

    await lpToken.connect(alice).approve(chef.address, bn(75))
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

  it("transfers correct amount of reward tokens for single pool", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(10_000))

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(75))
    await lpToken.transfer(bob.address, bn(25))

    await setAutomineBlocks(false)
    await lpToken.connect(bob).approve(chef.address, bn(25))
    await chef.connect(bob).deposit(0, bn(25), bob.address)

    await lpToken.connect(alice).approve(chef.address, bn(75))
    await chef.connect(alice).deposit(0, bn(75), alice.address)
    await setAutomineBlocks(true)
    await advanceBlock()
    const before = await latest()

    // we advance by 100 seconds
    await advanceToTime(before.toNumber() + 100)
    await setAutomineBlocks(false)
    await chef.connect(bob).harvest(0, bob.address)
    await chef.connect(alice).harvest(0, alice.address)
    await setAutomineBlocks(true)
    await advanceBlock()

    expect(await rewardToken.balanceOf(alice.address)).to.equal(rewardsPerSecond.mul(100).mul(3).div(4))
    expect(await rewardToken.balanceOf(bob.address)).to.equal(rewardsPerSecond.mul(100).div(4))

    expect(await rewarder.pendingToken(0, alice.address)).to.equal(bn(0))
    expect(await rewarder.pendingToken(0, bob.address)).to.equal(bn(0))
  })

  it("emits LogOnReward when rewards harvested", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(10_000))

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(100))

    await setAutomineBlocks(false)
    await lpToken.connect(alice).approve(chef.address, bn(100))
    await chef.connect(alice).deposit(0, bn(100), alice.address)
    await setAutomineBlocks(true)
    await advanceBlock()
    const before = await latest()

    // we advance by 100 seconds
    await advanceToTime(before.toNumber() + 100)
    await expect(chef.connect(alice).harvest(0, alice.address))
      .to.emit(rewarder, "LogOnReward")
      .withArgs(alice.address, 0, rewardsPerSecond.mul(100), alice.address)
  })

  it("transfers correct amount of reward tokens for single pool with non standard decials", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000), 6)

    const rewardsPerSecond = bn(5, 6)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(10_000))

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(75))
    await lpToken.transfer(bob.address, bn(25))

    await setAutomineBlocks(false)
    await lpToken.connect(bob).approve(chef.address, bn(25))
    await chef.connect(bob).deposit(0, bn(25), bob.address)

    await lpToken.connect(alice).approve(chef.address, bn(75))
    await chef.connect(alice).deposit(0, bn(75), alice.address)
    await setAutomineBlocks(true)
    await advanceBlock()
    const before = await latest()

    // we advance by 100 seconds
    await advanceToTime(before.toNumber() + 100)
    await setAutomineBlocks(false)
    await chef.connect(bob).harvest(0, bob.address)
    await chef.connect(alice).harvest(0, alice.address)
    await setAutomineBlocks(true)
    await advanceBlock()

    expect(await rewardToken.balanceOf(alice.address)).to.equal(rewardsPerSecond.mul(100).mul(3).div(4))
    expect(await rewardToken.balanceOf(bob.address)).to.equal(rewardsPerSecond.mul(100).div(4))

    expect(await rewarder.pendingToken(0, alice.address)).to.equal(bn(0))
    expect(await rewarder.pendingToken(0, bob.address)).to.equal(bn(0))

    // we advance again by 100 seconds
    const afterFirstHarvest = await latest()
    await advanceToTime(afterFirstHarvest.toNumber() + 100)
    await setAutomineBlocks(false)
    await chef.connect(bob).harvest(0, bob.address)
    await chef.connect(alice).harvest(0, alice.address)
    await setAutomineBlocks(true)
    await advanceBlock()
    expect(await rewardToken.balanceOf(alice.address)).to.equal(rewardsPerSecond.mul(100).mul(3).div(4).mul(2))
    expect(await rewardToken.balanceOf(bob.address)).to.equal(rewardsPerSecond.mul(100).div(4).mul(2))

    expect(await rewarder.pendingToken(0, alice.address)).to.equal(bn(0))
    expect(await rewarder.pendingToken(0, bob.address)).to.equal(bn(0))
  })

  it("transfers correct amount of reward tokens for multiple pools", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const lpToken2 = await deployERC20Mock("LPToken2", "LPT2", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    const rewardAmount = bn(10_000)
    await rewardToken.approve(rewarder.address, rewardAmount)
    await rewarder.topUpRewards(rewardAmount)

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await chef.add(10, lpToken2.address, rewarder.address)
    await rewarder.add(1, 100)

    await lpToken.transfer(alice.address, bn(50))
    await lpToken.transfer(bob.address, bn(50))
    await lpToken2.transfer(carol.address, bn(50))

    await setAutomineBlocks(false)
    await lpToken.connect(bob).approve(chef.address, bn(50))
    await chef.connect(bob).deposit(0, bn(50), bob.address)

    await lpToken.connect(alice).approve(chef.address, bn(50))
    await chef.connect(alice).deposit(0, bn(50), alice.address)

    await lpToken2.connect(carol).approve(chef.address, bn(50))
    await chef.connect(carol).deposit(1, bn(50), carol.address)
    await setAutomineBlocks(true)
    await advanceBlock()
    const before = await latest()

    // we advance by 100 seconds
    await advanceToTime(before.toNumber() + 100)
    await setAutomineBlocks(false)
    await chef.connect(bob).harvest(0, bob.address)
    await chef.connect(alice).harvest(0, alice.address)
    await chef.connect(carol).harvest(1, carol.address)
    await setAutomineBlocks(true)
    // we use massUpdatePools to test this functionality
    await rewarder.massUpdatePools([0, 1])

    expect(await rewardToken.balanceOf(alice.address)).to.equal(rewardsPerSecond.div(2).mul(100).div(2))
    expect(await rewardToken.balanceOf(bob.address)).to.equal(rewardsPerSecond.div(2).mul(100).div(2))
    expect(await rewardToken.balanceOf(carol.address)).to.equal(rewardsPerSecond.div(2).mul(100))

    expect(await rewarder.pendingToken(0, alice.address)).to.equal(bn(0))
    expect(await rewarder.pendingToken(0, bob.address)).to.equal(bn(0))
  })

  it("transfers remaining amount if reward token balance is less than amount", async () => {
    /*
        in case the balance of tokens on the contract is less than what the user would get, he should just get
        the remaining amount
     */
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(98))

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(100))

    await lpToken.connect(alice).approve(chef.address, bn(100))
    await chef.connect(alice).deposit(0, bn(100), alice.address)
    const afterDeposit = await latest()
    // we transferred 98 tokens, with 5 tokens / sec we should have all of them after 20 seconds
    await advanceToTime(afterDeposit.toNumber() + 20)
    await chef.connect(alice).harvest(0, alice.address)
    expect(await rewardToken.balanceOf(alice.address)).to.equal(bn(98))
  })

  it("returns pending remaining amount if reward token balance is less than amount", async () => {
    /*
        in case the balance of tokens on the contract is less than what the user would get, we return the remaining balance as
        pending amount
     */
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(98))

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(100))

    await lpToken.connect(alice).approve(chef.address, bn(100))
    await chef.connect(alice).deposit(0, bn(100), alice.address)
    const afterDeposit = await latest()
    // we transferred 98 tokens, with 5 tokens / sec we should have all of them after 20 seconds
    await advanceToTime(afterDeposit.toNumber() + 20)
    await advanceBlock()
    expect(await rewarder.pendingToken(0, alice.address)).to.equal(bn(98))
  })

  it("allows deposits when rewarder has no funds", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(100))

    await lpToken.connect(alice).approve(chef.address, bn(100))
    await expect(chef.connect(alice).deposit(0, bn(100), alice.address)).not.to.be.reverted
  })

  it("allows harvest when rewarder has no funds", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(100))

    await lpToken.connect(alice).approve(chef.address, bn(100))
    await chef.connect(alice).deposit(0, bn(100), alice.address)
    await advanceBlock()
    await expect(chef.connect(alice).harvest(0, alice.address)).not.to.be.reverted
  })

  it("allows withdraw when rewarder has no funds", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(100))

    await lpToken.connect(alice).approve(chef.address, bn(100))
    await chef.connect(alice).deposit(0, bn(100), alice.address)
    await advanceBlock()
    await expect(chef.connect(alice).withdrawAndHarvest(0, bn(100), alice.address)).not.to.be.reverted
  })

  it("only masterchef can call onBeetsReward hook", async () => {
    const lpToken = await deployERC20Mock("LPToken", "LPT", bn(10_000))
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await chef.add(10, lpToken.address, rewarder.address)
    await rewarder.add(0, 100)

    await lpToken.transfer(alice.address, bn(100))

    await lpToken.connect(alice).approve(chef.address, bn(100))
    //deposit calls onBeetsReward
    await expect(chef.connect(alice).deposit(0, bn(100), alice.address)).not.to.be.reverted
    await expect(rewarder.onBeetsReward(0, bob.address, bob.address, 10, bn(100))).to.be.revertedWith("Only MasterChef can call this function.")
  })

  it("allows owner to shut down rewarder and withdraw remaining funds", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)

    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(10_000))

    await rewarder.shutDown(bob.address)
    expect(await rewarder.rewardPerSecond()).to.equal(0)
    expect(await rewardToken.balanceOf(bob.address)).to.equal(bn(10_000))
  })

  it("rejects if anyone else than owner calls shutdown", async () => {
    const rewardToken = await deployERC20Mock("Token 1", "T1", bn(10_000))

    const rewardsPerSecond = bn(5)
    const rewarder = await deployRewarder()
    await rewarder.initializeRewardToken(rewardToken.address)
    await rewarder.setRewardPerSecond(rewardsPerSecond)

    await rewardToken.transfer(rewarder.address, bn(10_000))

    await expect(rewarder.connect(bob).shutDown(bob.address)).to.be.revertedWith("Ownable: caller is not the owner")
    await expect(rewarder.connect(alice).shutDown(bob.address)).to.be.revertedWith("Ownable: caller is not the owner")
  })

  async function deployRewarder(): Promise<TimeBasedMasterChefRewarder> {
    return deployContract("TimeBasedMasterChefRewarder", [chef.address])
  }
})
