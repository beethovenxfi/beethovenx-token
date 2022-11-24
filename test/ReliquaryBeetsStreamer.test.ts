import { expect } from "chai"
import { ADDRESS_ZERO, advanceBlockTo, bn, deployChef, deployContract, getBlockTime } from "./utilities"
import { ethers } from "hardhat"
import { BeethovenxMasterChef, BeethovenxToken, BeetsConstantEmissionCurve, ERC20, ReliquaryMock, ReliquaryBeetsStreamer } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { keccak256 } from "ethers/lib/utils"
import moment from "moment"
import { mine } from "@nomicfoundation/hardhat-network-helpers"

describe("ReliquaryBeetsStreamer", function () {
  let beets: BeethovenxToken
  let curve: BeetsConstantEmissionCurve
  let reliquary: ReliquaryMock
  let poolToken: ERC20
  let owner: SignerWithAddress
  let dev: SignerWithAddress
  let treasury: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let streamer: ReliquaryBeetsStreamer
  let masterchef: BeethovenxMasterChef

  const requiredMaturity = [
    604800 * 0,
    604800 * 1,
    604800 * 2,
    604800 * 3,
    604800 * 4,
    604800 * 5,
    604800 * 6,
    604800 * 7,
    604800 * 8,
    604800 * 9,
    604800 * 10,
  ]

  const allocationPoints = [4, 25, 35, 40, 400, 46, 50, 60, 80, 94, 100]

  // these are fixed values hardcoded in the contract
  // 1000 = 100 %
  const treasuryPercentage = 128
  const lpPercentage = 872

  const masterchefRate = bn(1)

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    dev = signers[1]
    treasury = signers[2]
    alice = signers[4]
    bob = signers[5]
  })

  beforeEach(async function () {
    beets = await deployContract("BeethovenxToken", [])
    poolToken = await deployContract("ERC20", ["PoolTestToken", "PTT"])
    // 0x04068da6c83afcfa0e13ba15a6696662335d5b75,0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83,0xde1e704dae0b4051e80dabb26ab6ad6c12262da0,0x10010078a54396f62c96df8532dc2b4847d47ed3,0xf24bcf4d1e507740041c9cfd2dddb29585adce1e,0x74b23882a30290451A17c44f4F05243b6b58C76d,0xde5ed76e7c05ec5e4572cfc88d1acea165109e44,0x91fa20244Fb509e8289CA630E5db3E9166233FDc,0x10b620b2dbac4faa7d7ffd71da486f5d44cd86f9,0x5ddb92a5340fd0ead3987d3661afcd6104c3b757,0xc0064b291bd3d4ba0e44ccfc81bf8e7f7a579cd2
    masterchef = await deployChef(beets.address, treasury.address, masterchefRate, 0)
    await beets.mint(owner.address, bn(100_000_000))
    await beets.transferOwnership(masterchef.address)

    curve = await deployContract("BeetsConstantEmissionCurve", [bn(0)])

    reliquary = await deployContract("ReliquaryMock", [beets.address, curve.address])

    let utf8Encode = new TextEncoder()

    await reliquary.grantRole(keccak256(utf8Encode.encode("OPERATOR")), owner.address)

    reliquary.addPool(100, poolToken.address, ADDRESS_ZERO, requiredMaturity, allocationPoints, "fBeets", ADDRESS_ZERO)

    // there are no pools on the mastechef, so the pool id is 0
    const poolId = 0
    streamer = await deployContract("ReliquaryBeetsStreamer", [masterchef.address, poolId, reliquary.address, beets.address, alice.address])

    await curve.grantRole(await curve.OPERATOR(), streamer.address)
    await masterchef.add(10, streamer.address, ethers.constants.AddressZero)
  })

  it("deposit the streamer bpt into the farm", async () => {
    await streamer.deposit()

    const userInfo = await masterchef.userInfo(0, streamer.address)
    expect(userInfo.amount).to.be.equal(1)
  })

  it("harvest pending rewards to reliquary", async () => {
    const txn = await streamer.deposit()

    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)
    expect(await beets.balanceOf(reliquary.address)).to.be.equal(0)

    await advanceBlockTo(txn.blockNumber! + 100)

    await streamer.startNewEpoch()

    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)
    expect(await beets.balanceOf(reliquary.address)).to.be.equal(bn(1).mul(101).mul(lpPercentage).div(1000))
  })

  it("only owner can call streamer", async () => {
    await expect(streamer.connect(alice).deposit()).to.be.revertedWith("Ownable: caller is not the owner")
    await expect(streamer.connect(bob).startNewEpoch()).to.be.revertedWith("Ownable: caller is not the owner")
  })

  it("start the first epoch", async () => {
    await streamer.deposit()
    // init done

    // there is one week of no emissions to front-load reliquary
    // advance 1 week, assume 1 block / seconds. Streamer collects beets from masterchef during this time.
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // the last block of the week will be mined when streamer.startNewEpoch() is called
    await mine(sevenDaysInSeconds - 1)

    // the streamer has now 1 week worth of beets (at the rate of 1beets/block) to harvest and transfer
    const newEpochTxn = await streamer.startNewEpoch()

    // no beets on the streamer, all should be sent to reliquary
    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)

    // make sure transfertimestamp has been set correctly
    const transferTimestamp = await getBlockTime(newEpochTxn.blockHash || "")
    expect(await streamer.lastTransferTimestamp()).to.be.equal(transferTimestamp)

    const beetsAmountOnReliquary = await beets.balanceOf(reliquary.address)
    // the rate should now correspond to the rate that was set on the masterchef for the past 7 days (times the LP percentage)
    expect(await curve.getRate(0)).to.be.equal(masterchefRate.mul(lpPercentage).div(1000))
    // also the rate should simply be the amount harvested / sevenDaysInSeconds (the amount divided by the seconds of one epoch)
    expect(await curve.getRate(0)).to.be.equal(beetsAmountOnReliquary.div(sevenDaysInSeconds))
  })

  it("start an epoch before the last is finished", async () => {
    await streamer.deposit()
    // init done

    // let one week pass and start the first epoch
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // the last block of the week will be mined when streamer.startNewEpoch() is called
    await mine(sevenDaysInSeconds - 1)

    // the streamer has now 1 week worth of beets (at the rate of 1beets/block) to harvest and transfer
    await streamer.startNewEpoch()

    // let 6 days and 12 hours pass
    const sixDaysAnd12HoursInSeconds = moment.duration(7, "days").subtract(12, "hours").asSeconds()
    // the last block will be mined when streamer.startNewEpoch() is called
    await mine(sixDaysAnd12HoursInSeconds - 1)

    // the streamer has now 6 days and 12 hours worth of beets (at the rate of 1beets/block) to harvest and transfer
    const newEpochTxn = await streamer.startNewEpoch()

    // no beets on the streamer, all should be sent to reliquary
    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)

    // make sure transfertimestamp has been set correctly
    const transferTimestamp = await getBlockTime(newEpochTxn.blockHash || "")
    expect(await streamer.lastTransferTimestamp()).to.be.equal(transferTimestamp)

    // the rate should still correspond to the rate that was set on the masterchef for the past 7 days (times the LP percentage)
    expect(await curve.getRate(0)).to.be.equal(masterchefRate.mul(lpPercentage).div(1000))
  })

  it("lower emission rate on the masterchef", async () => {
    const lowerRate = bn(75, 16)
    await streamer.deposit()
    // init done

    // let one week pass and start the first epoch
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // the last block of the week will be mined when streamer.startNewEpoch() is called and updateEmissionRate
    await mine(sevenDaysInSeconds - 2)

    // the streamer has now 1 week worth of beets (at the rate of 1beets/block) to harvest and transfer
    await streamer.startNewEpoch()

    // let 6 days and 12 hours pass
    const sixDaysAnd12HoursInSeconds = moment.duration(7, "days").subtract(12, "hours").asSeconds()

    // lower rate from 1 to 0.75
    await masterchef.updateEmissionRate(lowerRate)
    // the last block will be mined when streamer.startNewEpoch() is called
    await mine(sixDaysAnd12HoursInSeconds - 2)

    // the streamer has now 6 days and 12 hours worth of beets (at the rate of 1beets/block) to harvest and transfer
    const newEpochTxn = await streamer.startNewEpoch()

    // no beets on the streamer, all should be sent to reliquary
    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)

    // make sure transfertimestamp has been set correctly
    const transferTimestamp = await getBlockTime(newEpochTxn.blockHash || "")
    expect(await streamer.lastTransferTimestamp()).to.be.equal(transferTimestamp)

    // the rate should now correspond to the lower rate of 0.75 since we changed it at exactly one week
    expect(await curve.getRate(0)).to.be.equal(lowerRate.mul(lpPercentage).div(1000))
  })

  it("lower emission rate on the masterchef mid epoch", async () => {
    const lowerRate = bn(75, 16)
    await streamer.deposit()
    // init done

    // let one week pass and start the first epoch
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // let an epoch pass
    await mine(sevenDaysInSeconds - 1)

    // the streamer has now 1 week worth of beets (at the rate of 1beets/block) to harvest and transfer
    await streamer.startNewEpoch()

    const firstEpochBeetsOnReliquary = await beets.balanceOf(reliquary.address)

    // let 6 days and 12 hours pass
    const sixDaysAnd12HoursInSeconds = moment.duration(7, "days").subtract(12, "hours").asSeconds()

    // let half an epoch pass
    await mine(sixDaysAnd12HoursInSeconds / 2 - 1)
    // important to call update pool before we change emissions, otherwise we get emissions for the whole week with the new rate
    await masterchef.updatePool(0)
    // lower rate from 1 to 0.75
    await masterchef.updateEmissionRate(lowerRate)

    // the last block will be mined when streamer.startNewEpoch() is called
    await mine(sixDaysAnd12HoursInSeconds / 2 - 2)

    // the streamer has now 6 days and 12 hours worth of beets (at the rate of 1beets/block and 0.75beets/block) to harvest and transfer
    const newEpochTxn = await streamer.startNewEpoch()

    // no beets on the streamer, all should be sent to reliquary
    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)

    // make sure transfertimestamp has been set correctly
    const transferTimestamp = await getBlockTime(newEpochTxn.blockHash || "")
    expect(await streamer.lastTransferTimestamp()).to.be.equal(transferTimestamp)

    // the rate should now be the average of 1 and 0.75 (=0.875) since it was lowerd in the middle of the epoch
    expect(await curve.getRate(0)).to.be.equal(masterchefRate.add(lowerRate).div(2).mul(lpPercentage).div(1000))
  })

  it("emergency harvest to alice", async () => {
    await streamer.deposit()
    // init done

    // let one week pass and start the first epoch
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // let an epoch pass
    await mine(sevenDaysInSeconds - 1)

    expect(await beets.balanceOf(alice.address)).to.be.equal(0)
    const pendingRewards = await masterchef.pendingBeets(0, streamer.address)
    await streamer.emergencyHarvest()
    expect(await beets.balanceOf(alice.address)).to.be.equal(pendingRewards.add(masterchefRate.mul(lpPercentage).div(1000)))

    // no beets on the streamer, all should be sent to alice
    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)
  })
})
