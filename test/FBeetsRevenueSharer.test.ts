import { advanceBlocks, advanceTime, advanceTimeAndBlock, bn, deployChef, deployContract, deployERC20Mock, encodeParameters } from "./utilities"
import { ethers } from "hardhat"
import { BalancerPool, BeethovenxMasterChef, BeethovenxToken, BeetsBar, ERC20Mock, FBeetsLocker, FBeetsRevenueSharer } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber } from "ethers"

describe("FBeetsRevenueSharer", function () {
  const EPOCH_DURATION = 86400 * 7
  const LOCK_DURATION = EPOCH_DURATION * 17

  const INITIAL_FBEETSLOCKERSSHARE = 500

  let beets: BeethovenxToken
  let chef: BeethovenxMasterChef
  let beetsPerBlock: BigNumber = bn(1)
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
    beets = await deployContract<BeethovenxToken>("BeethovenxToken", [])
    chef = await deployChef(beets.address, owner.address, beetsPerBlock)
    await beets.transferOwnership(chef.address)
    fidelioDuettoPool = await deployContract("BalancerPool", [bn(10_000)])
    beetsBar = await deployContract("BeetsBar", [fidelioDuettoPool.address])
    locker = await deployContract<FBeetsLocker>("FBeetsLocker", [beetsBar.address, EPOCH_DURATION, LOCK_DURATION])
  })

  it("sets correct initial state", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()

    expect(await sharer.name()).to.equal("FBEETS REVENUE")
    expect(await sharer.symbol()).to.equal("rfBEETS")
    expect(await sharer.decimals()).to.equal(18)
    expect(await sharer.chef()).to.equal(chef.address)
    expect(await sharer.beetsBar()).to.equal(beetsBar.address)
    expect(await sharer.hasRole(await sharer.OPERATOR_ROLE(), owner.address)).to.be.true
    expect(await sharer.hasRole(await sharer.DISTRIBUTE_ROLE(), owner.address)).to.be.true
    expect(await sharer.hasRole(await sharer.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true
  })

  it("mints 1 rfBEETS and deposits into masterchef farm", async () => {
    // there should only ever exist a maximum of 1 token which is minted and then deposited into the specified masterchef farm
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()

    // we need to create a farm for rfBEETS
    await chef.add(10, sharer.address, ethers.constants.AddressZero)
    await sharer.depositToChef()

    // we expect 1 token to be minted and deposited into the farm
    expect(await sharer.totalSupply()).to.equal(1)
    expect(await sharer.balanceOf(chef.address)).to.equal(1)
    const userInfo = await chef.userInfo(0, sharer.address)
    expect(userInfo.amount).to.equal(1)
    expect(userInfo.rewardDebt).to.equal(0)
  })

  it("only allows operator to deposit into masterchef", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()
    await chef.add(10, sharer.address, ethers.constants.AddressZero)
    await expect(sharer.connect(bob).depositToChef()).to.be.revertedWith("AccessControl")
  })

  it("withdraws from masterchef pool and burns the token", async () => {
    // if we withdraw from the masterchef farm, we also burn the token
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()

    await chef.add(10, sharer.address, ethers.constants.AddressZero)
    // we need to add the sharer as a rewarder to the locker
    await locker.addReward(beets.address, sharer.address)
    await sharer.depositToChef()
    await sharer.withdrawAndDistribute()
    expect(await sharer.totalSupply()).to.equal(0)
    const userInfo = await chef.userInfo(0, sharer.address)
    expect(userInfo.amount).to.equal(0)
  })

  it("only allows operator to withdraw from masterchef", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()

    await chef.add(10, sharer.address, ethers.constants.AddressZero)
    await sharer.depositToChef()
    await expect(sharer.connect(bob).withdrawAndDistribute()).to.be.revertedWith("AccessControl")
    await expect(sharer.connect(alice).withdrawAndDistribute()).to.be.revertedWith("AccessControl")
  })

  it("distributes 50% of the harvested emissions as beets to the locker", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()
    await chef.add(10, sharer.address, ethers.constants.AddressZero)

    // we need to add the sharer as a rewarder to the locker
    await locker.addReward(beets.address, sharer.address)
    // also we need someone to lock some fBeets
    const lockAmount = bn(1, 0)
    await mintFBeets(bob, lockAmount)
    await beetsBar.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)

    await sharer.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    await sharer.harvestAndDistribute()

    // now lets see if the locker has half of the claimed rewards
    const userInfo = await chef.userInfo(0, sharer.address)
    expect(await beets.balanceOf(locker.address)).to.equal(userInfo.rewardDebt.div(2))
    // to go full circle, we advance the full reward duration which is 1 epoch
    await advanceTime(EPOCH_DURATION)
    // now lets claim the rewards
    await locker.getReward(bob.address)
    //  bob should have now all the rewards on the locker or half of the emissions (minus some rounding errors)
    expect(await beets.balanceOf(bob.address)).to.be.closeTo(userInfo.rewardDebt.div(2), 200000)
  })

  it("change fBeets locker share above 100%", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()
    await expect(sharer.setFBeetsLockerShare(1001)).to.be.revertedWith("Share cannot exceed 100%")
  })

  it("distribute correct amount of to lockers after changing share", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()
    await chef.add(10, sharer.address, ethers.constants.AddressZero)

    // we need to add the sharer as a rewarder to the locker
    await locker.addReward(beets.address, sharer.address)
    // change the default share
    await sharer.setFBeetsLockerShare(750)
    // also we need someone to lock some fBeets
    const lockAmount = bn(1, 0)
    await mintFBeets(bob, lockAmount)
    await beetsBar.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)

    await sharer.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    await sharer.harvestAndDistribute()

    // now lets see if the locker has 75% of the claimed rewards
    const userInfo = await chef.userInfo(0, sharer.address)
    expect(await beets.balanceOf(locker.address)).to.equal(userInfo.rewardDebt.mul(await sharer.fBeetsLockerShare()).div(await sharer.DENOMINATOR()))
    // to go full circle, we advance the full reward duration which is 1 epoch
    await advanceTime(EPOCH_DURATION)
    // // now lets claim the rewards
    await locker.getReward(bob.address)
    // //  bob should have now all the rewards on the locker or 75% of the emissions (minus some rounding errors)
    expect(await beets.balanceOf(bob.address)).to.be.closeTo(userInfo.rewardDebt.mul(await sharer.fBeetsLockerShare()).div(await sharer.DENOMINATOR()), 200000)
  })

  it("distribute 100% to lockers and none to non-lockers", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()
    await chef.add(10, sharer.address, ethers.constants.AddressZero)

    // we need to add the sharer as a rewarder to the locker
    await locker.addReward(beets.address, sharer.address)
    // change the default share
    await sharer.setFBeetsLockerShare(1000)
    // also we need someone to lock some fBeets
    const lockAmount = bn(1, 0)
    await mintFBeets(bob, lockAmount)
    await beetsBar.connect(bob).approve(locker.address, lockAmount)
    await locker.connect(bob).lock(bob.address, lockAmount)
    // also we need someone to NOT lock fBeets, just mint
    await mintFBeets(alice, lockAmount)

    await sharer.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    await sharer.harvestAndDistribute()

    // now lets see if the locker has 100% of the rewards
    const userInfoBob = await chef.userInfo(0, sharer.address)
    expect(await beets.balanceOf(locker.address)).to.equal(userInfoBob.rewardDebt.mul(await sharer.fBeetsLockerShare()).div(await sharer.DENOMINATOR()))
    // now lets see if alice has zero rewards
    const userInfoAlice = await chef.userInfo(1, sharer.address)
    expect(userInfoAlice.rewardDebt).to.equal(0)
    // to go full circle, we advance the full reward duration which is 1 epoch
    await advanceTime(EPOCH_DURATION)
    // now lets claim the rewards
    await locker.getReward(bob.address)
    // bob should have now all the rewards on the locker or 100% of the emissions (minus some rounding errors)
    // TODO What happens here if two people minted fBeets but only one locked???
    expect(await beets.balanceOf(bob.address)).to.equal(userInfoBob.rewardDebt)
    // now lets claim the rewards
    await locker.getReward(alice.address)
    // alice should have no rewards
    expect(await beets.balanceOf(alice.address)).to.equal(0)
  })

  it("distributes remaining share to all fBeets holders by accruing value", async () => {
    // With the remaining beets (total emissions - locked share) we join single sided the fidelio duetto pool and share the resulting beets as revenue with fBeets holders 

    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()
    await chef.add(10, sharer.address, ethers.constants.AddressZero)

    // again we need to add the sharer as a rewarder to the locker
    await locker.addReward(beets.address, sharer.address)

    await sharer.depositToChef()
    // lets advance some blocks to generate some emissions
    await advanceBlocks(10)
    await sharer.harvestAndDistribute()
    // we get the total rewarded beets from the chef
    const userInfo = await chef.userInfo(0, sharer.address)
    // our balancer pool mock mints as many bpt's as we pass in beets and then share them as revenue to the beets bar
    // since there are no bpt's yet in the beets bar, the total amount should equal half of the emitted beets as bpt'

    expect(await fidelioDuettoPool.balanceOf(beetsBar.address)).to.equal(userInfo.rewardDebt.div(2))
  })

  it("only allows operator role to change fBeets locker share", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()
    await expect(sharer.connect(bob).setFBeetsLockerShare(500)).to.be.revertedWith("AccessControl")
    await expect(sharer.connect(alice).setFBeetsLockerShare(500)).to.be.revertedWith("AccessControl")
  })

  it("only allows distributor role to call harvest and distribute", async () => {
    const sharer: FBeetsRevenueSharer = await deployFBeetsSharer()
    await expect(sharer.connect(bob).harvestAndDistribute()).to.be.revertedWith("AccessControl")
    await expect(sharer.connect(alice).harvestAndDistribute()).to.be.revertedWith("AccessControl")
  })

  async function deployFBeetsSharer(farmPid: number = 0, admin: string = owner.address): Promise<FBeetsRevenueSharer> {
    // for simplicity, the balancer vault is also the pool, in reality those are 2 different contracts
    return deployContract("FBeetsRevenueSharer", [
      fidelioDuettoPool.address,
      beets.address,
      beetsBar.address,
      locker.address,
      chef.address,
      farmPid,
      INITIAL_FBEETSLOCKERSSHARE,
      fidelioDuettoPool.address,
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
