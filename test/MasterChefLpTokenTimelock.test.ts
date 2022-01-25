import moment from "moment"
import { BeethovenxMasterChef, BeethovenxToken, MasterChefLpTokenTimelock } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers } from "hardhat"
import { advanceBlock, advanceBlockRelativeTo, advanceToTime, bn, deployChef, deployContract, deployERC20Mock } from "./utilities"
import { expect } from "chai"
import { BigNumber } from "ethers"

describe("MasterChef LP token timelock", function () {
  let beets: BeethovenxToken
  let chef: BeethovenxMasterChef
  let owner: SignerWithAddress
  let dev: SignerWithAddress
  let treasury: SignerWithAddress
  let marketing: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  // these are fixed values hardcoded in the contract
  // 1000 = 100 %
  const lpPercentage = 872
  let beetsPerBlock: BigNumber = bn(6)

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
    chef = await deployChef(beets.address, treasury.address, beetsPerBlock, 0)
    await beets.transferOwnership(chef.address)
  })

  it("sets initial state correctly", async () => {
    const lp = await deployERC20Mock("LP", "LP", 10_000)
    await chef.add(10, lp.address, ethers.constants.AddressZero)
    const releaseTime = moment().add(1, "year")

    const tokenTimelock = await deployContract<MasterChefLpTokenTimelock>("MasterChefLpTokenTimelock", [
      lp.address,
      bob.address,
      releaseTime.unix(),
      chef.address,
      0,
    ])

    expect(await tokenTimelock.token()).to.equal(lp.address)
    expect(await tokenTimelock.beneficiary()).to.equal(bob.address)
    expect(await tokenTimelock.releaseTime()).to.equal(releaseTime.unix())
    expect(await tokenTimelock.masterChefPoolId()).to.equal(0)
  })

  it("reverts if provided master chef pool id does not accept the provided token", async () => {
    const lp = await deployERC20Mock("LP", "LP", 10_000)
    const lp2 = await deployERC20Mock("LP2", "LP2", 10_000)
    await chef.add(10, lp2.address, ethers.constants.AddressZero)
    const releaseTime = moment().add(1, "year")

    await expect(
      deployContract<MasterChefLpTokenTimelock>("MasterChefLpTokenTimelock", [lp.address, bob.address, releaseTime.unix(), chef.address, 0])
    ).to.be.revertedWith("Provided poolId not eligible for this token")
  })

  it("deposits total balance of token to master chef pool", async () => {
    const lpRewards = rewardsCalculator(beetsPerBlock, lpPercentage)
    const lp = await deployERC20Mock("LP", "LP", 10_000)

    await chef.add(10, lp.address, ethers.constants.AddressZero)
    const releaseTime = moment().add(1, "year")

    const tokenTimelock = await deployContract<MasterChefLpTokenTimelock>("MasterChefLpTokenTimelock", [
      lp.address,
      bob.address,
      releaseTime.unix(),
      chef.address,
      0,
    ])

    // lets give bob some tokens and transfer them to the vesting contract
    const lpAmount = 1000
    await lp.transfer(bob.address, lpAmount)
    await lp.connect(bob).approve(tokenTimelock.address, lpAmount)

    // deposit them to the vesting contract which deposits it into master chef
    const tx = await tokenTimelock.connect(bob).depositAllToMasterChef(lpAmount)
    // bob should have none left
    expect(await lp.balanceOf(bob.address)).to.equal(0)
    expect(await lp.balanceOf(chef.address)).to.equal(lpAmount)

    const { amount } = await chef.userInfo(0, tokenTimelock.address)
    expect(amount).to.equal(lpAmount)
  })

  it("allows harvesting of master chef rewards", async () => {
    const lpRewards = rewardsCalculator(beetsPerBlock, lpPercentage)
    const lp = await deployERC20Mock("LP", "LP", 10_000)

    await chef.add(10, lp.address, ethers.constants.AddressZero)
    const releaseTime = moment().add(1, "year")

    const tokenTimelock = await deployContract<MasterChefLpTokenTimelock>("MasterChefLpTokenTimelock", [
      lp.address,
      bob.address,
      releaseTime.unix(),
      chef.address,
      0,
    ])

    // lets give bob some tokens and transfer them to the vesting contract
    const lpAmount = 1000
    await lp.transfer(bob.address, lpAmount)
    await lp.connect(bob).approve(tokenTimelock.address, lpAmount)

    // deposit them to the vesting contract which deposits it into master chef
    const tx = await tokenTimelock.connect(bob).depositAllToMasterChef(lpAmount)

    await advanceBlockRelativeTo(tx, 10)

    const expectedRewards = lpRewards(10)
    expect(await chef.pendingBeets(0, tokenTimelock.address)).to.equal(expectedRewards)

    await advanceBlockRelativeTo(tx, 19)
    await tokenTimelock.harvest()

    expect(await beets.balanceOf(bob.address)).to.equal(lpRewards(20))
  })

  it("releases vested tokens deposited to master chef after release time has passed", async () => {
    const lpRewards = rewardsCalculator(beetsPerBlock, lpPercentage)

    const lp = await deployERC20Mock("LP", "LP", 10_000)

    await chef.add(10, lp.address, ethers.constants.AddressZero)
    const now = moment().add(2, "months")
    const releaseTime = now.clone().add(1, "year")

    await advanceToTime(now.unix())
    await advanceBlock()

    const tokenTimelock = await deployContract<MasterChefLpTokenTimelock>("MasterChefLpTokenTimelock", [
      lp.address,
      bob.address,
      releaseTime.unix(),
      chef.address,
      0,
    ])

    // lets give bob again some tokens and transfer them to the token vesting contract
    const lpAmount = 1000
    await lp.transfer(bob.address, lpAmount)
    await lp.connect(bob).approve(tokenTimelock.address, lpAmount)

    // now deposit them to the master chef
    const tx = await tokenTimelock.connect(bob).depositAllToMasterChef(lpAmount)
    expect(await lp.balanceOf(chef.address)).to.equal(lpAmount)

    // lets advance a few blocks to generate some rewards
    await advanceBlockRelativeTo(tx, 9)

    // the vesting duration is set to 1 year, so lets advance to this time
    await advanceToTime(releaseTime.unix())
    await tokenTimelock.release() // we should get rewards for 10 blocks
    expect(await beets.balanceOf(bob.address)).to.equal(lpRewards(10))
    // bob should also have his LP tokens back
    expect(await lp.balanceOf(bob.address)).to.equal(lpAmount)
  })

  it("releases vested tokens which remained on vesting contract", async () => {
    const lp = await deployERC20Mock("LP", "LP", 10_000)

    await chef.add(10, lp.address, ethers.constants.AddressZero)
    // prevent collision with other tests
    const now = moment().add(2, "years")
    const releaseTime = now.clone().add(1, "year")

    await advanceToTime(now.unix())
    await advanceBlock()

    const tokenTimelock = await deployContract<MasterChefLpTokenTimelock>("MasterChefLpTokenTimelock", [
      lp.address,
      bob.address,
      releaseTime.unix(),
      chef.address,
      0,
    ])

    // lets give bob again some tokens and transfer them to the token vesting contract
    const lpAmount = 1000
    await lp.transfer(bob.address, lpAmount)
    // we give 500 to master chef and another 500 should remain on the vesting contract
    await lp.connect(bob).approve(tokenTimelock.address, lpAmount / 2)

    // now deposit them to the master chef
    await tokenTimelock.connect(bob).depositAllToMasterChef(lpAmount / 2)
    expect(await lp.balanceOf(chef.address)).to.equal(lpAmount / 2)

    // now we deposit the other half but dont put it into master chef
    await lp.connect(bob).approve(tokenTimelock.address, lpAmount / 2)
    await lp.connect(bob).transfer(tokenTimelock.address, lpAmount / 2)

    expect(await lp.balanceOf(tokenTimelock.address)).to.equal(lpAmount / 2)

    await advanceToTime(releaseTime.unix())
    await tokenTimelock.release()
    // now bob should have all lp's back
    expect(await lp.balanceOf(bob.address)).to.equal(lpAmount)
  })

  it("releases LPs deposited to master chef on behalf of the vesting contract", async () => {
    /*
      instead of depositing the tokens first to the vesting contract and deposit them from there into the master chef,
      we can also deposit the LP's on behalf of the vesting contract directly to the master chef. but be cautious cause
      if the pool ID you put them in the master chef does not match the poolId within the vesting contract, you will never
      be able to release them again! So we should really not do that, but since we cannot prevent it, lets write a test for it
     */

    const lp = await deployERC20Mock("LP", "LP", 10_000)

    await chef.add(10, lp.address, ethers.constants.AddressZero)
    // prevent collision with other tests
    const now = moment().add(5, "years")
    const releaseTime = now.clone().add(1, "year")

    await advanceToTime(now.unix())
    await advanceBlock()

    const tokenTimelock = await deployContract<MasterChefLpTokenTimelock>("MasterChefLpTokenTimelock", [
      lp.address,
      bob.address,
      releaseTime.unix(),
      chef.address,
      0,
    ])

    // lets give bob again some tokens and transfer them to the token vesting contract
    const lpAmount = 1000
    await lp.transfer(bob.address, lpAmount)
    await lp.connect(bob).approve(chef.address, lpAmount)
    // now we deposit them straight to master chef on behalf of the vesting contract
    await chef.connect(bob).deposit(0, lpAmount, tokenTimelock.address)

    expect(await lp.balanceOf(chef.address)).to.equal(lpAmount)

    await advanceToTime(releaseTime.unix())
    await tokenTimelock.release()
    // now bob should have all lp's back
    expect(await lp.balanceOf(bob.address)).to.equal(lpAmount)
  })

  it("reverts releasing of vested tokens if release time has not passed yet", async () => {
    const lp = await deployERC20Mock("LP", "LP", 10_000)

    await chef.add(10, lp.address, ethers.constants.AddressZero)
    // we advance the blockchain to future (affected by previous tests)
    const now = moment().add(10, "years")
    const releaseTime = now.clone().add(1, "year")
    await advanceToTime(now.unix())

    const tokenTimelock = await deployContract<MasterChefLpTokenTimelock>("MasterChefLpTokenTimelock", [
      lp.address,
      bob.address,
      releaseTime.unix(),
      chef.address,
      0,
    ])

    // lets give bob again some tokens and transfer them to the token vesting contract
    const lpAmount = 1000
    await lp.transfer(bob.address, lpAmount)
    await lp.connect(bob).approve(tokenTimelock.address, lpAmount)

    // now deposit them to the master chef
    const tx = await tokenTimelock.connect(bob).depositAllToMasterChef(lpAmount)
    expect(await lp.balanceOf(chef.address)).to.equal(lpAmount)

    await expect(tokenTimelock.release()).to.be.revertedWith("TokenTimelock: current time is before release time")

    // lets move the time a bit
    await advanceToTime(now.clone().add(5, "months").unix())
    await expect(tokenTimelock.release()).to.be.revertedWith("TokenTimelock: current time is before release time")
    //
    // // lets get closer to the edge, 1 second before release
    await advanceToTime(releaseTime.unix() - 1)
    await expect(tokenTimelock.release()).to.be.revertedWith("TokenTimelock: current time is before release time")

    await advanceToTime(releaseTime.unix())
    await expect(tokenTimelock.release()).not.to.be.reverted
    expect(await lp.balanceOf(bob.address)).to.equal(lpAmount)
  })
})

function rewardsCalculator(beetsPerBlock: BigNumber, percentage: number) {
  return (blocks: number) => {
    return percentageOf(beetsPerBlock.mul(blocks), percentage)
  }
}

function percentageOf(value: BigNumber, percentage: number) {
  return value.mul(percentage).div(1000)
}
