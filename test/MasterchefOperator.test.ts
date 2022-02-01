import { advanceTime, bn, deployChef, deployContract, deployERC20Mock, duration, encodeParameters, latest } from "./utilities"
import { ethers } from "hardhat"
import { BeethovenxMasterChef, BeethovenxToken, MasterChefOperator, TimeBasedMasterChefRewarder, Timelock } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import moment from "moment"
import { BigNumber } from "ethers"

describe("MasterChefOperator", function () {
  let beets: BeethovenxToken
  let chef: BeethovenxMasterChef
  let timelock: Timelock
  let operator: MasterChefOperator
  let owner: SignerWithAddress
  let alice: SignerWithAddress
  let admin: SignerWithAddress
  let stagingAdmin: SignerWithAddress
  let rewarder: TimeBasedMasterChefRewarder
  let treasury: SignerWithAddress

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    admin = signers[5]
    alice = signers[4]
    treasury = signers[6]
    stagingAdmin = signers[7]

    beets = await deployContract("BeethovenxToken", [])
  })

  beforeEach(async function () {
    timelock = await deployContract("Timelock", [admin.address, duration.hours("8")])
    chef = await deployChef(beets.address, treasury.address, bn(6))
    await chef.transferOwnership(timelock.address)
    rewarder = await deployContract("TimeBasedMasterChefRewarder", [beets.address, bn(1), chef.address])

    operator = await deployContract("MasterChefOperator", [timelock.address, chef.address, admin.address, stagingAdmin.address])

    await timelock.connect(admin).setPendingAdmin(operator.address)
    await operator.connect(admin).acceptTimelockAdmin()
  })

  it("batches farm modifications", async () => {
    const lpToken = await deployERC20Mock("some token", "st", bn(1000))
    const anotherLpToken = await deployERC20Mock("another token", "at", bn(1000))
    const yetAnotherLpToken = await deployERC20Mock("yet another token", "yat", bn(1000))
    const lastLpToken = await deployERC20Mock("last token", "lt", bn(1000))

    const etaFirstModification = await createEta()
    await operator.connect(stagingAdmin).stageFarmAdditions(
      [
        { lpToken: beets.address, allocationPoints: 10, rewarder: ethers.constants.AddressZero },
        { lpToken: lpToken.address, allocationPoints: 20, rewarder: rewarder.address },
        { lpToken: anotherLpToken.address, allocationPoints: 30, rewarder: ethers.constants.AddressZero },
      ],
      etaFirstModification
    )

    await operator
      .connect(stagingAdmin)
      .stageFarmAdditions(
        [{ lpToken: yetAnotherLpToken.address, allocationPoints: 40, rewarder: ethers.constants.AddressZero }],
        etaFirstModification
      )

    const farmAddTx0 = await operator.farmAdditions(etaFirstModification, 0)
    const farmAddTx1 = await operator.farmAdditions(etaFirstModification, 1)
    const farmAddTx2 = await operator.farmAdditions(etaFirstModification, 2)
    const farmAddTx3 = await operator.farmAdditions(etaFirstModification, 3)

    expect(farmAddTx0.lpToken).to.equal(beets.address)
    expect(farmAddTx0.allocationPoints).to.equal(10)
    expect(farmAddTx0.rewarder).to.equal(ethers.constants.AddressZero)

    expect(farmAddTx1.lpToken).to.equal(lpToken.address)
    expect(farmAddTx1.allocationPoints).to.equal(20)
    expect(farmAddTx1.rewarder).to.equal(rewarder.address)

    expect(farmAddTx2.lpToken).to.equal(anotherLpToken.address)
    expect(farmAddTx2.allocationPoints).to.equal(30)
    expect(farmAddTx2.rewarder).to.equal(ethers.constants.AddressZero)

    expect(farmAddTx3.lpToken).to.equal(yetAnotherLpToken.address)
    expect(farmAddTx3.allocationPoints).to.equal(40)
    expect(farmAddTx3.rewarder).to.equal(ethers.constants.AddressZero)

    // lets queue it up
    await operator.connect(admin).commitFarmChanges(etaFirstModification, 0)

    await advanceTime(duration.hours("10").toNumber())

    // and execute it
    await operator.connect(admin).commitFarmChanges(etaFirstModification, 1)

    expect(await chef.poolLength()).to.equal(4)

    expect(await chef.lpTokens(0)).to.equal(beets.address)
    const poolInfo0 = await chef.poolInfo(0)
    expect(poolInfo0.allocPoint).to.equal(10)
    expect(await chef.rewarder(0)).to.equal(ethers.constants.AddressZero)

    expect(await chef.lpTokens(1)).to.equal(lpToken.address)
    const poolInfo1 = await chef.poolInfo(1)
    expect(poolInfo1.allocPoint).to.equal(20)
    expect(await chef.rewarder(1)).to.equal(rewarder.address)

    expect(await chef.lpTokens(2)).to.equal(anotherLpToken.address)
    const poolInfo2 = await chef.poolInfo(2)
    expect(poolInfo2.allocPoint).to.equal(30)
    expect(await chef.rewarder(2)).to.equal(ethers.constants.AddressZero)

    expect(await chef.lpTokens(3)).to.equal(yetAnotherLpToken.address)
    const poolInfo3 = await chef.poolInfo(3)
    expect(poolInfo3.allocPoint).to.equal(40)
    expect(await chef.rewarder(3)).to.equal(ethers.constants.AddressZero)

    // now lets edit some farms & also add a new one

    const etaSecondModification = await createEta()
    await operator.connect(stagingAdmin).stageFarmModifications(
      [
        {
          allocationPoints: 5,
          pid: 0,
          rewarder: ethers.constants.AddressZero,
          overwriteRewarder: false,
        },
      ],
      etaSecondModification
    )

    await operator.connect(stagingAdmin).stageFarmModifications(
      [
        {
          allocationPoints: 2,
          pid: 1,
          rewarder: ethers.constants.AddressZero,
          overwriteRewarder: true,
        },
      ],
      etaSecondModification
    )

    await operator.connect(stagingAdmin).stageFarmAdditions(
      [
        {
          lpToken: lastLpToken.address,
          allocationPoints: 10,
          rewarder: ethers.constants.AddressZero,
        },
      ],
      etaSecondModification
    )

    const farmEditTx0 = await operator.farmModifications(etaSecondModification, 0)
    const farmEditTx1 = await operator.farmModifications(etaSecondModification, 1)
    const farmAddTx4 = await operator.farmAdditions(etaSecondModification, 0)

    expect(farmEditTx0.pid).to.equal(0)
    expect(farmEditTx0.allocationPoints).to.equal(5)
    expect(farmEditTx0.rewarder).to.equal(ethers.constants.AddressZero)
    expect(farmEditTx0.overwriteRewarder).to.equal(false)

    expect(farmEditTx1.pid).to.equal(1)
    expect(farmEditTx1.allocationPoints).to.equal(2)
    expect(farmEditTx0.rewarder).to.equal(ethers.constants.AddressZero)
    expect(farmEditTx1.overwriteRewarder).to.equal(true)

    expect(farmAddTx4.lpToken).to.equal(lastLpToken.address)
    expect(farmAddTx4.allocationPoints).to.equal(10)
    expect(farmAddTx4.rewarder).to.equal(ethers.constants.AddressZero)

    // lets queue it up
    await operator.connect(admin).commitFarmChanges(etaSecondModification, 0)

    await advanceTime(duration.hours("10").toNumber())

    // and execute it
    await operator.connect(admin).commitFarmChanges(etaSecondModification, 1)

    const poolInfo0AfterEdit = await chef.poolInfo(0)
    expect(poolInfo0AfterEdit.allocPoint).to.equal(5)
    expect(await chef.rewarder(0)).to.equal(ethers.constants.AddressZero)

    const poolInfo1AfterEdit = await chef.poolInfo(1)
    expect(poolInfo1AfterEdit.allocPoint).to.equal(2)
    expect(await chef.rewarder(1)).to.equal(ethers.constants.AddressZero)

    expect(await chef.lpTokens(4)).to.equal(lastLpToken.address)
    const poolInfo4 = await chef.poolInfo(4)
    expect(poolInfo4.allocPoint).to.equal(10)
    expect(await chef.rewarder(4)).to.equal(ethers.constants.AddressZero)
  })

  it("returns etas of queued farm changes", async () => {
    const lpToken = await deployERC20Mock("some token", "st", bn(1000))

    const firstEta = await createEta()
    await operator.connect(stagingAdmin).stageFarmAdditions(
      [
        { lpToken: beets.address, allocationPoints: 10, rewarder: ethers.constants.AddressZero },
        { lpToken: lpToken.address, allocationPoints: 20, rewarder: rewarder.address },
      ],
      firstEta
    )

    await operator.connect(stagingAdmin).stageFarmModifications(
      [
        {
          allocationPoints: 2,
          pid: 1,
          rewarder: ethers.constants.AddressZero,
          overwriteRewarder: true,
        },
      ],
      firstEta
    )

    const secondEta = await createEta()
    await operator.connect(stagingAdmin).stageFarmModifications(
      [
        {
          allocationPoints: 5,
          pid: 1,
          rewarder: ethers.constants.AddressZero,
          overwriteRewarder: true,
        },
      ],
      secondEta
    )

    await operator.connect(admin).commitFarmChanges(firstEta, 0)
    await operator.connect(admin).commitFarmChanges(secondEta, 0)

    const etas = await operator.queuedFarmChangeEtas()
    expect(etas).to.deep.equal([bn(firstEta, 0), bn(secondEta, 0)])
  })

  it("returns changes for an eta", async () => {
    const lpToken = await deployERC20Mock("some token", "st", bn(1000))

    const firstEta = await createEta()
    const firstAddition = { lpToken: beets.address, allocationPoints: BigNumber.from(10), rewarder: ethers.constants.AddressZero }
    const secondAddition = { lpToken: lpToken.address, allocationPoints: BigNumber.from(20), rewarder: rewarder.address }

    await operator.connect(stagingAdmin).stageFarmAdditions([firstAddition, secondAddition], firstEta)

    const firstModification = {
      allocationPoints: BigNumber.from(2),
      pid: BigNumber.from(1),
      rewarder: ethers.constants.AddressZero,
      overwriteRewarder: true,
    }

    await operator.connect(stagingAdmin).stageFarmModifications([firstModification], firstEta)

    const secondEta = await createEta()
    const secondModification = {
      allocationPoints: BigNumber.from(5),
      pid: BigNumber.from(1),
      rewarder: ethers.constants.AddressZero,
      overwriteRewarder: true,
    }
    await operator.connect(stagingAdmin).stageFarmModifications([secondModification], secondEta)

    await operator.connect(admin).commitFarmChanges(firstEta, 0)
    await operator.connect(admin).commitFarmChanges(secondEta, 0)

    const farmAdditionsFirstEta = await operator.farmAdditionsForEta(firstEta)
    const farmModificationsFirstEta = await operator.farmModificationsForEta(firstEta)
    const farmModificationsSecondEta = await operator.farmModificationsForEta(secondEta)

    // structs are returned as arrays

    expect(farmAdditionsFirstEta).to.deep.equal([
      [firstAddition.lpToken, firstAddition.allocationPoints, firstAddition.rewarder],
      [secondAddition.lpToken, secondAddition.allocationPoints, secondAddition.rewarder],
    ])
    expect(farmModificationsFirstEta).to.deep.equal([
      [firstModification.pid, firstModification.allocationPoints, firstModification.rewarder, firstModification.overwriteRewarder],
    ])
    expect(farmModificationsSecondEta).to.deep.equal([
      [secondModification.pid, secondModification.allocationPoints, secondModification.rewarder, secondModification.overwriteRewarder],
    ])
  })

  it("only allows users with role STAGING to stage farm changes", async () => {
    await expect(
      operator.connect(alice).stageFarmModifications(
        [
          {
            allocationPoints: 2,
            pid: 1,
            rewarder: ethers.constants.AddressZero,
            overwriteRewarder: true,
          },
        ],
        await createEta()
      )
    ).to.be.reverted
  })

  it("only allows user with COMMITTER role to commit farm changes", async () => {
    const etaFarmEdit = await createEta()
    await operator.connect(stagingAdmin).stageFarmModifications(
      [
        {
          allocationPoints: 5,
          pid: 0,
          rewarder: ethers.constants.AddressZero,
          overwriteRewarder: false,
        },
      ],
      etaFarmEdit
    )

    await expect(operator.connect(stagingAdmin).commitFarmChanges(etaFarmEdit, 0)).to.be.reverted
    await expect(operator.connect(alice).commitFarmChanges(etaFarmEdit, 0)).to.be.reverted
  })

  it("reverts when staging with an already used eta", async () => {
    const lpToken = await deployERC20Mock("some token", "st", bn(1000))
    const yetAnotherLpToken = await deployERC20Mock("yet another token", "at", bn(1000))
    const eta = await createEta()
    await operator
      .connect(stagingAdmin)
      .stageFarmAdditions([{ lpToken: lpToken.address, allocationPoints: 20, rewarder: rewarder.address }], eta)

    await operator.connect(admin).commitFarmChanges(eta, 0)

    await expect(
      operator
        .connect(stagingAdmin)
        .stageFarmAdditions([{ lpToken: yetAnotherLpToken.address, allocationPoints: 40, rewarder: ethers.constants.AddressZero }], eta)
    ).to.be.revertedWith("ETA already used, chose other eta")
  })

  it("sets peding timelock admin", async () => {
    const eta = await createEta()

    await operator.connect(admin).commitSetPendingTimelockAdmin(alice.address, eta, 0)
    await advanceTime(duration.hours("10").toNumber())
    await operator.connect(admin).commitSetPendingTimelockAdmin(alice.address, eta, 1)

    await timelock.connect(alice).acceptAdmin()
    expect(await timelock.admin()).to.equal(alice.address)
  })

  it("only allows user with COMMITTER role to set pending timelock admin", async () => {
    const eta = await createEta()
    await expect(operator.connect(stagingAdmin).commitSetPendingTimelockAdmin(alice.address, eta, 0)).to.be.reverted
    await expect(operator.connect(alice).commitSetPendingTimelockAdmin(alice.address, eta, 0)).to.be.reverted
  })

  it("proxies queueTransaction & execute transaction call", async () => {
    const eta = await createEta()
    const delay = duration.hours("4")
    await operator.connect(admin).queueTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    await advanceTime(duration.hours("10").toNumber())
    await operator.connect(admin).executeTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)

    expect(await timelock.delay()).to.equal(delay)
  })

  it("proxies cancelTransaction call", async () => {
    const eta = await createEta()
    const delay = duration.hours("5")
    await operator.connect(admin).queueTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    await operator.connect(admin).cancelTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    await advanceTime(duration.hours("10").toNumber())
    await expect(
      operator.connect(admin).executeTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    ).to.be.reverted
  })

  it("only allows commiter to use timelock proxy calls", async () => {
    const eta = await createEta()
    const delay = duration.hours("5")

    await expect(
      operator.connect(stagingAdmin).queueTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    ).to.be.reverted
    await expect(operator.connect(alice).queueTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta))
      .to.be.reverted

    await operator.connect(admin).queueTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)

    await expect(
      operator.connect(stagingAdmin).executeTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    ).to.be.reverted
    await expect(
      operator.connect(alice).executeTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    ).to.be.reverted

    await expect(
      operator.connect(stagingAdmin).cancelTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    ).to.be.reverted
    await expect(
      operator.connect(alice).cancelTransaction(timelock.address, 0, "setDelay(uint256)", encodeParameters(["uint256"], [delay]), eta)
    ).to.be.reverted
  })

  it("changes token emissions", async () => {
    const eta = await createEta()

    await operator.connect(admin).commitEmissionChange(bn(2), eta, 0)
    await advanceTime(duration.hours("10").toNumber())
    await operator.connect(admin).commitEmissionChange(bn(2), eta, 1)

    expect(await chef.beetsPerBlock()).to.equal(bn(2))
  })

  it("only allows user with COMMITTER role to change emissions", async () => {
    const eta = await createEta()

    await expect(operator.connect(stagingAdmin).commitEmissionChange(bn(2), eta, 0)).to.be.reverted
    await expect(operator.connect(alice).commitEmissionChange(bn(2), eta, 0)).to.be.reverted
  })

  it("changes treasury address", async () => {
    const eta = await createEta()

    await operator.connect(admin).commitSetTreasuryAddress(alice.address, eta, 0)
    await advanceTime(duration.hours("10").toNumber())
    await operator.connect(admin).commitSetTreasuryAddress(alice.address, eta, 1)

    expect(await chef.treasuryAddress()).to.equal(alice.address)
  })

  it("only allows user with COMMITTER role to change treasury address", async () => {
    const eta = await createEta()
    await expect(operator.connect(stagingAdmin).commitSetTreasuryAddress(alice.address, eta, 0)).to.be.reverted
    await expect(operator.connect(alice).commitSetTreasuryAddress(alice.address, eta, 0)).to.be.reverted
  })

  async function createEta(hours: number = 10) {
    return moment
      .unix((await latest()).toNumber())
      .add(hours, "hours")
      .unix()
  }
})
