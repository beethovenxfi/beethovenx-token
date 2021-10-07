import { expect } from "chai"
import {
  advanceBlock,
  advanceBlockRelativeTo,
  advanceBlockTo,
  bn,
  deployChef,
  deployContract,
  deployERC20Mock,
  setAutomineBlocks,
} from "./utilities"
import { ethers } from "hardhat"
import { BeethovenxMasterChef, BeethovenxToken, RewarderMock } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"

describe("BeethovenxMasterChef", function () {
  let beets: BeethovenxToken
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
  })

  it("sets initial state correctly", async () => {
    const startBlock = 521

    const beetsPerBlock = bn(6)

    const chef = await deployChef(beets.address, treasury.address, beetsPerBlock, startBlock)
    await beets.transferOwnership(chef.address)

    const actualBeetsAddress = await chef.beets()
    const actualTreasuryAddress = await chef.treasuryAddress()
    const actualBeetsOwnerAddress = await beets.owner()

    const actualTreasuryPercentage = await chef.TREASURY_PERCENTAGE()

    const actualBeetsPerBlock = await chef.beetsPerBlock()

    expect(actualBeetsAddress).to.equal(beets.address)
    expect(actualTreasuryAddress).to.equal(treasury.address)
    expect(actualBeetsOwnerAddress).to.equal(chef.address)

    expect(actualTreasuryPercentage).to.equal(treasuryPercentage)

    expect(actualBeetsPerBlock).to.equal(beetsPerBlock)
  })

  // our max emission rate at the start is 6 beets / blocks
  it("reverts when initialized with an emission rate bigger than 6e18", async () => {
    await expect(deployChef(beets.address, treasury.address, bn(9), 0)).to.be.revertedWith("maximum emission rate of 6 beets per block exceeded")
  })

  it("allows setting of emission rate by the owner", async () => {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    await chef.connect(owner).updateEmissionRate(bn(1))
    expect(await chef.beetsPerBlock()).to.equal(bn(1))
  })

  it("denies access if anyone but owner updates emission rate", async () => {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    await expect(chef.connect(bob).updateEmissionRate(bn(1))).to.be.reverted
    await expect(chef.connect(alice).updateEmissionRate(bn(1))).to.be.reverted
  })

  it("reverts given an updated token emission of bigger than 8 beets per block", async () => {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    await expect(chef.connect(owner).updateEmissionRate(bn(9))).to.be.revertedWith("maximum emission rate of 6 beets per block exceeded")
  })

  it("allows treasury address to be updated by owner", async function () {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    expect(await chef.treasuryAddress()).to.equal(treasury.address)
    await chef.connect(owner).treasury(bob.address)
    expect(await chef.treasuryAddress()).to.equal(bob.address)
  })

  it("reverts if anyone but the owner updates the treasury address", async function () {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 200)
    await beets.transferOwnership(chef.address)

    await expect(chef.connect(bob).treasury(bob.address)).to.be.revertedWith("Ownable: caller is not the owner")
  })

  it("returns amount of pools", async function () {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    const lp2Token = await deployERC20Mock("LP Token 2", "LPT2", 10)

    await chef.add(10, lp1Token.address, ethers.constants.AddressZero)
    await chef.add(10, lp2Token.address, ethers.constants.AddressZero)
    expect(await chef.poolLength()).to.be.equal(2)
  })

  it("updates pool with allocation point and rewarder", async function () {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    const rewarderToken = await deployERC20Mock("RewarderToken", "RT1", 10)
    const rewarder = await deployContract<RewarderMock>("RewarderMock", [1, rewarderToken.address, chef.address])
    const rewarder2 = await deployContract<RewarderMock>("RewarderMock", [1, rewarderToken.address, chef.address])

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    const lp2Token = await deployERC20Mock("LP Token 2", "LPT2", 10)

    await chef.add(10, lp1Token.address, rewarder.address)
    await chef.add(10, lp2Token.address, rewarder.address)
    await expect(chef.set(0, 15, ethers.constants.AddressZero, false)).to.emit(chef, "LogSetPool").withArgs(0, 15, rewarder.address, false)

    expect((await chef.poolInfo(0)).allocPoint).to.equal(15)
    expect(await chef.rewarder(0)).to.equal(rewarder.address)

    await expect(chef.set(0, 18, rewarder2.address, true)).to.emit(chef, "LogSetPool").withArgs(0, 18, rewarder2.address, true)
    expect((await chef.poolInfo(0)).allocPoint).to.equal(18)
    expect(await chef.rewarder(0)).to.equal(rewarder2.address)
  })

  it("reverts in case of updating a pool with an invalid pid", async function () {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    let err
    try {
      await chef.set(0, 10, ethers.constants.AddressZero, false)
    } catch (e) {
      err = e
    }
    expect(err).to.exist
  })

  it("reverts when adding an lp token which was already added", async () => {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    await lp1Token.transfer(alice.address, 10)

    await chef.add(10, lp1Token.address, ethers.constants.AddressZero)

    await expect(chef.add(10, lp1Token.address, ethers.constants.AddressZero)).to.be.revertedWith("add: LP already added")
  })

  it("reverts when adding a pool with an LP token address which is not a contract", async () => {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    await expect(chef.add(10, carol.address, ethers.constants.AddressZero)).to.be.revertedWith("add: LP token must be a valid contract")
  })

  it("reverts when adding a pool with a rewarder address which is not a contract", async () => {
    const chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    await lp1Token.transfer(alice.address, 10)

    await expect(chef.add(10, lp1Token.address, carol.address)).to.be.revertedWith("add: rewarder must be contract or zero")
  })

  it("returns pending BEETS", async function () {
    const beetsPerblock = bn(6)
    const chef = await deployChef(beets.address, treasury.address, beetsPerblock, 0)
    await beets.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    await lp1Token.transfer(alice.address, 10)

    await chef.add(10, lp1Token.address, ethers.constants.AddressZero)

    await lp1Token.connect(alice).approve(chef.address, 10)

    const depositionPoint = await chef.connect(alice).deposit(0, 1, alice.address)
    await advanceBlockTo((depositionPoint.blockNumber! + 9).toString())
    await chef.updatePool(0)
    expect(await chef.pendingBeets(0, alice.address)).to.equal(percentageOf(beetsPerblock.mul(10), lpPercentage))
  })

  it("allows emergency withdraw", async function () {
    const chef = await deployChef(beets.address, treasury.address, 1000, 0)
    await beets.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)

    // we give bob some lp's and approve it so we can deposit it to the pool
    await lp.transfer(bob.address, "1000")
    await lp.connect(bob).approve(chef.address, "1000")

    await chef.add("100", lp.address, ethers.constants.AddressZero)
    await chef.connect(bob).deposit(0, "100", bob.address)

    expect(await lp.balanceOf(bob.address)).to.equal("900")

    await advanceBlock()
    await chef.updatePool(0)

    await expect(chef.connect(bob).emergencyWithdraw(0, bob.address))
      .to.emit(chef, "EmergencyWithdraw")
      .withArgs(bob.address, 0, 100, bob.address)
    expect(await lp.balanceOf(bob.address)).to.equal("1000")
  })

  it("starts giving out rewards only after the start block has been reached", async function () {
    const beetsPerBlock = bn(6)
    const chef = await deployChef(beets.address, treasury.address, beetsPerBlock, 150)
    await beets.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)

    // we give bob some lp's and approve it so we can deposit it to the pool
    await lp.transfer(bob.address, 1000)
    await lp.connect(bob).approve(chef.address, 1000)

    await chef.add("100", lp.address, ethers.constants.AddressZero)

    await chef.connect(bob).deposit(0, 100, bob.address)
    await advanceBlockTo("110")

    await chef.updatePool(0)
    expect(await beets.balanceOf(bob.address)).to.equal(0)
    await advanceBlockTo("120")

    await chef.updatePool(0)
    expect(await beets.balanceOf(bob.address)).to.equal(0)
    await advanceBlockTo("130")

    await chef.updatePool(0) // block 100
    expect(await beets.balanceOf(bob.address)).to.equal(0)
    await advanceBlockTo("150")

    await chef.connect(bob).harvest(0, bob.address)
    expect(await beets.balanceOf(bob.address)).to.equal(percentageOf(beetsPerBlock, lpPercentage))
    expect(await beets.balanceOf(treasury.address)).to.equal(percentageOf(beetsPerBlock, treasuryPercentage))
    expect(await beets.totalSupply()).to.equal(beetsPerBlock)

    await advanceBlockTo("154")

    await chef.connect(bob).harvest(0, bob.address) // block 105
    expect(await beets.balanceOf(bob.address)).to.equal(percentageOf(beetsPerBlock.mul(5), lpPercentage))
    expect(await beets.balanceOf(treasury.address)).to.equal(percentageOf(beetsPerBlock.mul(5), treasuryPercentage))
    expect(await beets.totalSupply()).to.equal(beetsPerBlock.mul(5))
  })

  it("does not distribute BEETS's if no one deposits", async function () {
    const chef = await deployChef(beets.address, treasury.address, 1000, 100)
    await beets.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)

    await chef.add("100", lp.address, ethers.constants.AddressZero)

    await advanceBlockTo("199")
    expect(await beets.totalSupply()).to.equal(0)
    await advanceBlockTo("204")
    expect(await beets.totalSupply()).to.equal(0)
    await advanceBlockTo("209")
    expect(await beets.totalSupply()).to.equal(0)
  })

  it("distributes BEETS properly for each staker", async function () {
    /*
        formula for rewards: FractionOfTotalLps * NumberOfBlocks * RewardsPerBlock * PercentageOfRewardsForPool
        where RewardsPerBlock = 1000 & FractionOfRewardsForPool = 60%

        we play the following scenario:
        block 310 - alice deposit 10 LP
        block 314 - bob deposits 20 LP
         => alice rewards : 1 * 4 * 1000 * 0.6
        block 318 - carol deposits 20 LPs
         => alice rewards = prevRewards + 1/3 * 4 * 1000 * 0.6
            bob rewards = 2/3 * 4 * 1000 * 0.6
         ....
     */
    const beetsPerBlock = bn(6)
    const chef = await deployChef(beets.address, treasury.address, beetsPerBlock, 300)
    await beets.transferOwnership(chef.address)

    const lpRewards = rewardsCalculator(beetsPerBlock, lpPercentage)
    const treasuryRewards = rewardsCalculator(beetsPerBlock, treasuryPercentage)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)
    await lp.transfer(alice.address, "1000")
    await lp.transfer(bob.address, "1000")
    await lp.transfer(carol.address, "1000")

    await chef.add("100", lp.address, ethers.constants.AddressZero)

    await lp.connect(alice).approve(chef.address, bn(1000))
    await lp.connect(bob).approve(chef.address, bn(1000))
    await lp.connect(carol).approve(chef.address, bn(1000))
    await advanceBlockTo("309")

    // Alice deposits 10 LPs at block 310
    await chef.connect(alice).deposit(0, "10", alice.address)

    await advanceBlockTo("312")
    await chef.connect(alice).harvest(0, alice.address) // block 313
    expect(await beets.balanceOf(alice.address)).to.equal(lpRewards(3))
    // Bob deposits 20 LPs at block 314

    await chef.connect(bob).deposit(0, "20", bob.address) //314
    await advanceBlockTo("315")

    // we disable automine so we can do both harvest calls in 1 block
    await setAutomineBlocks(false)

    await chef.connect(alice).harvest(0, alice.address) // block 316
    await chef.connect(bob).harvest(0, bob.address) // block 316

    await advanceBlockTo("316")
    await setAutomineBlocks(true)
    // alice should have 4 * bPB * lpPc + 2 * bPb / 3 * lpPc
    const aliceBalance316 = lpRewards(4).add(lpRewards(2).div(3))
    expect(await beets.balanceOf(alice.address)).to.equal(aliceBalance316)
    // bob should have  2 * bPb * (2 / 3) * lpPerc
    const bobBalance316 = lpRewards(2).mul(2).div(3)
    expect(await beets.balanceOf(bob.address)).to.equal(bobBalance316)

    // Carol deposits 30 LPs at block 318
    await chef.connect(carol).deposit(0, "30", carol.address) // block 317
    await advanceBlockTo("319")

    await chef.connect(alice).harvest(0, alice.address) // block 320

    /*
      alice (all harvested):
        preVal + 1 block with 1/3 rewards + 3 blocks 1/6 of the rewards

     bob (only preVal harvested, rest pending on master chef):
      preVal + 1 block with 2/3 rewards + 3 blocks 2/6 rewards

     carol (everything pending on master chef):
        3 blocks with 3/6 rewards
   */

    expect(await beets.totalSupply()).to.equal(beetsPerBlock.mul(10))

    // console.log("current balance", aliceBalance.toString())
    const aliceBalance320 = aliceBalance316.add(lpRewards(1).div(3)).add(lpRewards(3).div(6))

    expect(await beets.balanceOf(alice.address)).to.equal(aliceBalance320)

    // bob should still only have his 800 from the last harvest
    expect(await beets.balanceOf(bob.address)).to.equal(bobBalance316)
    expect(await chef.pendingBeets(0, bob.address)).to.equal(lpRewards(1).mul(2).div(3).add(lpRewards(3).mul(2).div(6)))
    // carol has harvested nothing yet
    expect(await beets.balanceOf(carol.address)).to.equal(0)

    const carolPending320 = lpRewards(3).div(2)
    expect(await chef.pendingBeets(0, carol.address)).to.equal(carolPending320)
    // all unharvested rewards are on the chef => total supply - alice balance - bob balance - dev balance - treasury balance
    const treasuryBalance = treasuryRewards(10)

    expect(await beets.balanceOf(chef.address)).to.equal(beetsPerBlock.mul(10).sub(aliceBalance320).sub(bobBalance316).sub(treasuryBalance))

    expect(await beets.balanceOf(treasury.address)).to.equal(treasuryBalance)

    // alice deposits 10 more LP's
    await chef.connect(alice).deposit(0, "10", alice.address) // block 321
    await advanceBlockTo("329")

    // Bob withdraws 5 LPs
    await chef.connect(bob).withdrawAndHarvest(0, "5", bob.address) // block 330

    /*
      alice (parts harvested, parts pending):
        preVal(harvested) + 1 block 1/6 of the rewards + 9 blocks 2/7 of the rewards (pending)

     bob (all harvested):
      preVal + 1 block 2/6 rewards + 9 blocks 2/7 rewards

     carol (everything pending on master chef):
      preval + 1 block 3/6 rewards + 9 blocks 3/7 rewards
   */

    expect(await beets.totalSupply()).to.equal(beetsPerBlock.mul(20))

    expect(await beets.balanceOf(alice.address)).to.equal(aliceBalance320)

    const bobBalance330 = bobBalance316
      .add(lpRewards(1).mul(2).div(3))
      .add(lpRewards(3).mul(2).div(6))
      .add(lpRewards(1).mul(2).div(6))
      .add(lpRewards(9).mul(2).div(7))

    expect(await beets.balanceOf(bob.address)).to.equal(bobBalance330)
    expect(await beets.balanceOf(carol.address)).to.equal(0)

    const carolPending330 = carolPending320.add(lpRewards(1).div(2)).add(lpRewards(9).mul(3).div(7))
    expect(await chef.pendingBeets(0, carol.address)).to.equal(carolPending330)

    const treasuryBalance330 = percentageOf(beetsPerBlock.mul(20), treasuryPercentage)
    expect(await beets.balanceOf(chef.address)).to.equal(beetsPerBlock.mul(20).sub(aliceBalance320).sub(bobBalance330).sub(treasuryBalance330))

    expect(await beets.balanceOf(treasury.address)).to.equal(treasuryBalance330)

    await advanceBlockTo("339")
    // we only withdraw but dont harvest
    await chef.connect(alice).withdrawAndHarvest(0, 20, alice.address) // block 340
    /*
      alice (all harvested):
        preVal + 10 blocks 4/13 of the rewards
    */
    const aliceBalance340 = aliceBalance320.add(lpRewards(1).div(6)).add(lpRewards(9).mul(2).div(7)).add(lpRewards(10).mul(4).div(13))
    expect(await beets.balanceOf(alice.address)).to.equal(aliceBalance340)

    await advanceBlockTo("349")

    await chef.connect(bob).withdrawAndHarvest(0, 15, bob.address) // block 350
    /*
      bob (all harvested):
        bal330 + 10 blocks 3/13 of the rewards + 10 blocks 1/3 of rewards
    */

    // we have to subtract 1 cause of rounding errors
    expect(await beets.balanceOf(bob.address)).to.equal(bobBalance330.add(lpRewards(10).mul(3).div(13)).add(lpRewards(10).div(3)).sub(1))

    await advanceBlockTo("359")

    await chef.connect(carol).withdrawAndHarvest(0, 30, carol.address) // block 360
    /*
      carol (all harvested):
        preVal + 10 blocks 6/13 of the rewards + 10 blocks 7/10 of rewards + 10 blocks 10/10 of rewards
    */
    expect(await beets.balanceOf(carol.address)).to.equal(
      carolPending330.add(lpRewards(10).mul(6).div(13)).add(lpRewards(10).mul(2).div(3)).add(lpRewards(10))
    )

    expect(await beets.totalSupply()).to.equal(beetsPerBlock.mul(50))
    expect(await beets.balanceOf(treasury.address)).to.equal(treasuryRewards(50))
    // All of them should have 1000 LPs back.
    expect(await lp.balanceOf(alice.address)).to.equal(1000)
    expect(await lp.balanceOf(bob.address)).to.equal(1000)
    expect(await lp.balanceOf(carol.address)).to.equal(1000)
  })

  it("gives correct BEETS allocation to each pool", async function () {
    const beetsPerBlock = bn(6)
    const chef = await deployChef(beets.address, treasury.address, beetsPerBlock, 100)
    await beets.transferOwnership(chef.address)

    const lpRewards = rewardsCalculator(beetsPerBlock, lpPercentage)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)
    const lp2 = await deployERC20Mock("Lp 2", "lp2", 10_000)

    await lp.transfer(alice.address, "1000")
    await lp2.transfer(bob.address, "1000")

    await lp.connect(alice).approve(chef.address, "1000")
    await lp2.connect(bob).approve(chef.address, "1000")
    // Add first LP to the pool with allocation 1
    await chef.add("10", lp.address, ethers.constants.AddressZero)
    // Alice deposits 10 LPs at block 410
    await advanceBlockTo("409")
    await chef.connect(alice).deposit(0, "10", alice.address)
    await advanceBlockTo("419")

    // Add LP2 to the pool with allocation 2 at block 420
    await chef.add("30", lp2.address, ethers.constants.AddressZero) // 420
    const alicePending420 = lpRewards(10)
    expect(await chef.pendingBeets(0, alice.address)).to.equal(alicePending420)

    // Bob deposits 10 LP2s at block 425
    await advanceBlockTo("424")
    await chef.connect(bob).deposit(1, "10", bob.address)
    // Alice should have alicePending420 + 5 blocks 1/4 of rewards
    const alicePendingBeets425 = alicePending420.add(lpRewards(5).div(4))
    expect(await chef.pendingBeets(0, alice.address)).to.equal(alicePendingBeets425)
    await advanceBlockTo("430")
    // At block 430. Bob should get 5*3/4 of rewards
    expect(await chef.pendingBeets(0, alice.address)).to.equal(alicePendingBeets425.add(lpRewards(5).div(4)))
    expect(await chef.pendingBeets(1, bob.address)).to.equal(lpRewards(5).mul(3).div(4))
  })

  it("reverts when trying to withdraw more than deposited", async () => {
    const beetsPerBlock = bn(6)
    const chef = await deployChef(beets.address, treasury.address, beetsPerBlock, 300)
    await beets.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)
    await lp.transfer(alice.address, "1000")

    await chef.add("100", lp.address, ethers.constants.AddressZero)

    await lp.connect(alice).approve(chef.address, bn(1000))

    await chef.connect(alice).deposit(0, 10, alice.address)
    await expect(chef.withdrawAndHarvest(0, 11, alice.address)).to.be.reverted
    expect(await lp.balanceOf(chef.address)).to.equal(10)
  })

  it("allows harvesting from all specified pools", async () => {
    const beetsPerBlock = bn(6)
    const lpRewards = rewardsCalculator(beetsPerBlock, lpPercentage)
    const chef = await deployChef(beets.address, treasury.address, beetsPerBlock, 300)
    await beets.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)
    const lp2 = await deployERC20Mock("Lp 2", "lp2", 10_000)
    const lp3 = await deployERC20Mock("Lp 3", "lp3", 10_000)
    const lp4 = await deployERC20Mock("Lp 4", "lp4", 10_000)

    await lp.transfer(alice.address, "1000")
    await lp2.transfer(alice.address, "1000")
    await lp3.transfer(alice.address, "1000")
    await lp4.transfer(bob.address, "1000")

    await chef.add("100", lp.address, ethers.constants.AddressZero)
    await chef.add("100", lp2.address, ethers.constants.AddressZero)
    await chef.add("100", lp3.address, ethers.constants.AddressZero)
    await chef.add("100", lp4.address, ethers.constants.AddressZero)

    await setAutomineBlocks(false)
    await lp.connect(alice).approve(chef.address, bn(1000))
    await chef.connect(alice).deposit(0, 10, alice.address)
    await lp2.connect(alice).approve(chef.address, bn(1000))
    await chef.connect(alice).deposit(1, 10, alice.address)
    await lp3.connect(alice).approve(chef.address, bn(1000))
    await chef.connect(alice).deposit(2, 10, alice.address)
    await lp4.connect(bob).approve(chef.address, bn(1000))
    await chef.connect(bob).deposit(3, 10, bob.address)
    await setAutomineBlocks(true)

    await advanceBlockTo(((await ethers.provider.getBlockNumber()) + 10).toString())

    const expectedBeets = lpRewards(10).mul(2).div(4)

    await chef.connect(alice).harvestAll([0, 1], alice.address)
    expect(await beets.balanceOf(alice.address)).to.equal(expectedBeets)
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
