import { deployContract, bn } from "./utilities"
import { BeethovenxToken } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { ethers } from "hardhat"
import { expect } from "chai"

describe("BeethovenX token tests", () => {
  let beetx: BeethovenxToken
  let owner: SignerWithAddress
  let dev: SignerWithAddress
  let treasury: SignerWithAddress

  beforeEach(async function () {
    beetx = await deployContract("BeethovenxToken", [])
    const signers = await ethers.getSigners()
    owner = signers[0]
    dev = signers[1]
    treasury = signers[2]
  })

  it("allows owner to mint", async () => {
    const amountToMint = bn(1000)
    await beetx.mint(dev.address, amountToMint)
    expect(await beetx.balanceOf(dev.address)).to.be.equal(amountToMint)
  })

  it("reverts when someone else than the owner wants to mint", async () => {
    const amountToMint = bn(1000)
    await expect(beetx.connect(treasury).mint(dev.address, amountToMint)).to.be.revertedWith("Ownable: caller is not the owner")
  })

  it("allows transfershipt of owner", async () => {
    await beetx.transferOwnership(treasury.address)
    await expect(beetx.connect(treasury).mint(dev.address, bn(1000))).not.to.be.reverted
  })

  it("reverts minting if total supply >= max supply of 250mio tokens", async () => {
    const amountToMint = bn(250_000_000)
    await beetx.mint(dev.address, amountToMint)
    // we try to mint 1 additional token which should be reverted
    await expect(beetx.mint(dev.address, 1)).to.be.revertedWith("BEETS::mint: cannot exceed max supply")
  })
})
