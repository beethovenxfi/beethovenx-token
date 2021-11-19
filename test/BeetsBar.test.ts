import { bn, deployContract, deployERC20Mock } from "./utilities"
import { ethers } from "hardhat"
import { BeetsBar, IERC20 } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"

describe("BeetsBar", function () {
  let vestingToken: IERC20
  let beetsBar: BeetsBar
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
    beetsBar = await deployContract("BeetsBar", [vestingToken.address])
  })

  it("sets initial state correctly", async () => {
    expect(await beetsBar.vestingToken()).to.equal(vestingToken.address)
  })

  it("mints correct amount of fBeets if no tokens have been locked yet", async () => {
    const enterAmount = bn(100)
    await vestingToken.transfer(bob.address, enterAmount)

    await vestingToken.connect(bob).approve(beetsBar.address, enterAmount)
    await expect(beetsBar.connect(bob).enter(enterAmount)).to.emit(beetsBar, "Enter").withArgs(bob.address, enterAmount, enterAmount)
    expect(await vestingToken.balanceOf(beetsBar.address)).to.equal(enterAmount)
    expect(await beetsBar.balanceOf(bob.address)).to.equal(enterAmount)
  })

  it("mints correct amount of fBeets if there are already locked tokens while fBeets value has not been increased", async () => {
    const aliceEnterAmount = bn(50)
    await vestingToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await vestingToken.transfer(bob.address, bobEnterAmount)

    await vestingToken.connect(alice).approve(beetsBar.address, aliceEnterAmount)
    await expect(beetsBar.connect(alice).enter(aliceEnterAmount))
      .to.emit(beetsBar, "Enter")
      .withArgs(alice.address, aliceEnterAmount, aliceEnterAmount)

    await vestingToken.connect(bob).approve(beetsBar.address, bobEnterAmount)
    await expect(beetsBar.connect(bob).enter(bobEnterAmount)).to.emit(beetsBar, "Enter").withArgs(bob.address, bobEnterAmount, bobEnterAmount)

    expect(await vestingToken.balanceOf(beetsBar.address)).to.equal(aliceEnterAmount.add(bobEnterAmount))
    expect(await beetsBar.balanceOf(alice.address)).to.equal(aliceEnterAmount)
    expect(await beetsBar.balanceOf(bob.address)).to.equal(bobEnterAmount)
  })

  it("mints correct amount of fBeets after a value increase of fBeets", async () => {
    const aliceEnterAmount = bn(100)
    await vestingToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await vestingToken.transfer(bob.address, bobEnterAmount)

    await vestingToken.connect(alice).approve(beetsBar.address, aliceEnterAmount)
    await expect(beetsBar.connect(alice).enter(aliceEnterAmount))
      .to.emit(beetsBar, "Enter")
      .withArgs(alice.address, aliceEnterAmount, aliceEnterAmount)

    // lets double the value of fBeets

    const valueIncreaseAmount = bn(100)
    await vestingToken.approve(beetsBar.address, valueIncreaseAmount)
    await expect(beetsBar.shareRevenue(valueIncreaseAmount)).to.emit(beetsBar, "ShareRevenue").withArgs(valueIncreaseAmount)

    // now bob enters, so his share is now only half of the one of alice
    await vestingToken.connect(bob).approve(beetsBar.address, bobEnterAmount)
    await expect(beetsBar.connect(bob).enter(bobEnterAmount))
      .to.emit(beetsBar, "Enter")
      .withArgs(bob.address, bobEnterAmount, bobEnterAmount.div(2))

    expect(await vestingToken.balanceOf(beetsBar.address)).to.equal(aliceEnterAmount.add(bobEnterAmount).add(valueIncreaseAmount))
    expect(await beetsBar.balanceOf(alice.address)).to.equal(aliceEnterAmount)
    expect(await beetsBar.balanceOf(bob.address)).to.equal(bobEnterAmount.div(2))
  })

  it("transfers correct amount of vesting token after a value increase of fBeets", async () => {
    const aliceEnterAmount = bn(100)
    await vestingToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await vestingToken.transfer(bob.address, bobEnterAmount)

    await vestingToken.connect(alice).approve(beetsBar.address, aliceEnterAmount)
    const expectedAliceFreshBeetsAmount = aliceEnterAmount
    await expect(beetsBar.connect(alice).enter(aliceEnterAmount))
      .to.emit(beetsBar, "Enter")
      .withArgs(alice.address, aliceEnterAmount, expectedAliceFreshBeetsAmount)

    // lets double the value of fBeets

    const firstValueIncrease = bn(100)
    await vestingToken.approve(beetsBar.address, firstValueIncrease)
    await expect(beetsBar.shareRevenue(firstValueIncrease)).to.emit(beetsBar, "ShareRevenue").withArgs(firstValueIncrease)

    // now bob enters, so his share is now only half of the one of alice
    await vestingToken.connect(bob).approve(beetsBar.address, bobEnterAmount)
    const expectedBobFreshBeetsAmount = bobEnterAmount.div(2)
    await expect(beetsBar.connect(bob).enter(bobEnterAmount))
      .to.emit(beetsBar, "Enter")
      .withArgs(bob.address, bobEnterAmount, expectedBobFreshBeetsAmount)

    // lets add another 100 fBeets

    const secondValueIncrease = bn(100)

    await vestingToken.approve(beetsBar.address, secondValueIncrease)
    await expect(beetsBar.shareRevenue(secondValueIncrease)).to.emit(beetsBar, "ShareRevenue").withArgs(secondValueIncrease)

    expect(await vestingToken.balanceOf(beetsBar.address)).to.equal(
      aliceEnterAmount.add(bobEnterAmount).add(firstValueIncrease).add(secondValueIncrease)
    )

    /*
       amount = fBeets *  totalVestedTokens / total_fBeets;

       so we left with alice first:
        alice_amount = 100 * 400 / 150 = 266.666

       then bob:
        bob_amount = 50 * (400 - 266.666) / 50 = 133.333
     */

    const fBeetsSupplyBeforeAliceLeave = await beetsBar.totalSupply()
    const lockedFidelioTokensBeforeAliceLeave = await vestingToken.balanceOf(beetsBar.address)
    const aliceAmount = await beetsBar.balanceOf(alice.address)
    const expectedAliceLeaveLpAmount = aliceAmount.mul(lockedFidelioTokensBeforeAliceLeave).div(fBeetsSupplyBeforeAliceLeave)

    await expect(beetsBar.connect(alice).leave(aliceAmount))
      .to.emit(beetsBar, "Leave")
      .withArgs(alice.address, expectedAliceLeaveLpAmount, expectedAliceFreshBeetsAmount)

    expect(await vestingToken.balanceOf(alice.address)).to.equal(expectedAliceLeaveLpAmount)

    const fBeetsSupplyBeforeBobLeave = await beetsBar.totalSupply()
    const lockedFidelioTokensBeforeBobLeave = await vestingToken.balanceOf(beetsBar.address)
    const bobAmount = await beetsBar.balanceOf(bob.address)
    const expectedBobLeaveLpAmount = bobAmount.mul(lockedFidelioTokensBeforeBobLeave).div(fBeetsSupplyBeforeBobLeave)
    await expect(beetsBar.connect(bob).leave(bobAmount))
      .to.emit(beetsBar, "Leave")
      .withArgs(bob.address, expectedBobLeaveLpAmount, expectedBobFreshBeetsAmount)
    expect(await vestingToken.balanceOf(bob.address)).to.equal(expectedBobLeaveLpAmount)
  })
})
