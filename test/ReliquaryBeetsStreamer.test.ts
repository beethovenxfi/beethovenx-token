import { expect } from "chai"
import { ADDRESS_ZERO, bn, deployChef, deployContract, getBlockTime } from "./utilities"
import { ethers } from "hardhat"
import { BeethovenxMasterChef, BeethovenxToken, BeetsConstantEmissionCurve, ERC20, IReliquaryGamified, ReliquaryBeetsStreamer } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { keccak256 } from "ethers/lib/utils"
import moment from "moment"
import { mine } from "@nomicfoundation/hardhat-network-helpers"

describe("ReliquaryBeetsStreamer", function () {
  let beets: BeethovenxToken
  let curve: BeetsConstantEmissionCurve
  let reliquary: IReliquaryGamified
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
    masterchef = await deployChef(beets.address, treasury.address, masterchefRate, 0)
    await beets.mint(owner.address, bn(100_000_000))
    await beets.transferOwnership(masterchef.address)

    curve = await deployContract("BeetsConstantEmissionCurve", [bn(0)])

    reliquary = await deployContract("ReliquaryGamifiedMock", [beets.address, curve.address])

    let utf8Encode = new TextEncoder()
    await reliquary.grantRole(keccak256(utf8Encode.encode("OPERATOR")), owner.address)

    reliquary.addPool(100, poolToken.address, ADDRESS_ZERO, requiredMaturity, allocationPoints, "fBeets", ADDRESS_ZERO)

    // there are no pools on the mastechef, so the pool id is 0
    const poolId = 0
    streamer = await deployContract("ReliquaryBeetsStreamer", [
      masterchef.address,
      poolId,
      reliquary.address,
      beets.address,
      alice.address,
      owner.address,
    ])

    await curve.grantRole(await curve.OPERATOR(), streamer.address)
    await masterchef.add(10, streamer.address, ethers.constants.AddressZero)
  })

  it("deposit the streamer bpt into the farm", async () => {
    await streamer.deposit()
    const userInfo = await masterchef.userInfo(0, streamer.address)
    expect(userInfo.amount).to.be.equal(1)
  })

  it("only operator and admin can call streamer", async () => {
    await expect(streamer.connect(alice).deposit()).to.be.revertedWith("AccessControl")
    await expect(streamer.connect(bob).startNewEpoch()).to.be.revertedWith("AccessControl")
  })

  it("set the rate correctly after starting the first epoch", async () => {
    const depositTxn = await streamer.deposit()
    await streamer.initialize(await getBlockTime(depositTxn.blockHash || ""))

    // init done

    // there is one week of no emissions to front-load reliquary
    // advance 1 week, assume 1 block / seconds. Streamer collects beets from masterchef during this time.
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // the last block of the week will be mined when streamer.startNewEpoch() is called
    await mine(sevenDaysInSeconds - 2)

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
    const depositTxn = await streamer.deposit()
    await streamer.initialize(await getBlockTime(depositTxn.blockHash || ""))
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
    const depositTxn = await streamer.deposit()
    await streamer.initialize(await getBlockTime(depositTxn.blockHash || ""))
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
    const depositTxn = await streamer.deposit()
    await streamer.initialize(await getBlockTime(depositTxn.blockHash || ""))
    // init done

    // let one week pass and start the first epoch
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // let an epoch pass
    await mine(sevenDaysInSeconds - 1)

    // the streamer has now 1 week worth of beets (at the rate of 1beets/block) to harvest and transfer
    await streamer.startNewEpoch()

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

  it("need to initialize before starting an epoch", async () => {
    await streamer.deposit()
    // init done

    // let one week pass and start the first epoch
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // let an epoch pass
    await mine(sevenDaysInSeconds - 1)

    await expect(streamer.startNewEpoch()).to.be.revertedWith("Must be initialized")
  })

  it("can only initialize once", async () => {
    const depositTxn = await streamer.deposit()
    await streamer.initialize(await getBlockTime(depositTxn.blockHash || ""))
    // init done

    // let one week pass and start the first epoch
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // let an epoch pass
    await mine(sevenDaysInSeconds - 1)

    await expect(streamer.initialize(await getBlockTime(depositTxn.blockHash || ""))).to.be.revertedWith("Already initialized")
  })

  it("start a new epoch right after one is started and only harvest tiny amount", async () => {
    const depositTxn = await streamer.deposit()
    await streamer.initialize(await getBlockTime(depositTxn.blockHash || ""))
    // init done

    // let one week pass and start the first epoch
    const sevenDaysInSeconds = moment.duration(7, "days").asSeconds()

    // the last block of the week will be mined when streamer.startNewEpoch() is called
    await mine(sevenDaysInSeconds - 1)

    // the streamer has now 1 week worth of beets (at the rate of 1beets/block) to harvest and transfer
    const firstStartTxn = await streamer.startNewEpoch()
    const lastTransferTimestamp = await streamer.lastTransferTimestamp()
    //start a new epoch right after
    // await mine(10)
    const pendingBeets = await masterchef.pendingBeets(0, streamer.address)
    const secondStartTxn = await streamer.startNewEpoch()
    const transferTimestamp = await streamer.lastTransferTimestamp()

    expect(await getBlockTime(firstStartTxn.blockHash || "")).to.be.equal(lastTransferTimestamp)
    expect(await getBlockTime(secondStartTxn.blockHash || "")).to.be.equal(transferTimestamp)

    // rate should still be the same
    expect(await curve.getRate(0)).to.be.equal(masterchefRate.mul(lpPercentage).div(1000))
    expect(await curve.getRate(0)).to.be.equal(
      pendingBeets.add(masterchefRate.mul(lpPercentage).div(1000)).div(transferTimestamp.sub(lastTransferTimestamp))
    )
  })
})
