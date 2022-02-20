import { advanceTimeAndBlock, bn, deployChef, deployContract, deployERC20Mock, duration, latest } from "./utilities"
import { ethers } from "hardhat"
import {
  BeethovenxMasterChef,
  BeethovenxToken,
  ERC20Mock,
  MasterChefOperator,
  MasterChefRewarderFactory,
  TimeBasedMasterChefRewarder,
  Timelock,
} from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import moment from "moment"

describe("MasterChefRewarderFactory", function () {
  let beets: BeethovenxToken
  let chef: BeethovenxMasterChef
  let timelock: Timelock
  let operator: MasterChefOperator
  let deployer: SignerWithAddress
  let admin: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let carol: SignerWithAddress
  let treasury: SignerWithAddress
  let lpToken: ERC20Mock
  let anotherLpToken: ERC20Mock
  let yetAnotherLpToken: ERC20Mock

  before(async function () {
    const signers = await ethers.getSigners()
    deployer = signers[0]
    admin = signers[1]
    alice = signers[4]
    bob = signers[5]
    carol = signers[6]
    treasury = signers[7]
  })

  beforeEach(async function () {
    beets = await deployContract("BeethovenxToken", [])
    chef = await deployChef(beets.address, treasury.address, bn(4))

    // we add a few farms for some noise
    lpToken = await deployERC20Mock("SomeLp", "SL", 10_000)
    anotherLpToken = await deployERC20Mock("AnotherSomeLp", "ASL", 10_000)
    yetAnotherLpToken = await deployERC20Mock("YetAnotherSomeLp", "YASL", 10_000)
    await chef.add(10, lpToken.address, ethers.constants.AddressZero)
    await chef.add(20, anotherLpToken.address, ethers.constants.AddressZero)
    await chef.add(30, yetAnotherLpToken.address, ethers.constants.AddressZero)

    timelock = await deployContract("Timelock", [admin.address, duration.hours("8")])
    await chef.transferOwnership(timelock.address)

    operator = await deployContract("MasterChefOperator", [timelock.address, chef.address, admin.address, admin.address])
    await timelock.connect(admin).setPendingAdmin(operator.address)
    await operator.connect(admin).acceptTimelockAdmin()
  })

  it("sets initial state correctly", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    expect(await rewarderFactory.DEFAULT_REWARDER_FARM_ALLOCATION()).to.equal(10)
    expect(await rewarderFactory.masterChef()).to.equal(chef.address)
    expect(await rewarderFactory.masterChefOperator()).to.equal(operator.address)
    expect(await rewarderFactory.defaultAdmin()).to.equal(admin.address)
    expect(await rewarderFactory.hasRole(await rewarderFactory.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true)
    expect(await rewarderFactory.hasRole(await rewarderFactory.OPERATOR_ROLE(), admin.address)).to.equal(true)
  })

  it("prepares rewarder for given lp token with default admin for approval", async () => {
    /*
        on the preparation step, a rewarder is deployed with 0 emissions and no farm pools configured ready to get
        approved by the operator.
        If we provide no admin (address 0), it should default to the 'defaultAdmin' as
        an owner of the rewarder.
     */
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    const rewardPerSecond = bn(5)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, rewardPerSecond, ethers.constants.AddressZero)

    // the rewarder should have been added
    const deploymentId = 0 // first deployment
    const rewarderConfig = await rewarderFactory.rewarderConfigs(deploymentId)
    expect(rewarderConfig.admin).to.equal(admin.address)
    expect(rewarderConfig.lpToken).to.equal(lpToken.address)
    expect(rewarderConfig.rewardToken).to.equal(rewardToken.address)
    expect(rewarderConfig.rewardsPerSecond).to.equal(rewardPerSecond)
    expect(rewarderConfig.approved).to.equal(false)
    expect(rewarderConfig.activated).to.equal(false)
    const deploymentIds = await rewarderFactory.deploymentIdsByAdmin(admin.address)
    expect(deploymentIds[0]).to.equal(0)

    const rewarderAddress = await rewarderFactory.deployedRewarders(deploymentId)

    const rewarder = (await ethers.getContractAt("TimeBasedMasterChefRewarder", rewarderAddress)) as TimeBasedMasterChefRewarder
    expect(await rewarder.rewardToken()).to.equal(rewardToken.address)
    expect(await rewarder.rewardPerSecond()).to.equal(0)
    expect(await rewarder.masterChef()).to.equal(chef.address)
    expect(await rewarder.poolLength()).to.equal(0)
  })

  it("emits RewarderPrepared event", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    await expect(rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, bn(5), ethers.constants.AddressZero)).to.emit(
      rewarderFactory,
      "RewarderPrepared"
    )
  })

  it("stages farm addition for rewarder on masterchef operator with 0 allocation on operator approval", async () => {
    /*
        the admin can approve a prepared rewarder which stages a farm addition on the master chef operator
     */
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, bn(5), ethers.constants.AddressZero)

    const deploymentId = 0
    const rewarderAddress = await rewarderFactory.deployedRewarders(deploymentId)
    const rewarder = (await ethers.getContractAt("TimeBasedMasterChefRewarder", rewarderAddress)) as TimeBasedMasterChefRewarder

    const eta = await createEta()
    await rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)
    const rewarderConfig = await rewarderFactory.rewarderConfigs(deploymentId)

    // the config should be flagged as approved with the timelock eta
    expect(rewarderConfig.approved).to.equal(true)
    expect(rewarderConfig.timelockEta).to.equal(eta)

    // lets check if the farm addition was added to the master chef operator
    const stagedAdditions = await operator.farmAdditionsForEta(eta)
    expect(stagedAdditions[0].lpToken).to.equal(lpToken.address)
    expect(stagedAdditions[0].allocationPoints).to.equal(0)
    expect(stagedAdditions[0].rewarder).to.equal(rewarder.address)
  })

  it("emits RewarderApproved event", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, bn(5), ethers.constants.AddressZero)

    const deploymentId = 0
    const rewarderAddress = await rewarderFactory.deployedRewarders(deploymentId)

    const eta = await createEta()
    await expect(rewarderFactory.connect(admin).approveRewarder(deploymentId, eta))
      .to.emit(rewarderFactory, "RewarderApproved")
      .withArgs(rewarderAddress)
  })

  it("rejects rewarder approval when already approved", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, bn(5), ethers.constants.AddressZero)

    const deploymentId = 0

    const eta = await createEta()
    await rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)
    await expect(rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)).to.be.revertedWith("Rewarder already approved")
  })

  it("only allows operator to approve rewarder", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    const eta = await createEta()
    await expect(rewarderFactory.connect(bob).approveRewarder(0, eta)).to.be.revertedWith("AccessControl")
    await expect(rewarderFactory.connect(alice).approveRewarder(0, eta)).to.be.revertedWith("AccessControl")
  })

  it("configures rewarder with final emissions and transfers ownership to admin on activation by operator", async () => {
    /*
        once the farm got added, the admin can initiate the activate of the rewarder which sets the emissions
        to the actual configured amount,optionally configures the farm on the rewarder which in turn starts the emissions.
        The ownership is transferred to the admin
     */
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    const rewardPerSecond = bn(5)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, rewardPerSecond, ethers.constants.AddressZero)

    const deploymentId = 0
    const rewarderAddress = await rewarderFactory.deployedRewarders(deploymentId)
    const rewarder = (await ethers.getContractAt("TimeBasedMasterChefRewarder", rewarderAddress)) as TimeBasedMasterChefRewarder

    const eta = await createEta()
    await rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)

    // we need to execute the addition of the farm on the master chef operator
    await operator.connect(admin).commitFarmChanges(eta, 0)
    await advanceTimeAndBlock(duration.hours("10").toNumber())
    await operator.connect(admin).commitFarmChanges(eta, 1)

    await rewarderFactory.connect(admin).activateRewarder(deploymentId, true)

    // the poolID is the last pool added, so poolLength - 1
    const poolLength = await chef.poolLength()
    const pid = poolLength.toNumber() - 1
    // lets chef if the rewarder got added for the correct lpToken
    expect(await chef.rewarder(pid)).to.equal(rewarder.address)
    expect(await chef.lpTokens(pid)).to.equal(lpToken.address)

    // also check if the rewarder is properly configured with the correct masterchef farm, allocation & emissions
    const rewarderPoolInfo = await rewarder.poolInfo(pid)
    expect(rewarderPoolInfo.allocPoint).to.equal(await rewarderFactory.DEFAULT_REWARDER_FARM_ALLOCATION())
    expect(await rewarder.rewardPerSecond()).to.equal(rewardPerSecond)
    expect(await rewarder.owner()).to.equal(admin.address)
  })

  it("allows activation of rewarder without automatic farm configuration", async () => {
    // as a backup in case the pool cannot be found for some reason, we can opt out of automatically configure the master chef farm
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    const rewardPerSecond = bn(5)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, rewardPerSecond, ethers.constants.AddressZero)

    const deploymentId = 0
    const rewarderAddress = await rewarderFactory.deployedRewarders(deploymentId)
    const rewarder = (await ethers.getContractAt("TimeBasedMasterChefRewarder", rewarderAddress)) as TimeBasedMasterChefRewarder

    const eta = await createEta()
    await rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)

    // we dont execute the farm additions since we do manual pool configuration

    await rewarderFactory.connect(admin).activateRewarder(deploymentId, false)

    expect(await rewarder.poolLength()).to.equal(0)
    expect(await rewarder.rewardPerSecond()).to.equal(rewardPerSecond)
    expect(await rewarder.owner()).to.equal(admin.address)
  })

  it("rejects activation of rewarder if rewarder has not been approved yet", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, bn(5), ethers.constants.AddressZero)

    await expect(rewarderFactory.connect(admin).activateRewarder(0, true)).to.be.revertedWith("Rewarder has not been approved yet")
  })
  it("rejects activation of rewarder if rewarder has already been activated", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    const rewardPerSecond = bn(5)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, rewardPerSecond, ethers.constants.AddressZero)

    const deploymentId = 0

    const eta = await createEta()
    await rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)

    // we need to execute the addition of the farm on the master chef operator
    await operator.connect(admin).commitFarmChanges(eta, 0)
    await advanceTimeAndBlock(duration.hours("10").toNumber())
    await operator.connect(admin).commitFarmChanges(eta, 1)

    await rewarderFactory.connect(admin).activateRewarder(deploymentId, true)
    await expect(rewarderFactory.connect(admin).activateRewarder(deploymentId, true)).to.be.revertedWith("Rewarder already activated")
  })

  it("rejects activation with pool configuration if master chef pool is not found for rewarder", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    const rewardPerSecond = bn(5)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, rewardPerSecond, ethers.constants.AddressZero)

    const deploymentId = 0

    const eta = await createEta()
    await rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)

    // we dont create the farm on the master chef operator
    await expect(rewarderFactory.connect(admin).activateRewarder(deploymentId, true)).to.be.revertedWith("Pool for lp token not found")
  })

  it("only allows rewarder admin to activate its rewarder", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    const rewardPerSecond = bn(5)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, rewardPerSecond, ethers.constants.AddressZero)

    const deploymentId = 0

    const eta = await createEta()
    await rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)

    // we dont create the farm on the master chef operator
    await expect(rewarderFactory.connect(bob).activateRewarder(deploymentId, true)).to.be.revertedWith("Only rewarder admin can activate it")
    await expect(rewarderFactory.connect(alice).activateRewarder(deploymentId, true)).to.be.revertedWith("Only rewarder admin can activate it")
  })

  it("emits RewarderActivated event", async () => {
    const rewarderFactory = await deployRewardFactory(operator, chef, admin)
    // we need to grant staging role on operator to the factory
    await operator.connect(admin).grantRole(await operator.STAGE_ROLE(), rewarderFactory.address)

    const lpToken = await deployERC20Mock("Some LP", "SOMELP", 10_000)
    const rewardToken = await deployERC20Mock("Reward Token", "SomeReward", 10_000)
    const rewardPerSecond = bn(5)
    await rewarderFactory.prepareRewarder(lpToken.address, rewardToken.address, rewardPerSecond, ethers.constants.AddressZero)

    const deploymentId = 0
    const rewarderAddress = await rewarderFactory.deployedRewarders(deploymentId)
    const rewarder = (await ethers.getContractAt("TimeBasedMasterChefRewarder", rewarderAddress)) as TimeBasedMasterChefRewarder

    const eta = await createEta()
    await rewarderFactory.connect(admin).approveRewarder(deploymentId, eta)

    // we need to execute the addition of the farm on the master chef operator
    await operator.connect(admin).commitFarmChanges(eta, 0)
    await advanceTimeAndBlock(duration.hours("10").toNumber())
    await operator.connect(admin).commitFarmChanges(eta, 1)

    const poolLength = await chef.poolLength()
    const pid = poolLength.toNumber() - 1

    await expect(rewarderFactory.connect(admin).activateRewarder(deploymentId, true))
      .to.emit(rewarderFactory, "RewarderActivated")
      .withArgs(rewarderAddress)
  })

  async function deployRewardFactory(
    masterChefOperator: MasterChefOperator,
    masterChef: BeethovenxMasterChef,
    operatorAdmin: SignerWithAddress
  ) {
    return await deployContract<MasterChefRewarderFactory>("MasterChefRewarderFactory", [
      masterChefOperator.address,
      masterChef.address,
      operatorAdmin.address,
    ])
  }

  async function createEta(hours: number = 10) {
    return moment
      .unix((await latest()).toNumber())
      .add(hours, "hours")
      .unix()
  }
})
