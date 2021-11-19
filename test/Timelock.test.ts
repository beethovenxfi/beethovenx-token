import { ethers } from "hardhat"
import { expect } from "chai"
import { encodeParameters, latest, duration, increase, deployContract } from "./utilities"
import { BeethovenxToken, Timelock } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"

describe("Timelock", function () {
  let beets: BeethovenxToken
  let timelock: Timelock

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
    alice = signers[4]
    bob = signers[5]
    carol = signers[6]
  })

  beforeEach(async function () {
    beets = await deployContract("BeethovenxToken", [])
    timelock = await deployContract("Timelock", [bob.address, "259200"])
  })

  it("should not allow non-owner to do operation", async function () {
    await beets.transferOwnership(timelock.address)
    // await expectRevert(beets.transferOwnership(carol, { from: alice }), "Ownable: caller is not the owner")

    await expect(beets.transferOwnership(carol.address)).to.be.revertedWith("Ownable: caller is not the owner")
    await expect(beets.connect(bob).transferOwnership(carol.address)).to.be.revertedWith("Ownable: caller is not the owner")

    await expect(
      timelock.queueTransaction(
        beets.address,
        "0",
        "transferOwnership(address)",
        encodeParameters(["address"], [carol.address]),
        (await latest()).add(duration.days("4"))
      )
    ).to.be.revertedWith("Timelock::queueTransaction: Call must come from admin.")
  })

  it("should do the timelock thing", async function () {
    await beets.transferOwnership(timelock.address)
    const eta = (await latest()).add(duration.days("4"))
    await timelock
      .connect(bob)
      .queueTransaction(beets.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    await increase(duration.days("1").toNumber())
    await expect(
      timelock
        .connect(bob)
        .executeTransaction(beets.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't surpassed time lock.")
    await increase(duration.days("4").toNumber())
    await timelock
      .connect(bob)
      .executeTransaction(beets.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    expect(await beets.owner()).to.equal(carol.address)
  })

  it("cancels queued transaction", async () => {
    await beets.transferOwnership(timelock.address)
    const eta = (await latest()).add(duration.days("4"))
    await timelock
      .connect(bob)
      .queueTransaction(beets.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    await increase(duration.days("1").toNumber())
    await timelock
      .connect(bob)
      .cancelTransaction(beets.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    await expect(
      timelock
        .connect(bob)
        .executeTransaction(beets.address, "0", "transferOwnership(address)", encodeParameters(["address"], [carol.address]), eta)
    ).to.be.revertedWith("Timelock::executeTransaction: Transaction hasn't been queued.")
  })

  it("allows changing admin directly the first time", async () => {
    await expect(timelock.connect(bob).setPendingAdmin(alice.address)).to.emit(timelock, "NewPendingAdmin").withArgs(alice.address)
    await timelock.connect(alice).acceptAdmin()
    expect(await timelock.admin()).to.equal(alice.address)
  })

  it("allows changing admin through timelock after initialization", async () => {
    const eta = (await latest()).add(duration.days("4"))
    await timelock.connect(bob).setPendingAdmin(carol.address)
    await timelock.connect(carol).acceptAdmin()

    // second time has to come thorough timelock
    await expect(timelock.connect(carol).setPendingAdmin(alice.address)).to.be.revertedWith(
      "Timelock::setPendingAdmin: Call must come from Timelock."
    )
    await timelock
      .connect(carol)
      .queueTransaction(timelock.address, "0", "setPendingAdmin(address)", encodeParameters(["address"], [alice.address]), eta)
    await increase(duration.days("4").toNumber())
    await timelock
      .connect(carol)
      .executeTransaction(timelock.address, "0", "setPendingAdmin(address)", encodeParameters(["address"], [alice.address]), eta)

    await timelock.connect(alice).acceptAdmin()
    expect(await timelock.admin()).to.equal(alice.address)
  })
})
