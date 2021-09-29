import moment from "moment"
import { BeethovenxMasterChef, BeethovenxToken, MasterChefLpTokenTimelock } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers } from "hardhat"
import { advanceBlockTo, bn, deployChef, deployContract, deployERC20Mock } from "./utilities"
import { expect } from "chai"
import { BigNumber } from "ethers"

describe("BeethovenxMasterChef", function () {
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
  const treasuryPercentage = 128
  const lpPercentage = 872
  let beetsPerBlock: BigNumber = bn(8)

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

    // lets give bob some tokens and transfer them to the timelock
    const lpAmount = 1000
    await lp.transfer(bob.address, lpAmount)
    await lp.connect(bob).approve(tokenTimelock.address, lpAmount)
    await lp.connect(bob).transfer(tokenTimelock.address, lpAmount)

    // now deposit them to the master chef
    const tx = await tokenTimelock.depositAllToMasterChef()
    expect(await lp.balanceOf(chef.address)).to.equal(lpAmount)

    await advanceBlockTo((tx.blockNumber! + 10).toString())
    const expectedRewards = lpRewards(10)
    expect(await chef.pendingBeets(0, tokenTimelock.address)).to.equal(expectedRewards)

    await advanceBlockTo((tx.blockNumber! + 19).toString())
    await tokenTimelock.harvest()

    expect(await beets.balanceOf(bob.address)).to.equal(lpRewards(20))
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
