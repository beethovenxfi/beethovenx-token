import { bn, deployContract, deployERC20Mock } from "./utilities"
import { ethers } from "hardhat"
import { FreshBeets, IERC20 } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"

describe("FreshBeets", function () {
  let vestingToken: IERC20
  let fBeets: FreshBeets
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
    vestingToken = await deployERC20Mock("FidelioDuetto", "FidelioDuettoBPT", bn(10_000))
    fBeets = await deployContract("FreshBeets", [vestingToken.address])
  })

  it("sets initial state correctly", async () => {
    expect(await fBeets.vestingToken()).to.equal(vestingToken.address)
  })

  it("mints correct amount of fBeets if no tokens have been locked yet", async () => {
    const enterAmount = bn(100)
    await vestingToken.transfer(bob.address, enterAmount)

    await vestingToken.connect(bob).approve(fBeets.address, enterAmount)
    await expect(fBeets.connect(bob).enter(enterAmount))
      .to.emit(fBeets, "Enter")
      .withArgs(bob.address, enterAmount)
      .to.emit(fBeets, "MintFreshBeets")
      .withArgs(bob.address, enterAmount)
    expect(await vestingToken.balanceOf(fBeets.address)).to.equal(enterAmount)
    expect(await fBeets.balanceOf(bob.address)).to.equal(enterAmount)
  })

  it("mints correct amount of fBeets if there are already locked tokens while fBeets value has not been increased", async () => {
    const aliceEnterAmount = bn(50)
    await vestingToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await vestingToken.transfer(bob.address, bobEnterAmount)

    await vestingToken.connect(alice).approve(fBeets.address, aliceEnterAmount)
    await expect(fBeets.connect(alice).enter(aliceEnterAmount))
      .to.emit(fBeets, "Enter")
      .withArgs(alice.address, aliceEnterAmount)
      .to.emit(fBeets, "MintFreshBeets")
      .withArgs(alice.address, aliceEnterAmount)

    await vestingToken.connect(bob).approve(fBeets.address, bobEnterAmount)
    await expect(fBeets.connect(bob).enter(bobEnterAmount))
      .to.emit(fBeets, "Enter")
      .withArgs(bob.address, bobEnterAmount)
      .to.emit(fBeets, "MintFreshBeets")
      .withArgs(bob.address, bobEnterAmount)

    expect(await vestingToken.balanceOf(fBeets.address)).to.equal(aliceEnterAmount.add(bobEnterAmount))
    expect(await fBeets.balanceOf(alice.address)).to.equal(aliceEnterAmount)
    expect(await fBeets.balanceOf(bob.address)).to.equal(bobEnterAmount)
  })

  it("mints correct amount of fBeets after a value increase of fBeets", async () => {
    const aliceEnterAmount = bn(100)
    await vestingToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await vestingToken.transfer(bob.address, bobEnterAmount)

    await vestingToken.connect(alice).approve(fBeets.address, aliceEnterAmount)
    await expect(fBeets.connect(alice).enter(aliceEnterAmount))
      .to.emit(fBeets, "Enter")
      .withArgs(alice.address, aliceEnterAmount)
      .to.emit(fBeets, "MintFreshBeets")
      .withArgs(alice.address, aliceEnterAmount)

    // lets double the value of fBeets

    const valueIncreaseAmount = bn(100)
    await vestingToken.approve(fBeets.address, valueIncreaseAmount)
    await expect(fBeets.shareRevenue(valueIncreaseAmount)).to.emit(fBeets, "ShareRevenue").withArgs(valueIncreaseAmount)

    // now bob enters, so his share is now only half of the one of alice
    await vestingToken.connect(bob).approve(fBeets.address, bobEnterAmount)
    await expect(fBeets.connect(bob).enter(bobEnterAmount))
      .to.emit(fBeets, "Enter")
      .withArgs(bob.address, bobEnterAmount)
      .to.emit(fBeets, "MintFreshBeets")
      .withArgs(bob.address, bobEnterAmount.div(2))

    expect(await vestingToken.balanceOf(fBeets.address)).to.equal(aliceEnterAmount.add(bobEnterAmount).add(valueIncreaseAmount))
    expect(await fBeets.balanceOf(alice.address)).to.equal(aliceEnterAmount)
    expect(await fBeets.balanceOf(bob.address)).to.equal(bobEnterAmount.div(2))
  })

  it("transfers correct amount of vesting token after a value increase of fBeets", async () => {
    const aliceEnterAmount = bn(100)
    await vestingToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await vestingToken.transfer(bob.address, bobEnterAmount)

    await vestingToken.connect(alice).approve(fBeets.address, aliceEnterAmount)
    const expectedAliceFreshBeetsAmount = aliceEnterAmount
    await expect(fBeets.connect(alice).enter(aliceEnterAmount))
      .to.emit(fBeets, "Enter")
      .withArgs(alice.address, aliceEnterAmount)
      .to.emit(fBeets, "MintFreshBeets")
      .withArgs(alice.address, expectedAliceFreshBeetsAmount)

    // lets double the value of fBeets

    const firstValueIncrease = bn(100)
    await vestingToken.approve(fBeets.address, firstValueIncrease)
    await expect(fBeets.shareRevenue(firstValueIncrease)).to.emit(fBeets, "ShareRevenue").withArgs(firstValueIncrease)

    // now bob enters, so his share is now only half of the one of alice
    await vestingToken.connect(bob).approve(fBeets.address, bobEnterAmount)
    const expectedBobFreshBeetsAmount = bobEnterAmount.div(2)
    await expect(fBeets.connect(bob).enter(bobEnterAmount))
      .to.emit(fBeets, "Enter")
      .withArgs(bob.address, bobEnterAmount)
      .to.emit(fBeets, "MintFreshBeets")
      .withArgs(bob.address, expectedBobFreshBeetsAmount)

    // lets add another 100 fBeets

    const secondValueIncrease = bn(100)

    await vestingToken.approve(fBeets.address, secondValueIncrease)
    await expect(fBeets.shareRevenue(secondValueIncrease)).to.emit(fBeets, "ShareRevenue").withArgs(secondValueIncrease)

    expect(await vestingToken.balanceOf(fBeets.address)).to.equal(
      aliceEnterAmount.add(bobEnterAmount).add(firstValueIncrease).add(secondValueIncrease)
    )

    /*
       amount = fBeets *  totalVestedTokens / total_fBeets;

       so we left with alice first:
        alice_amount = 100 * 400 / 150 = 266.666

       then bob:
        bob_amount = 50 * (400 - 266.666) / 50 = 133.333
     */

    const fBeetsSupplyBeforeAliceLeave = await fBeets.totalSupply()
    const lockedFidelioTokensBeforeAliceLeave = await vestingToken.balanceOf(fBeets.address)
    const aliceAmount = await fBeets.balanceOf(alice.address)
    const expectedAliceLeaveLpAmount = aliceAmount.mul(lockedFidelioTokensBeforeAliceLeave).div(fBeetsSupplyBeforeAliceLeave)

    await expect(fBeets.connect(alice).leave(aliceAmount))
      .to.emit(fBeets, "Leave")
      .withArgs(alice.address, expectedAliceLeaveLpAmount)
      .to.emit(fBeets, "BurnFreshBeets")
      .withArgs(alice.address, expectedAliceFreshBeetsAmount)

    expect(await vestingToken.balanceOf(alice.address)).to.equal(expectedAliceLeaveLpAmount)

    const fBeetsSupplyBeforeBobLeave = await fBeets.totalSupply()
    const lockedFidelioTokensBeforeBobLeave = await vestingToken.balanceOf(fBeets.address)
    const bobAmount = await fBeets.balanceOf(bob.address)
    const expectedBobLeaveLpAmount = bobAmount.mul(lockedFidelioTokensBeforeBobLeave).div(fBeetsSupplyBeforeBobLeave)
    await expect(fBeets.connect(bob).leave(bobAmount))
      .to.emit(fBeets, "Leave")
      .withArgs(bob.address, expectedBobLeaveLpAmount)
      .to.emit(fBeets, "BurnFreshBeets")
      .withArgs(bob.address, expectedBobFreshBeetsAmount)
    expect(await vestingToken.balanceOf(bob.address)).to.equal(expectedBobLeaveLpAmount)
  })
})
