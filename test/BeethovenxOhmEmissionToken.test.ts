import { bn, deployContract } from "./utilities"
import { BeethovenxOhmEmissionToken } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers } from "hardhat"
import { expect } from "chai"

describe("BeethovenX token tests", () => {
  let tokenHolder: SignerWithAddress

  beforeEach(async function () {
    const signers = await ethers.getSigners()
    tokenHolder = signers[4]
  })

  it("mints 100 tokens to token holder on deployment", async () => {
    const ohmEmissionToken = await deployContract<BeethovenxOhmEmissionToken>("BeethovenxOhmEmissionToken", [tokenHolder.address])
    expect(await ohmEmissionToken.totalSupply()).to.equal(bn(100))
    expect(await ohmEmissionToken.balanceOf(tokenHolder.address)).to.equal(await ohmEmissionToken.totalSupply())
  })

  it("transfers ownership to token holder on deployment", async () => {
    const ohmEmissionToken = await deployContract<BeethovenxOhmEmissionToken>("BeethovenxOhmEmissionToken", [tokenHolder.address])
    expect(await ohmEmissionToken.owner()).to.equal(tokenHolder.address)
  })
})
