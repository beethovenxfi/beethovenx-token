import { advanceBlocks, advanceTime, advanceTimeAndBlock, bn, deployChef, deployContract, deployERC20Mock, encodeParameters } from "./utilities"
import { ethers } from "hardhat"
import {
  BalancerPool,
  BeethovenxMasterChef,
  BeethovenxToken,
  BeetsBar,
  ERC20Mock,
  FBeetsLocker,
  FBeetsEmissionDistributor,
  BalancerVault,
} from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber } from "ethers"

describe("FBeetsEmissionDistributor", function () {
  const EPOCH_DURATION = 86400 * 7
  const LOCK_DURATION = EPOCH_DURATION * 17

  const INITIAL_FBEETS_LOCKER_SHARE = 500

  let wftm: ERC20Mock
  let beets: BeethovenxToken
  let chef: BeethovenxMasterChef
  let beetsPerBlock: BigNumber = bn(1)
  let balancerVault: BalancerVault
  let fidelioDuettoPool: BalancerPool
  let beetsBar: BeetsBar
  let locker: FBeetsLocker
  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    alice = signers[4]
    bob = signers[5]
    carol = signers[6]
  })

  beforeEach(async function () {
    wftm = await deployERC20Mock("Fantom", "FTM", 10_000)
    beets = await deployContract<BeethovenxToken>("BeethovenxToken", [])
    chef = await deployChef(beets.address, owner.address, beetsPerBlock)
    await beets.transferOwnership(chef.address)

    balancerVault = await deployContract("BalancerVault", [])
    fidelioDuettoPool = await deployContract("BalancerPool", [
      "Fidelio Duetto",
      "BPT-Fidelio",
      bn(10_000),
      balancerVault.address,
      [beets.address, wftm.address],
    ])
    await fidelioDuettoPool.register()

    beetsBar = await deployContract("BeetsBar", [fidelioDuettoPool.address])
    locker = await deployContract<FBeetsLocker>("FBeetsLocker", [beetsBar.address, EPOCH_DURATION, LOCK_DURATION])
  })

  it("sets correct initial state", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()

    expect(await distributor.name()).to.equal("FBEETS EMISSION DISTRIBUTOR")
    expect(await distributor.symbol()).to.equal("edfBEETS")
    expect(await distributor.decimals()).to.equal(18)
    expect(await distributor.chef()).to.equal(chef.address)
    expect(await distributor.beetsBar()).to.equal(beetsBar.address)
    expect(await distributor.hasRole(await distributor.OPERATOR_ROLE(), owner.address)).to.be.true
    expect(await distributor.hasRole(await distributor.DISTRIBUTE_ROLE(), owner.address)).to.be.true
    expect(await distributor.hasRole(await distributor.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true
  })

  it("allows changing of master chef farm ID by the operator", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor(0)
    await distributor.setFarmId(2)
    expect(await distributor.farmPid()).to.equal(2)
  })

  it("allows only operator to change master chef farm ID", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor(0)
    await expect(distributor.connect(bob).setFarmId(2)).to.be.revertedWith("AccessControl")
    await expect(distributor.connect(alice).setFarmId(2)).to.be.revertedWith("AccessControl")
  })

  it("allows changing of locker contract by the operator", async () => {
    const otherLocker = await deployContract<FBeetsLocker>("FBeetsLocker", [beetsBar.address, EPOCH_DURATION, LOCK_DURATION])
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor(0)
    await distributor.setLocker(otherLocker.address)
    expect(await distributor.locker()).to.equal(otherLocker.address)
  })

  it("allows only operator to change locker contract", async () => {
    const otherLocker = await deployContract<FBeetsLocker>("FBeetsLocker", [beetsBar.address, EPOCH_DURATION, LOCK_DURATION])
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor(0)
    await expect(distributor.connect(bob).setLocker(otherLocker.address)).to.be.revertedWith("AccessControl")
    await expect(distributor.connect(alice).setLocker(otherLocker.address)).to.be.revertedWith("AccessControl")
  })

  it("mints 1 edfBEETS and deposits into masterchef farm", async () => {
    // there should only ever exist a maximum of 1 token which is minted and then deposited into the specified masterchef farm
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()

    // we need to create a farm for edfBEETS
    await chef.add(10, distributor.address, ethers.constants.AddressZero)
    await distributor.depositToChef()

    // we expect 1 token to be minted and deposited into the farm
    expect(await distributor.totalSupply()).to.equal(1)
    expect(await distributor.balanceOf(chef.address)).to.equal(1)
    const userInfo = await chef.userInfo(0, distributor.address)
    expect(userInfo.amount).to.equal(1)
    expect(userInfo.rewardDebt).to.equal(0)
  })

  it("only allows operator to deposit into masterchef", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await chef.add(10, distributor.address, ethers.constants.AddressZero)
    await expect(distributor.connect(bob).depositToChef()).to.be.revertedWith("AccessControl")
  })

  it("withdraws from masterchef pool and burns the token", async () => {
    // if we withdraw from the masterchef farm, we also burn the token
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()

    await chef.add(10, distributor.address, ethers.constants.AddressZero)
    // we need to add the distributor as a rewarder to the locker
    await locker.addReward(beets.address, distributor.address)
    await distributor.depositToChef()
    await distributor.withdrawAndDistribute()
    expect(await distributor.totalSupply()).to.equal(0)
    const userInfo = await chef.userInfo(0, distributor.address)
    expect(userInfo.amount).to.equal(0)
  })

  it("only allows operator to withdraw from masterchef", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()

    await chef.add(10, distributor.address, ethers.constants.AddressZero)
    await distributor.depositToChef()
    await expect(distributor.connect(bob).withdrawAndDistribute()).to.be.revertedWith("AccessControl")
    await expect(distributor.connect(alice).withdrawAndDistribute()).to.be.revertedWith("AccessControl")
  })

  it("distributes 50% of the harvested emissions as beets to the locker", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await chef.add(10, distributor.address, ethers.constants.AddressZero)

    // we need to add the distributor as a rewarder to the locker
    await locker.addReward(beets.address, distributor.address)
    // also we need someone to lock some fBeets
    const lockAmount = bn(1, 0)
    await mintFBeets(bob, lockAmount)
    await beetsBar.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)

    await distributor.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    await distributor.harvestAndDistribute()

    // now lets see if the locker has half of the claimed rewards
    const userInfo = await chef.userInfo(0, distributor.address)
    expect(await beets.balanceOf(locker.address)).to.equal(userInfo.rewardDebt.div(2))
    // to go full circle, we advance the full reward duration which is 1 epoch
    await advanceTime(EPOCH_DURATION)
    // now lets claim the rewards
    await locker.getReward()
    //  bob should have now all the rewards on the locker or half of the emissions (minus some rounding errors)
    expect(await beets.balanceOf(bob.address)).to.be.closeTo(userInfo.rewardDebt.div(2), 200000)
  })

  it("revert if fBeets locker share above 100%", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await expect(distributor.setFBeetsLockerShare(1001)).to.be.revertedWith("Share cannot exceed 100%")
  })

  it("distribute correct amount of beets to lockers after changing share", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await chef.add(10, distributor.address, ethers.constants.AddressZero)

    // we need to add the distributor as a rewarder to the locker
    await locker.addReward(beets.address, distributor.address)
    // change the default share
    await distributor.setFBeetsLockerShare(750)
    // also we need someone to lock some fBeets
    const lockAmount = bn(1, 0)
    await mintFBeets(bob, lockAmount)
    await beetsBar.connect(bob).approve(locker.address, lockAmount)
    // actually lock the fbeets
    await locker.connect(bob).lock(bob.address, lockAmount)

    // save how many BPTs are in the beetsBar before harvest
    const fidelioBptsBeforeHarvest = await fidelioDuettoPool.balanceOf(beetsBar.address)

    // deposit the one token into the "distributor farm" done only once
    await distributor.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    // harvest all "distributor farm" rewards and transfer to locker contract and add bpt to beetsbar
    await distributor.harvestAndDistribute()

    // now lets see if the locker has 75% of the claimed rewards
    // get userInfo of user distributor.address from farm 0 (which is the "distributor farm")
    const userInfo = await chef.userInfo(0, distributor.address)
    // rewardDebt is the total amount harvested
    // fbeets balance of the locker (which will distribute to lockers) must be 75% of the total harvest (since it's the first harvest)
    expect(await beets.balanceOf(locker.address)).to.equal(userInfo.rewardDebt.mul(750).div(1000))

    // check if there are now 25% more bpts in the beetsBar
    const fidelioBptsAfterHarvest = await fidelioDuettoPool.balanceOf(beetsBar.address)
    expect(fidelioBptsBeforeHarvest.add(userInfo.rewardDebt.mul(250).div(1000))).to.equal(fidelioBptsAfterHarvest)
  })

  it("only lockers get rewards", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await chef.add(10, distributor.address, ethers.constants.AddressZero)

    // we need to add the distributor as a rewarder to the locker
    await locker.addReward(beets.address, distributor.address)
    // change the default share
    await distributor.setFBeetsLockerShare(1000)
    // also we need someone to lock some fBeets
    const lockAmount = bn(1, 0)
    await mintFBeets(bob, lockAmount)
    await beetsBar.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)
    // also we need someone to NOT lock fBeets, just mint
    await mintFBeets(alice, lockAmount)

    await distributor.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    //save amount of fidelio bpts in beetsbar for checks after harvest
    const fidelioBptsBefore = await fidelioDuettoPool.balanceOf(beetsBar.address)
    await distributor.harvestAndDistribute()

    // now lets see if the locker has 100% of the rewards (total harvested amount (rewardDebt) equals beets amount on the locker)
    const distributorUserInfo = await chef.userInfo(0, distributor.address)
    expect(await beets.balanceOf(locker.address)).to.equal(distributorUserInfo.rewardDebt)
    // rewards to non-lockers are given in the form of added bpt to beetsbar.
    // No rewards mean that there are still the same amount of fidelio bpts in beetsbar
    const fidelioBptsAfter = await fidelioDuettoPool.balanceOf(beetsBar.address)
    expect(fidelioBptsAfter).to.equal(fidelioBptsBefore)
  })

  it("everyone gets the same amount of rewards (all to bpt tokens)", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await chef.add(10, distributor.address, ethers.constants.AddressZero)

    // we need to add the distributor as a rewarder to the locker
    await locker.addReward(beets.address, distributor.address)
    // change the default share
    await distributor.setFBeetsLockerShare(0)
    // also we need someone to lock some fBeets
    const lockAmount = bn(1, 0)
    await mintFBeets(bob, lockAmount)
    await beetsBar.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)
    // also we need someone to NOT lock fBeets, just mint
    await mintFBeets(alice, lockAmount)

    await distributor.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    //save amount of fidelio bpts in beetsbar for checks after harvest
    const fidelioBptsBefore = await fidelioDuettoPool.balanceOf(beetsBar.address)
    await distributor.harvestAndDistribute()

    // now lets see if the locker has no rewards
    expect(await beets.balanceOf(locker.address)).to.equal(0)
    // rewards to non-lockers are given in the form of added bpt to beetsbar.
    // All rewards to non-lockers mean that there are now additioanl rewardDept amount of BPTs in the beetsbar
    const fidelioBptsAfter = await fidelioDuettoPool.balanceOf(beetsBar.address)
    const userInfo = await chef.userInfo(0, distributor.address)
    expect(fidelioBptsBefore.add(userInfo.rewardDebt)).to.equal(fidelioBptsAfter)
  })

  it("distributes remaining share to all fBeets holders by accruing value", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await chef.add(10, distributor.address, ethers.constants.AddressZero)

    // again we need to add the distributor as a rewarder to the locker
    await locker.addReward(beets.address, distributor.address)

    await distributor.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    await distributor.harvestAndDistribute()
    // we get the total rewarded beets from the chef
    const userInfo = await chef.userInfo(0, distributor.address)
    // our balancer pool mock mints as many bpt's as we pass in beets and then share them as revenue to the beets bar
    // since there are no bpt's yet in the beets bar, the total amount should equal half of the emitted beets as bpt'

    expect(await fidelioDuettoPool.balanceOf(beetsBar.address)).to.equal(userInfo.rewardDebt.div(2))
  })

  it("only allows operator role to change fBeets locker share", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await expect(distributor.connect(bob).setFBeetsLockerShare(500)).to.be.revertedWith("AccessControl")
    await expect(distributor.connect(alice).setFBeetsLockerShare(500)).to.be.revertedWith("AccessControl")
  })

  it("only allows distributor role to call harvest and distribute", async () => {
    const distributor: FBeetsEmissionDistributor = await deployFBeetsEmissionDistributor()
    await expect(distributor.connect(bob).harvestAndDistribute()).to.be.revertedWith("AccessControl")
    await expect(distributor.connect(alice).harvestAndDistribute()).to.be.revertedWith("AccessControl")
  })

  async function deployFBeetsEmissionDistributor(farmPid: number = 0, admin: string = owner.address): Promise<FBeetsEmissionDistributor> {
    // for simplicity, the balancer vault is also the pool, in reality those are 2 different contracts
    return deployContract("FBeetsEmissionDistributor", [
      fidelioDuettoPool.address,
      beets.address,
      beetsBar.address,
      locker.address,
      chef.address,
      farmPid,
      INITIAL_FBEETS_LOCKER_SHARE,
      balancerVault.address,
      encodeParameters(["address"], [fidelioDuettoPool.address]),
      admin,
    ])
  }

  async function mintFBeets(user: SignerWithAddress, amount: BigNumber) {
    await fidelioDuettoPool.transfer(user.address, amount)
    await fidelioDuettoPool.connect(user).approve(beetsBar.address, amount)
    await beetsBar.connect(user).enter(amount)
  }
})
