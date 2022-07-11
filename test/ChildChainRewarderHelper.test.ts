import {
  ADDRESS_ZERO,
  advanceBlock,
  advanceTime,
  advanceTimeAndBlock,
  bn,
  deployContract,
  deployERC20Mock,
  latest,
  setAutomineBlocks,
} from "./utilities"
import { ethers } from "hardhat"
import {
  BeetsBar,
  ChildChainGaugeRewardHelper,
  ChildChainLiquidityGaugeFactory,
  ChildChainStreamer,
  IChildChainLiquidityGaugeFactory,
  IERC20,
  RewardsOnlyGauge,
} from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { getContractAt } from "@nomiclabs/hardhat-ethers/internal/helpers"
import { keccak256 } from "ethers/lib/utils"
import { BigNumber } from "ethers"

describe("ChildChainRewarderHelper", function () {
  let owner: SignerWithAddress
  let vault: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress
  let balToken: IERC20
  let rewardToken: IERC20
  let anotherRewardToken: IERC20
  let pool: IERC20
  let gaugeFactory: IChildChainLiquidityGaugeFactory
  let gauge: RewardsOnlyGauge
  let streamer: ChildChainStreamer
  let rewardHelper: ChildChainGaugeRewardHelper

  const rewardDuration = 604800
  const claimFrequency = 3600

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    vault = signers[1]
    alice = signers[4]
    bob = signers[5]
    carol = signers[6]
    balToken = await deployERC20Mock("BAL", "BAL", bn(10_000))
    const gaugeTemplate = await deployContract<RewardsOnlyGauge>("RewardsOnlyGauge", [balToken.address, vault.address, owner.address])
    const streamerTemplate = await deployContract<ChildChainStreamer>("ChildChainStreamer", [balToken.address, owner.address])

    gaugeFactory = await deployContract<ChildChainLiquidityGaugeFactory>("ChildChainLiquidityGaugeFactory", [
      gaugeTemplate.address,
      streamerTemplate.address,
    ])
  })

  beforeEach(async function () {
    pool = await deployERC20Mock("pool", "bpt", bn(10_000))
    rewardToken = await deployERC20Mock("Reward1", "R1", bn(10_000))
    anotherRewardToken = await deployERC20Mock("Reward2", "R2", bn(10_000))
    await gaugeFactory.create(pool.address)
    const poolGauge = await gaugeFactory.getPoolGauge(pool.address)
    gauge = (await ethers.getContractAt("RewardsOnlyGauge", poolGauge)) as RewardsOnlyGauge
    const streamerAddress = await gauge.reward_contract()
    streamer = (await ethers.getContractAt("ChildChainStreamer", streamerAddress)) as ChildChainStreamer
    rewardHelper = await deployContract<ChildChainGaugeRewardHelper>("ChildChainGaugeRewardHelper", [])
    await streamer.add_reward(rewardToken.address, owner.address, rewardDuration)
    await streamer.add_reward(anotherRewardToken.address, owner.address, rewardDuration)

    await gauge.set_rewards(streamer.address, await rewardHelper.CLAIM_SIG(), [
      balToken.address,
      rewardToken.address,
      anotherRewardToken.address,
      ADDRESS_ZERO,
      ADDRESS_ZERO,
      ADDRESS_ZERO,
      ADDRESS_ZERO,
      ADDRESS_ZERO,
    ])
  })

  it("returns pending amount based on reward rate when blocked by claim frequency", async () => {
    await pool.connect(owner).transfer(alice.address, bn(100))
    await pool.connect(owner).transfer(bob.address, bn(100))
    await pool.approve(gauge.address, bn(100))

    const rewardAmount = bn(50_000)
    await rewardToken.transfer(streamer.address, rewardAmount)
    await streamer.notify_reward_amount(rewardToken.address)
    const rewardTokenData = await streamer.reward_data(rewardToken.address)
    const rate = rewardTokenData.rate

    await setAutomineBlocks(false)
    await pool.connect(alice).approve(gauge.address, bn(100))
    await gauge.connect(alice)["deposit(uint256)"](bn(100))
    await pool.connect(bob).approve(gauge.address, bn(100))
    await gauge.connect(bob)["deposit(uint256)"](bn(100))
    await setAutomineBlocks(true)
    await advanceBlock()
    await advanceTimeAndBlock(60)

    const pendingAlice = await rewardHelper.callStatic.pendingRewards(gauge.address, alice.address, rewardToken.address)
    expect(pendingAlice).to.be.closeTo(rate.mul(60).div(2), 1e5)
  })

  it("returns pending amount based on claimable_reward_write when not blocked by claim frequency", async () => {
    await pool.connect(owner).transfer(alice.address, bn(100))
    await pool.connect(owner).transfer(bob.address, bn(100))
    await pool.approve(gauge.address, bn(100))

    const rewardAmount = bn(50_000)
    await rewardToken.transfer(streamer.address, rewardAmount)
    await streamer.notify_reward_amount(rewardToken.address)

    await setAutomineBlocks(false)
    await pool.connect(alice).approve(gauge.address, bn(100))
    await gauge.connect(alice)["deposit(uint256)"](bn(100))
    await pool.connect(bob).approve(gauge.address, bn(100))
    await gauge.connect(bob)["deposit(uint256)"](bn(100))
    await setAutomineBlocks(true)
    await advanceBlock()
    await advanceTimeAndBlock(claimFrequency + 1)

    const pendingGauge = await gauge.connect(alice).callStatic.claimable_reward_write(alice.address, rewardToken.address)
    const pendingHelper = await rewardHelper.callStatic.pendingRewards(gauge.address, alice.address, rewardToken.address)
    expect(pendingHelper).to.equal(pendingGauge)
  })

  it("claims tokens from streamer also while blocked by claim frequency", async () => {
    await pool.connect(owner).transfer(alice.address, bn(100))
    await pool.connect(owner).transfer(bob.address, bn(100))
    await pool.approve(gauge.address, bn(100))

    const rewardAmount = bn(50_000)
    await rewardToken.transfer(streamer.address, rewardAmount)
    await streamer.notify_reward_amount(rewardToken.address)
    const rewardTokenData = await streamer.reward_data(rewardToken.address)
    const rate = rewardTokenData.rate

    await setAutomineBlocks(false)
    await pool.connect(alice).approve(gauge.address, bn(100))
    await gauge.connect(alice)["deposit(uint256)"](bn(100))
    await pool.connect(bob).approve(gauge.address, bn(100))
    await gauge.connect(bob)["deposit(uint256)"](bn(100))
    await setAutomineBlocks(true)
    await advanceBlock()
    await advanceTimeAndBlock(60)

    await rewardHelper.claimRewards(gauge.address, alice.address)
    const aliceAmount = await rewardToken.balanceOf(alice.address)
    expect(aliceAmount).to.be.closeTo(rate.mul(60).div(2), 1)
  })

  it("shows pending rewards on streamer after a withdraw", async () => {
    await pool.connect(owner).transfer(alice.address, bn(100))
    await pool.connect(owner).transfer(bob.address, bn(100))
    await pool.approve(gauge.address, bn(100))

    const rewardAmount = bn(50_000)
    await rewardToken.transfer(streamer.address, rewardAmount)
    await streamer.notify_reward_amount(rewardToken.address)

    await setAutomineBlocks(false)
    await pool.connect(alice).approve(gauge.address, bn(100))
    await gauge.connect(alice)["deposit(uint256)"](bn(100))
    await pool.connect(bob).approve(gauge.address, bn(100))
    await gauge.connect(bob)["deposit(uint256)"](bn(100))
    await setAutomineBlocks(true)
    await advanceBlock()
    await advanceTimeAndBlock(60)

    // await rewardHelper.claimRewards(gauge.address, alice.address)
    // await advanceTimeAndBlock(1290)
    const pendingAlice1 = await rewardHelper.callStatic.pendingRewards(gauge.address, alice.address, rewardToken.address)
    console.log("pending after claim", pendingAlice1.toString())
    const gaugeBal = await rewardToken.balanceOf(gauge.address)
    console.log("gauge bal", gaugeBal.toString())
    await streamer.get_reward()
    await gauge.connect(alice)["withdraw(uint256,bool)"](bn(100), false)
    await gauge.claimable_reward_write(bob.address, rewardToken.address)
    const pendingAlice = await rewardHelper.callStatic.pendingRewards(gauge.address, alice.address, rewardToken.address)
    await rewardHelper.claimRewards(gauge.address, alice.address)
    const claimedRewards = await rewardToken.balanceOf(alice.address)
    const balanceOnGauge = await gauge.balanceOf(alice.address)
    console.log("balanceOnGauge", balanceOnGauge.toString())
    console.log("pending", pendingAlice.toString())
    console.log("claimed", claimedRewards.toString())
    expect(pendingAlice).to.equal(claimedRewards)
  })
})
