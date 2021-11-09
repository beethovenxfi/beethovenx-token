import { bn, deployContract, deployERC20Mock } from "./utilities"
import { ethers } from "hardhat"
import { BeethovenxMasterChef, BeethovenxOrchestra, BeethovenxToken, IERC20 } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"

describe("BeethovenxMasterChef", function () {
  let fidelioDuettoToken: IERC20
  let orchestra: BeethovenxOrchestra
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
    fidelioDuettoToken = await deployERC20Mock("FidelioDuetto", "FidelioDuettoBPT", bn(10_000))
    orchestra = await deployContract("BeethovenxOrchestra", [fidelioDuettoToken.address])
  })

  it("sets initial state correctly", async () => {
    expect(await orchestra.fidelioDuetto()).to.equal(fidelioDuettoToken.address)
  })

  it("mints correct amount of fBeets if no tokens have been locked yet", async () => {
    const enterAmount = bn(100)
    await fidelioDuettoToken.transfer(bob.address, enterAmount)

    await fidelioDuettoToken.connect(bob).approve(orchestra.address, enterAmount)
    await orchestra.connect(bob).enter(enterAmount)
    expect(await fidelioDuettoToken.balanceOf(orchestra.address)).to.equal(enterAmount)
    expect(await orchestra.balanceOf(bob.address)).to.equal(enterAmount)
  })

  it("mints correct amount of fBeets if there are already locked tokens while fBeets value has not been increased", async () => {
    const aliceEnterAmount = bn(50)
    await fidelioDuettoToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await fidelioDuettoToken.transfer(bob.address, bobEnterAmount)

    await fidelioDuettoToken.connect(alice).approve(orchestra.address, aliceEnterAmount)
    await orchestra.connect(alice).enter(aliceEnterAmount)

    await fidelioDuettoToken.connect(bob).approve(orchestra.address, bobEnterAmount)
    await orchestra.connect(bob).enter(bobEnterAmount)

    expect(await fidelioDuettoToken.balanceOf(orchestra.address)).to.equal(aliceEnterAmount.add(bobEnterAmount))
    expect(await orchestra.balanceOf(alice.address)).to.equal(aliceEnterAmount)
    expect(await orchestra.balanceOf(bob.address)).to.equal(bobEnterAmount)
  })

  it("mints correct amount of fBeets after a value increase of fBeets", async () => {
    const aliceEnterAmount = bn(100)
    await fidelioDuettoToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await fidelioDuettoToken.transfer(bob.address, bobEnterAmount)

    await fidelioDuettoToken.connect(alice).approve(orchestra.address, aliceEnterAmount)
    await orchestra.connect(alice).enter(aliceEnterAmount)

    // lets double the value of fBeets

    const valueIncreaseAmount = bn(100)
    await fidelioDuettoToken.transfer(orchestra.address, valueIncreaseAmount)

    // now bob enters, so his share is now only half of the one of alice
    await fidelioDuettoToken.connect(bob).approve(orchestra.address, bobEnterAmount)
    await orchestra.connect(bob).enter(bobEnterAmount)

    expect(await fidelioDuettoToken.balanceOf(orchestra.address)).to.equal(aliceEnterAmount.add(bobEnterAmount).add(valueIncreaseAmount))
    expect(await orchestra.balanceOf(alice.address)).to.equal(aliceEnterAmount)
    expect(await orchestra.balanceOf(bob.address)).to.equal(bobEnterAmount.div(2))
  })

  it("transfers correct amount of fidelio duetto after a value increase of fBeets", async () => {
    const aliceEnterAmount = bn(100)
    await fidelioDuettoToken.transfer(alice.address, aliceEnterAmount)

    const bobEnterAmount = bn(100)
    await fidelioDuettoToken.transfer(bob.address, bobEnterAmount)

    await fidelioDuettoToken.connect(alice).approve(orchestra.address, aliceEnterAmount)
    await orchestra.connect(alice).enter(aliceEnterAmount)

    // lets double the value of fBeets

    const firstValueIncrease = bn(100)
    await fidelioDuettoToken.transfer(orchestra.address, firstValueIncrease)

    // now bob enters, so his share is now only half of the one of alice
    await fidelioDuettoToken.connect(bob).approve(orchestra.address, bobEnterAmount)
    await orchestra.connect(bob).enter(bobEnterAmount)

    // lets add another 100 fBeets

    const secondValueIncrease = bn(100)
    await fidelioDuettoToken.transfer(orchestra.address, secondValueIncrease)

    expect(await fidelioDuettoToken.balanceOf(orchestra.address)).to.equal(
      aliceEnterAmount.add(bobEnterAmount).add(firstValueIncrease).add(secondValueIncrease)
    )

    /*
       amount = fBeets *  totalLockedFidelioDuettos / total_fBeets;

       so we left with alice first:
        alice_amount = 100 * 400 / 150 = 266.666

       then bob:
        bob_amount = 50 * (400 - 266.666) / 50 = 133.333
     */

    const fBeetsSupplyBeforeAliceLeave = await orchestra.totalSupply()
    const lockedFidelioTokensBeforeAliceLeave = await fidelioDuettoToken.balanceOf(orchestra.address)
    const aliceAmount = await orchestra.balanceOf(alice.address)
    await orchestra.connect(alice).leave(aliceAmount)
    expect(await fidelioDuettoToken.balanceOf(alice.address)).to.equal(
      aliceAmount.mul(lockedFidelioTokensBeforeAliceLeave).div(fBeetsSupplyBeforeAliceLeave)
    )

    const fBeetsSupplyBeforeBobLeave = await orchestra.totalSupply()
    const lockedFidelioTokensBeforeBobLeave = await fidelioDuettoToken.balanceOf(orchestra.address)
    const bobAmount = await orchestra.balanceOf(bob.address)
    await orchestra.connect(bob).leave(bobAmount)
    expect(await fidelioDuettoToken.balanceOf(bob.address)).to.equal(
      bobAmount.mul(lockedFidelioTokensBeforeBobLeave).div(fBeetsSupplyBeforeBobLeave)
    )
  })
})
