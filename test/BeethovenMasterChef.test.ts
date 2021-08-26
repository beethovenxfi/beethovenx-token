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

  it("sets correct state variables", async function () {
    const beetx = await deployContract<BeethovenxToken>("BeethovenxToken", [])
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const beetxAddress = await chef.beetx()
    const devAddress = await chef.devaddr()
    const treasuryAddress = await chef.treasuryaddr()
    const ownerAddress = await beetx.owner()

    expect(beetxAddress).to.equal(beetx.address)
    expect(devAddress).to.equal(dev.address)
    expect(treasuryAddress).to.equal(treasury.address)
    expect(ownerAddress).to.equal(chef.address)
  })

  it("allows only the dev address to change the dev address", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    await expect(chef.dev(bob.address)).to.be.revertedWith("dev: wut?")

    await chef.connect(dev).dev(bob.address)
    expect(await chef.devaddr()).to.equal(bob.address)

    await chef.connect(bob).dev(alice.address)
    expect(await chef.devaddr()).to.equal(alice.address)
  })

  it("returns amount of active pools", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    const lp2Token = await deployERC20Mock("LP Token 2", "LPT2", 10)

    await chef.add(10, lp1Token.address, ethers.constants.AddressZero)
    await chef.add(10, lp2Token.address, ethers.constants.AddressZero)
    expect(await chef.poolLength()).to.be.equal(2)
  })

  it("emits event LogSetPool event", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const rewarderToken = await deployERC20Mock("RewarderToken", "RT1", 10)
    const rewarder = await deployContract<RewarderMock>("RewarderMock", [getBigNumber(1), rewarderToken.address, chef.address])

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)
    const lp2Token = await deployERC20Mock("LP Token 2", "LPT2", 10)

    await chef.add(10, lp1Token.address, rewarder.address)
    await chef.add(10, lp2Token.address, rewarder.address)
    await expect(chef.set(0, 10, ethers.constants.AddressZero, false)).to.emit(chef, "LogSetPool").withArgs(0, 10, rewarder.address, false)

    const dummyAddressForRewarder = (await ethers.getSigners())[10]

    await expect(chef.set(0, 10, dummyAddressForRewarder.address, true))
      .to.emit(chef, "LogSetPool")
      .withArgs(0, 10, dummyAddressForRewarder.address, true)
  })

  it("reverts in case of updating a pool with an invalid pid", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    let err
    try {
      await chef.set(0, 10, ethers.constants.AddressZero, false)
    } catch (e) {
      err = e
    }
    expect(err).to.exist
  })

  it("returns pending beethovnx", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 0, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp1Token = await deployERC20Mock("LP Token 1", "LPT1", 10)

    await chef.add(10, lp1Token.address, ethers.constants.AddressZero)

    await lp1Token.approve(chef.address, getBigNumber(10))

    await this.chef2.add(10, this.rlp.address, this.rewarder.address)
    await this.rlp.approve(this.chef2.address, getBigNumber(10))

    let log = await this.chef2.deposit(0, getBigNumber(1), this.alice.address)
    await advanceBlock()
    let log2 = await this.chef2.updatePool(0)
    await advanceBlock()
    let expectedSushi = getBigNumber(100)
      .mul(log2.blockNumber + 1 - log.blockNumber)
      .div(2)
    let pendingSushi = await this.chef2.pendingSushi(0, this.alice.address)
    expect(pendingSushi).to.be.equal(expectedSushi)
  })

  it("allows emergency withdraw", async function () {
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 0, 200, 200)
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

    await chef.connect(bob).emergencyWithdraw(0, bob.address)
    expect(await lp.balanceOf(bob.address)).to.equal("1000")
  })

  it("starts giving out rewards only after the start block has been reached", async function () {
    // 100 per block farming rate starting at block 100
    // we give 20% to devs & 20% to treasury, so 60% are distributed to lp holders
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 100, 200, 200)
    await beetx.transferOwnership(chef.address)

    const lp = await deployERC20Mock("Lp 1", "lp1", 10_000)

    // we give bob some lp's and approve it so we can deposit it to the pool
    await lp.transfer(bob.address, "1000")
    await lp.connect(bob).approve(chef.address, "1000")

    await chef.add("100", lp.address, ethers.constants.AddressZero)

    await chef.connect(bob).deposit(0, "100", bob.address)
    await advanceBlockTo("89")

    await chef.updatePool(0)
    expect(await beetx.balanceOf(bob.address)).to.equal("0")
    await advanceBlockTo("94")

    await chef.updatePool(0)
    expect(await beetx.balanceOf(bob.address)).to.equal("0")
    await advanceBlockTo("99")

    await chef.updatePool(0) // block 100
    expect(await beetx.balanceOf(bob.address)).to.equal("0")
    await advanceBlockTo("100")

    await chef.connect(bob).harvest(0, bob.address)
    expect(await beetx.balanceOf(bob.address)).to.equal(getBigNumber(1000 * 0.6))
    expect(await beetx.balanceOf(dev.address)).to.equal(getBigNumber(1000 * 0.2))
    expect(await beetx.balanceOf(treasury.address)).to.equal(getBigNumber(1000 * 0.2))
    expect(await beetx.totalSupply()).to.equal(getBigNumber(1000))

    await advanceBlockTo("104")

    await chef.connect(bob).harvest(0, bob.address) // block 105
    expect(await beetx.balanceOf(bob.address)).to.equal(getBigNumber(1000 * 5 * 0.6))
    expect(await beetx.balanceOf(dev.address)).to.equal(getBigNumber(1000 * 5 * 0.2))
    expect(await beetx.balanceOf(treasury.address)).to.equal(getBigNumber(1000 * 5 * 0.2))
    expect(await beetx.totalSupply()).to.equal(getBigNumber(1000 * 5))
  })

  it("does not distribute BEETX's if no one deposits", async function () {
    // 100 per block farming rate starting at block 100
    // we give 20% to devs & 20% to treasury, so 60% are distributed to lp holders
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 100, 200, 200)
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
    const chef = await deployChef(beetx.address, dev.address, treasury.address, getBigNumber(1000), 300, 200, 200)
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
    expect(await beetx.balanceOf(alice.address)).to.equal(getBigNumber(3 * 1000 * 0.6))
    // Bob deposits 20 LPs at block 314

    await chef.connect(bob).deposit(0, "20", bob.address) //314
    await advanceBlockTo("315")

    // we disable automine so we can do both harvest calls in 1 block
    await setAutomineBlocks(false)

    await chef.connect(alice).harvest(0, alice.address) // block 316
    await chef.connect(bob).harvest(0, bob.address) // block 316

    await advanceBlockTo("316")
    await setAutomineBlocks(true)
    // expect(await beetx.balanceOf(alice.address)).to.equal(getBigNumber(4 * 1000 * 0.6 + (1000 / 3) * 0.6))
    // alice should have 4 * 1000 * 0.6 + 2* 1000 / 3 * 0.6 = 2800
    expect(await beetx.balanceOf(alice.address)).to.equal(getBigNumber(2800))
    // bob should have  2 * 1000 * (2 / 3) * 0.6 = 800
    expect(await beetx.balanceOf(bob.address)).to.equal(getBigNumber(800))

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

    expect(await beetx.totalSupply()).to.equal(getBigNumber(10_000))
    expect(await beetx.balanceOf(alice.address)).to.equal(getBigNumber(3300))
    // bob should still only have his 800 from the last harvest
    expect(await beetx.balanceOf(bob.address)).to.equal(getBigNumber(800))
    // carol has harvested nothing yet
    expect(await beetx.balanceOf(carol.address)).to.equal(0)
    // all unharvested rewards are on the chef => total supply - alice balance - bob balance - dev balance - treasury balance
    expect(await beetx.balanceOf(chef.address)).to.equal(getBigNumber(10_000 - 3300 - 800 - 2000 - 2000))

    // 20% of all token rewards should have gone to dev
    expect(await beetx.balanceOf(dev.address)).to.equal(getBigNumber(2000))

    // 20% of all token rewards should have gone to treasury
    expect(await beetx.balanceOf(treasury.address)).to.equal(getBigNumber(2000))

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
      pending: 900 + 10 * 1000 * 3/6 * 0.6 = 3900
   */
    expect(await beetx.totalSupply()).to.equal(getBigNumber(20_000))
    expect(await beetx.balanceOf(alice.address)).to.equal(getBigNumber(3300))
    expect(await beetx.balanceOf(bob.address)).to.equal(getBigNumber(3542.857142857142857142))
    expect(await beetx.balanceOf(carol.address)).to.equal(getBigNumber(0))
    expect(await beetx.balanceOf(chef.address)).to.equal(getBigNumber(5157.142857142857142858))
    expect(await beetx.balanceOf(dev.address)).to.equal(getBigNumber(4000))
    expect(await beetx.balanceOf(treasury.address)).to.equal(getBigNumber(4000))

    //   Bob should have: 4*2/3*1000 + 2*2/6*1000 + 10*2/7*1000 = 6190
    // await advanceBlockTo("329")
    // expect(await this.sushi.totalSupply()).to.equal("22000")
    // expect(await this.sushi.balanceOf(this.alice.address)).to.equal("5666")
    // expect(await this.sushi.balanceOf(this.bob.address)).to.equal("6190")
    // expect(await this.sushi.balanceOf(this.carol.address)).to.equal("0")
    // expect(await this.sushi.balanceOf(this.chef.address)).to.equal("8144")
    // expect(await this.sushi.balanceOf(this.dev.address)).to.equal("2000")
    // Alice withdraws 20 LPs at block 340.
    // Bob withdraws 15 LPs at block 350.
    // Carol withdraws 30 LPs at block 360.
    // await advanceBlockTo("339")
    // await this.chef.connect(this.alice).withdraw(0, "20", { from: this.alice.address })
    // await advanceBlockTo("349")
    // await this.chef.connect(this.bob).withdraw(0, "15", { from: this.bob.address })
    // await advanceBlockTo("359")
    // await this.chef.connect(this.carol).withdraw(0, "30", { from: this.carol.address })
    // expect(await this.sushi.totalSupply()).to.equal("55000")
    // expect(await this.sushi.balanceOf(this.dev.address)).to.equal("5000")
    // // Alice should have: 5666 + 10*2/7*1000 + 10*2/6.5*1000 = 11600
    // expect(await this.sushi.balanceOf(this.alice.address)).to.equal("11600")
    // // Bob should have: 6190 + 10*1.5/6.5 * 1000 + 10*1.5/4.5*1000 = 11831
    // expect(await this.sushi.balanceOf(this.bob.address)).to.equal("11831")
    // // Carol should have: 2*3/6*1000 + 10*3/7*1000 + 10*3/6.5*1000 + 10*3/4.5*1000 + 10*1000 = 26568
    // expect(await this.sushi.balanceOf(this.carol.address)).to.equal("26568")
    // // All of them should have 1000 LPs back.
    // expect(await this.lp.balanceOf(this.alice.address)).to.equal("1000")
    // expect(await this.lp.balanceOf(this.bob.address)).to.equal("1000")
    // expect(await this.lp.balanceOf(this.carol.address)).to.equal("1000")
  })

  //
  //   describe("PendingSushi", function() {
  //     it("When block is lastRewardBlock", async function () {
  //       await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //       await this.rlp.approve(this.chef2.address, getBigNumber(10))
  //       let log = await this.chef2.deposit(0, getBigNumber(1), this.alice.address)
  //       await advanceBlockTo(3)
  //       let log2 = await this.chef2.updatePool(0)
  //       let expectedSushi = getBigNumber(100).mul(log2.blockNumber - log.blockNumber).div(2)
  //       let pendingSushi = await this.chef2.pendingSushi(0, this.alice.address)
  //       expect(pendingSushi).to.be.equal(expectedSushi)
  //     })
  //   })
  //
  //   describe("MassUpdatePools", function () {
  //     it("Should call updatePool", async function () {
  //       await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //       await advanceBlockTo(1)
  //       await this.chef2.massUpdatePools([0])
  //       //expect('updatePool').to.be.calledOnContract(); //not suported by heardhat
  //       //expect('updatePool').to.be.calledOnContractWith(0); //not suported by heardhat
  //
  //     })
  //
  //     it("Updating invalid pools should fail", async function () {
  //       let err;
  //       try {
  //         await this.chef2.massUpdatePools([0, 10000, 100000])
  //       } catch (e) {
  //         err = e;
  //       }
  //
  //       assert.equal(err.toString(), "Error: VM Exception while processing transaction: invalid opcode")
  //     })
  // })
  //
  //   describe("Add", function () {
  //     it("Should add pool with reward token multiplier", async function () {
  //       await expect(this.chef2.add(10, this.rlp.address, this.rewarder.address))
  //             .to.emit(this.chef2, "LogPoolAddition")
  //             .withArgs(0, 10, this.rlp.address, this.rewarder.address)
  //       })
  //   })
  //
  //   describe("UpdatePool", function () {
  //     it("Should emit event LogUpdatePool", async function () {
  //       await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //       await advanceBlockTo(1)
  //       await expect(this.chef2.updatePool(0))
  //             .to.emit(this.chef2, "LogUpdatePool")
  //             .withArgs(0, (await this.chef2.poolInfo(0)).lastRewardBlock,
  //               (await this.rlp.balanceOf(this.chef2.address)),
  //               (await this.chef2.poolInfo(0)).accSushiPerShare)
  //     })
  //
  //     it("Should take else path", async function () {
  //       await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //       await advanceBlockTo(1)
  //       await this.chef2.batch(
  //           [
  //               this.chef2.interface.encodeFunctionData("updatePool", [0]),
  //               this.chef2.interface.encodeFunctionData("updatePool", [0]),
  //           ],
  //           true
  //       )
  //     })
  //   })
  //
  //   describe("Deposit", function () {
  //     it("Depositing 0 amount", async function () {
  //       await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //       await this.rlp.approve(this.chef2.address, getBigNumber(10))
  //       await expect(this.chef2.deposit(0, getBigNumber(0), this.alice.address))
  //             .to.emit(this.chef2, "Deposit")
  //             .withArgs(this.alice.address, 0, 0, this.alice.address)
  //     })
  //
  //     it("Depositing into non-existent pool should fail", async function () {
  //       let err;
  //       try {
  //         await this.chef2.deposit(1001, getBigNumber(0), this.alice.address)
  //       } catch (e) {
  //         err = e;
  //       }
  //
  //       assert.equal(err.toString(), "Error: VM Exception while processing transaction: invalid opcode")
  //     })
  //   })
  //
  //   describe("Withdraw", function () {
  //     it("Withdraw 0 amount", async function () {
  //       await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //       await expect(this.chef2.withdraw(0, getBigNumber(0), this.alice.address))
  //             .to.emit(this.chef2, "Withdraw")
  //             .withArgs(this.alice.address, 0, 0, this.alice.address)
  //     })
  //   })
  //
  //   describe("Harvest", function () {
  //     it("Should give back the correct amount of SUSHI and reward", async function () {
  //         await this.r.transfer(this.rewarder.address, getBigNumber(100000))
  //         await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //         await this.rlp.approve(this.chef2.address, getBigNumber(10))
  //         expect(await this.chef2.lpToken(0)).to.be.equal(this.rlp.address)
  //         let log = await this.chef2.deposit(0, getBigNumber(1), this.alice.address)
  //         await advanceBlockTo(20)
  //         await this.chef2.harvestFromMasterChef()
  //         let log2 = await this.chef2.withdraw(0, getBigNumber(1), this.alice.address)
  //         let expectedSushi = getBigNumber(100).mul(log2.blockNumber - log.blockNumber).div(2)
  //         expect((await this.chef2.userInfo(0, this.alice.address)).rewardDebt).to.be.equal("-"+expectedSushi)
  //         await this.chef2.harvest(0, this.alice.address)
  //         expect(await this.sushi.balanceOf(this.alice.address)).to.be.equal(await this.r.balanceOf(this.alice.address)).to.be.equal(expectedSushi)
  //     })
  //     it("Harvest with empty user balance", async function () {
  //       await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //       await this.chef2.harvest(0, this.alice.address)
  //     })
  //
  //     it("Harvest for SUSHI-only pool", async function () {
  //       await this.chef2.add(10, this.rlp.address, ADDRESS_ZERO)
  //       await this.rlp.approve(this.chef2.address, getBigNumber(10))
  //       expect(await this.chef2.lpToken(0)).to.be.equal(this.rlp.address)
  //       let log = await this.chef2.deposit(0, getBigNumber(1), this.alice.address)
  //       await advanceBlock()
  //       await this.chef2.harvestFromMasterChef()
  //       let log2 = await this.chef2.withdraw(0, getBigNumber(1), this.alice.address)
  //       let expectedSushi = getBigNumber(100).mul(log2.blockNumber - log.blockNumber).div(2)
  //       expect((await this.chef2.userInfo(0, this.alice.address)).rewardDebt).to.be.equal("-"+expectedSushi)
  //       await this.chef2.harvest(0, this.alice.address)
  //       expect(await this.sushi.balanceOf(this.alice.address)).to.be.equal(expectedSushi)
  //     })
  //   })
  //
  //   describe("EmergencyWithdraw", function() {
  //     it("Should emit event EmergencyWithdraw", async function () {
  //       await this.r.transfer(this.rewarder.address, getBigNumber(100000))
  //       await this.chef2.add(10, this.rlp.address, this.rewarder.address)
  //       await this.rlp.approve(this.chef2.address, getBigNumber(10))
  //       await this.chef2.deposit(0, getBigNumber(1), this.bob.address)
  //       //await this.chef2.emergencyWithdraw(0, this.alice.address)
  //       await expect(this.chef2.connect(this.bob).emergencyWithdraw(0, this.bob.address))
  //       .to.emit(this.chef2, "EmergencyWithdraw")
  //       .withArgs(this.bob.address, 0, getBigNumber(1), this.bob.address)
  //     })
  //   })
})
