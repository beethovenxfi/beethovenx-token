import { expect, assert } from "chai"
import {
  advanceBlockTo,
  advanceBlock,
  getBigNumber,
  ADDRESS_ZERO,
  deployContract,
  deployERC20Mock,
  deployChef,
  setAutomineBlocks,
} from "./utilities"
import { ethers, network } from "hardhat"
import { BeethovenxMasterChef, BeethovenxToken, ERC20Mock, RewarderMock } from "../types"
import { Signer } from "ethers"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { executionAsyncId } from "async_hooks"
import { getSigner } from "@nomiclabs/hardhat-ethers/internal/helpers"

describe("BeethovenxMasterChef", function () {
  let beetx: BeethovenxToken
  let owner: SignerWithAddress
  let dev: SignerWithAddress
  let treasury: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    dev = signers[1]
    treasury = signers[2]
    alice = signers[3]
    bob = signers[4]
    carol = signers[5]
  })

  beforeEach(async function () {
    beetx = await deployContract("BeethovenxToken", [])
  })
  it("reverts contract creation if dev and treasury percents don't meet criteria", async function () {
    // Invalid dev percent failure
    await expect(deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 1100, 200)).to.be.revertedWith(
      "constructor: invalid dev percent value"
    )

    // Invalid treasury percent failure
    await expect(deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 1100)).to.be.revertedWith(
      "constructor: invalid treasury percent value"
    )

    // Invalid treasury percent failure
    await expect(deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 300, 800)).to.be.revertedWith(
      "constructor: total percent over max"
    )
  })
  it("checks dev & treasury percents are set correctly", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    await chef.setDevPercent(100)
    await chef.setTreasuryPercent(100)
    expect(await chef.devPercent()).to.equal("100")
    expect(await chef.treasuryPercent()).to.equal("100")
    // We don't test negative values because function only takes in unsigned ints
    await expect(chef.setDevPercent("1200")).to.be.revertedWith("setDevPercent: invalid percent value")
    await expect(chef.setDevPercent("950")).to.be.revertedWith("setDevPercent: total percent over max")
    await expect(chef.setTreasuryPercent("1200")).to.be.revertedWith("setTreasuryPercent: invalid percent value")
    await expect(chef.setTreasuryPercent("950")).to.be.revertedWith("setTreasuryPercent: total percent over max")
  })

  it("should allow dev & treasury address to update themselves", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    expect(await chef.devAddress()).to.equal(dev.address)

    await expect(chef.connect(bob).dev(bob.address)).to.be.revertedWith("dev: wut?")
    await chef.connect(dev).dev(bob.address)
    expect(await chef.devAddress()).to.equal(bob.address)

    await expect(chef.connect(bob).treasury(bob.address)).to.be.revertedWith("setTreasuryAddress: wut?")
    await chef.connect(treasury).treasury(bob.address)
    expect(await chef.treasuryAddress()).to.equal(bob.address)
  })

  it("sets correct state variables", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const beetxAddress = await chef.beetx()
    const devAddress = await chef.devAddress()
    const treasuryAddress = await chef.treasuryAddress()
    const ownerAddress = await beetx.owner()

    expect(beetxAddress).to.equal(beetx.address)
    expect(devAddress).to.equal(dev.address)
    expect(treasuryAddress).to.equal(treasury.address)
    expect(ownerAddress).to.equal(chef.address)
  })

  it("allows only the dev address to change the dev address", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    await expect(chef.dev(bob.address)).to.be.revertedWith("dev: wut?")

    await chef.connect(dev).dev(bob.address)
    expect(await chef.devAddress()).to.equal(bob.address)

    await chef.connect(bob).dev(alice.address)
    expect(await chef.devAddress()).to.equal(alice.address)
  })

  it("returns amount of pools", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    const lp2Token = await deployERC20Mock("LP Token 2", "LPT2", 10)

    await chef.add(10, lp1Token.address, ethers.constants.AddressZero)
    await chef.add(10, lp2Token.address, ethers.constants.AddressZero)
    expect(await chef.poolLength()).to.be.equal(2)
  })

  it("updates pool with allocation point and rewarder", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

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
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    let err
    try {
      await chef.set(0, 10, ethers.constants.AddressZero, false)
    } catch (e) {
      err = e
    }
    expect(err).to.exist
  })

  it("reverts when adding an lp token which was already added", async () => {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    await lp1Token.transfer(alice.address, 10)

    await chef.add(10, lp1Token.address, ethers.constants.AddressZero)

    await expect(chef.add(10, lp1Token.address, ethers.constants.AddressZero)).to.be.revertedWith("add: LP already added")
  })

  it("reverts when adding a pool with an LP token address which is not a contract", async () => {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    await expect(chef.add(10, carol.address, ethers.constants.AddressZero)).to.be.revertedWith("add: LP token must be a valid contract")
  })

  it("reverts when adding a pool with a rewarder address which is not a contract", async () => {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    await lp1Token.transfer(alice.address, 10)

    await expect(chef.add(10, lp1Token.address, carol.address)).to.be.revertedWith("add: rewarder must be contract or zero")
  })

  it("returns pending beethovnx", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    await lp1Token.transfer(alice.address, 10)

    await chef.add(10, lp1Token.address, ethers.constants.AddressZero)

    await lp1Token.connect(alice).approve(chef.address, 10)

    const depositionPoint = await chef.connect(alice).deposit(0, 1, alice.address)
    await advanceBlockTo((depositionPoint.blockNumber! + 9).toString())
    await chef.updatePool(0)
    expect(await chef.pendingBeetx(0, alice.address)).to.equal(10 * 1000 * 0.6)
  })

  it("allows emergency withdraw", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 0, 200, 200)
    await beetx.transferOwnership(chef.address)

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
    // 100 per block farming rate starting at block 100
    // we give 20% to devs & 20% to treasury, so 60% are distributed to lp holders
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 150, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)

    // we give bob some lp's and approve it so we can deposit it to the pool
    await lp.transfer(bob.address, "1000")
    await lp.connect(bob).approve(chef.address, "1000")

    await chef.add("100", lp.address, ethers.constants.AddressZero)

    await chef.connect(bob).deposit(0, "100", bob.address)
    await advanceBlockTo("110")

    await chef.updatePool(0)
    expect(await beetx.balanceOf(bob.address)).to.equal("0")
    await advanceBlockTo("120")

    await chef.updatePool(0)
    expect(await beetx.balanceOf(bob.address)).to.equal("0")
    await advanceBlockTo("130")

    await chef.updatePool(0) // block 100
    expect(await beetx.balanceOf(bob.address)).to.equal("0")
    await advanceBlockTo("150")

    await chef.connect(bob).harvest(0, bob.address)
    expect(await beetx.balanceOf(bob.address)).to.equal(1000 * 0.6)
    expect(await beetx.balanceOf(dev.address)).to.equal(1000 * 0.2)
    expect(await beetx.balanceOf(treasury.address)).to.equal(1000 * 0.2)
    expect(await beetx.totalSupply()).to.equal(1000)

    await advanceBlockTo("154")

    await chef.connect(bob).harvest(0, bob.address) // block 105
    expect(await beetx.balanceOf(bob.address)).to.equal(1000 * 5 * 0.6)
    expect(await beetx.balanceOf(dev.address)).to.equal(1000 * 5 * 0.2)
    expect(await beetx.balanceOf(treasury.address)).to.equal(1000 * 5 * 0.2)
    expect(await beetx.totalSupply()).to.equal(1000 * 5)
  })

  it("does not distribute BEETX's if no one deposits", async function () {
    // 100 per block farming rate starting at block 100
    // we give 20% to devs & 20% to treasury, so 60% are distributed to lp holders
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 100, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)

    await chef.add("100", lp.address, ethers.constants.AddressZero)

    await advanceBlockTo("199")
    expect(await beetx.totalSupply()).to.equal("0")
    await advanceBlockTo("204")
    expect(await beetx.totalSupply()).to.equal("0")
    await advanceBlockTo("209")
  })

  it("distributes BEETX properly for each staker", async function () {
    // 100 per block farming rate starting at block 300
    // we give 20% to devs & 20% to treasury, so 60% are distributed to lp holders

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
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 300, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)
    await lp.transfer(alice.address, "1000")
    await lp.transfer(bob.address, "1000")
    await lp.transfer(carol.address, "1000")

    await chef.add("100", lp.address, ethers.constants.AddressZero)

    await lp.connect(alice).approve(chef.address, "1000")
    await lp.connect(bob).approve(chef.address, "1000")
    await lp.connect(carol).approve(chef.address, "1000")
    await advanceBlockTo("309")
    // Alice deposits 10 LPs at block 310
    await chef.connect(alice).deposit(0, "10", alice.address)
    await advanceBlockTo("312")
    await chef.connect(alice).harvest(0, alice.address) // block 313
    expect(await beetx.balanceOf(alice.address)).to.equal(3 * 1000 * 0.6)
    // Bob deposits 20 LPs at block 314

    await chef.connect(bob).deposit(0, "20", bob.address) //314
    await advanceBlockTo("315")

    // we disable automine so we can do both harvest calls in 1 block
    await setAutomineBlocks(false)

    await chef.connect(alice).harvest(0, alice.address) // block 316
    await chef.connect(bob).harvest(0, bob.address) // block 316

    await advanceBlockTo("316")
    await setAutomineBlocks(true)
    // expect(await beetx.balanceOf(alice.address)).to.equal(4 * 1000 * 0.6 + (1000 / 3) * 0.6))
    // alice should have 4 * 1000 * 0.6 + 2* 1000 / 3 * 0.6 = 2800
    expect(await beetx.balanceOf(alice.address)).to.equal(2800)
    // bob should have  2 * 1000 * (2 / 3) * 0.6 = 800
    expect(await beetx.balanceOf(bob.address)).to.equal(800)

    // Carol deposits 30 LPs at block 318
    await chef.connect(carol).deposit(0, "30", carol.address) // block 317
    await advanceBlockTo("319")

    await chef.connect(alice).harvest(0, alice.address) // block 320
    // await chef.connect(bob).harvest(0, alice.address) // block 320
    // await chef.connect(carol).harvest(0, alice.address) // block 320

    /*
      alice (all harvested):
        preVal + 1 block with 1/3 rewards + 3 blocks 1/6 of the rewards
        2800 + (1 * 1000 * 1/3 * 0.6) + (3 * 1000 * 1/6 * 0.6) = 3300

     bob (only preVal harvested, rest pending on master chef):
      preVal + 1 block with 2/3 rewards + 3 blocks 2/6 rewards
      prevVal: 800  |||  pending:  (1 * 1000 * 2/3 * 0.6) + ( 3 * 1000 * 2/6 * 0.6) = 1000 (total: 1800)

     carol (everything pending on master chef):
        3 blocks with 3/6 rewards
        pending: 3 * 1000 * 3/6 * 0.6 = 900
   */

    expect(await beetx.totalSupply()).to.equal(10_000)
    expect(await beetx.balanceOf(alice.address)).to.equal(3300)
    // bob should still only have his 800 from the last harvest
    expect(await beetx.balanceOf(bob.address)).to.equal(800)
    // carol has harvested nothing yet
    expect(await beetx.balanceOf(carol.address)).to.equal(0)
    // all unharvested rewards are on the chef => total supply - alice balance - bob balance - dev balance - treasury balance
    expect(await beetx.balanceOf(chef.address)).to.equal(10_000 - 3300 - 800 - 2000 - 2000)

    // 20% of all token rewards should have gone to dev
    expect(await beetx.balanceOf(dev.address)).to.equal(2000)

    // 20% of all token rewards should have gone to treasury
    expect(await beetx.balanceOf(treasury.address)).to.equal(2000)

    // alice deposits 10 more LP's
    await chef.connect(alice).deposit(0, "10", alice.address) // block 321
    await advanceBlockTo("329")

    // Bob withdraws 5 LPs
    await chef.connect(bob).withdrawAndHarvest(0, "5", bob.address) // block 330

    /*
      alice (parts harvested, parts pending):
        preVal + 1 block 1/6 of the rewards + 9 blocks 2/7 of the rewards
        harvested: 3300 ||  pending: 1 * 1000 * 1/6 * 0.6 + 9 * 1000 * 2/7 * 0.6 = 1642.857142857142857142 (total: 4942.857142857142857142)

     bob (all harvested):
      preVal + 1 block 2/6 rewards + 9 blocks 2/7 rewards
      harvested: 1800 + 1 * 1000 * 2/6 * 0.6 + 9 * 1000 * 2/7 * 0.6 = 3542.857142857142857142

     carol (everything pending on master chef):
      preval + 10 blocks 3/6 rewards
      pending: 900 + 1 * 1000 * 3/6 * 0.6 + 9 * 1000 * 3/7 * 0.6 = 3514.285714285714 => 3514
   */

    // take note that the decimals are just cut off (we are not adding the precision cause of javascript overflows of the number
    expect(await beetx.totalSupply()).to.equal(20_000)
    expect(await beetx.balanceOf(alice.address)).to.equal(3300)
    expect(await beetx.balanceOf(bob.address)).to.equal(3542)
    expect(await beetx.balanceOf(carol.address)).to.equal(0)
    expect(await beetx.balanceOf(chef.address)).to.equal(5158)
    expect(await beetx.balanceOf(dev.address)).to.equal(4000)
    expect(await beetx.balanceOf(treasury.address)).to.equal(4000)

    await advanceBlockTo("339")
    // we only withdraw but dont harvest
    await chef.connect(alice).withdrawAndHarvest(0, 20, alice.address) // block 340
    /*
      alice (all harvested):
        preVal + 10 blocks 4/13 of the rewards
        4942.857142857142857142 +  10 * 1000 * 4/13 * 0.6 = 6789.010989010989010988153846 => 6789
    */
    expect(await beetx.balanceOf(alice.address)).to.equal(6789)
    // await chef.connect(alice).harvest(0, alice.address) // block 340

    // expect(await beetx.balanceOf(alice.address)).to.equal(6788)

    await advanceBlockTo("349")

    await chef.connect(bob).withdrawAndHarvest(0, 15, bob.address) // block 350
    /*
      bob (all harvested):
        preVal + 10 blocks 3/13 of the rewards + 10 blocks 1/3 of rewards
         3542 + 10 * 1000 * 3/13 * 0.6 + 10 * 1000 * 1/3 * 0.6 = 6926.47252747 => 6926
    */

    expect(await beetx.balanceOf(bob.address)).to.equal(6926)

    await advanceBlockTo("359")

    await chef.connect(carol).withdrawAndHarvest(0, 30, carol.address) // block 360
    /*
      carol (all harvested):
        preVal + 10 blocks 6/13 of the rewards + 10 blocks 7/10 of rewards + 10 blocks 10/10 of rewards
        3514 + 10 * 1000 * 6/13 * 0.6 + 10 * 1000 * 2/3 * 0.6 + 10 * 1000 * 0.6 = 16283.23076923077 => 16283
    */
    expect(await beetx.balanceOf(carol.address)).to.equal(16283)

    expect(await beetx.totalSupply()).to.equal(50_000)
    expect(await beetx.balanceOf(dev.address)).to.equal(10_000)
    expect(await beetx.balanceOf(treasury.address)).to.equal(10_000)
    // All of them should have 1000 LPs back.
    expect(await lp.balanceOf(alice.address)).to.equal(1000)
    expect(await lp.balanceOf(bob.address)).to.equal(1000)
    expect(await lp.balanceOf(carol.address)).to.equal(1000)
  })

  it("gives correct BEETX allocation to each pool", async function () {
    /*
      1000 beetx per block, start block 100, 20% dev & treadury each
     */
    const chef = await deployChef(beetx.address, dev.address, treasury.address, 1000, 100, 200, 200)
    await beetx.transferOwnership(chef.address)

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
    // Add LP2 to the pool with allocation 2 at block 420
    await advanceBlockTo("419")
    // await setAutomineBlocks(false)
    // await chef.updatePool(0)
    await chef.add("30", lp2.address, ethers.constants.AddressZero) // 420
    expect(await chef.pendingBeetx(0, alice.address)).to.equal(6000)
    // Bob deposits 10 LP2s at block 425
    await advanceBlockTo("424")
    await chef.connect(bob).deposit(1, "5", bob.address)
    // Alice should have 6000 + 5*1/4*1000 * 0.6 = 7000 pending reward
    expect(await chef.pendingBeetx(0, alice.address)).to.equal(6750)
    await advanceBlockTo("430")
    // At block 430. Bob should get 5*3/4*1000 * 0.6 = 2000.
    // Alice 6750 + 5 * 1/4 * 1000 * 0.6 = 8000
    expect(await chef.pendingBeetx(0, alice.address)).to.equal(7500)
    expect(await chef.pendingBeetx(1, bob.address)).to.equal(2250)
  })
})
