import { expect } from "chai"
import {
  advanceBlock,
  advanceBlockRelativeTo,
  advanceBlockTo,
  bn,
  deployChef,
  deployContract,
  deployERC20Mock,
  setAutomineBlocks,
} from "./utilities"
import { ethers } from "hardhat"
import { BeethovenxMasterChef, BeethovenxToken, ReliquaryBeetsStreamer, RewarderMock } from "../types"
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { BigNumber } from "ethers"
import exp from "constants"

describe("ReliquaryBeetsStreamer", function () {
  let beets: BeethovenxToken
  let owner: SignerWithAddress
  let dev: SignerWithAddress
  let treasury: SignerWithAddress
  let alice: SignerWithAddress
  let bob: SignerWithAddress
  let reliquary: SignerWithAddress
  let streamer: ReliquaryBeetsStreamer
  let chef: BeethovenxMasterChef

  // these are fixed values hardcoded in the contract
  // 1000 = 100 %
  const treasuryPercentage = 128
  const lpPercentage = 872

  before(async function () {
    const signers = await ethers.getSigners()
    owner = signers[0]
    dev = signers[1]
    treasury = signers[2]
    alice = signers[4]
    bob = signers[5]
    reliquary = signers[6]
  })

  beforeEach(async function () {
    beets = await deployContract("BeethovenxToken", [])
    // 0x04068da6c83afcfa0e13ba15a6696662335d5b75,0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83,0xde1e704dae0b4051e80dabb26ab6ad6c12262da0,0x10010078a54396f62c96df8532dc2b4847d47ed3,0xf24bcf4d1e507740041c9cfd2dddb29585adce1e,0x74b23882a30290451A17c44f4F05243b6b58C76d,0xde5ed76e7c05ec5e4572cfc88d1acea165109e44,0x91fa20244Fb509e8289CA630E5db3E9166233FDc,0x10b620b2dbac4faa7d7ffd71da486f5d44cd86f9,0x5ddb92a5340fd0ead3987d3661afcd6104c3b757,0xc0064b291bd3d4ba0e44ccfc81bf8e7f7a579cd2
    chef = await deployChef(beets.address, treasury.address, bn(6), 0)
    await beets.transferOwnership(chef.address)

    // there are no pools on the mastechef, so the pool id is 0
    const poolId = 0
    streamer = await deployContract("ReliquaryBeetsStreamer", [chef.address, poolId, reliquary.address])

    await chef.add(10, streamer.address, ethers.constants.AddressZero)
  })

  it("deposit the streamer bpt into the farm", async () => {
    await streamer.deposit()

    const userInfo = await chef.userInfo(0, streamer.address)
    expect(userInfo.amount).to.be.equal(1)
  })

  it("harvest pending rewards to reliquary", async () => {
    const txn = await streamer.deposit()

    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)
    expect(await beets.balanceOf(reliquary.address)).to.be.equal(0)

    await advanceBlockTo(txn.blockNumber! + 100)

    await streamer.harvestToReliquary()

    expect(await beets.balanceOf(streamer.address)).to.be.equal(0)
    expect(await beets.balanceOf(reliquary.address)).to.be.gt(0)
  })

  it("only owner can call streamer", async () => {
    await expect(streamer.connect(alice).deposit()).to.be.revertedWith("Ownable: caller is not the owner")
    await expect(streamer.connect(bob).harvestToReliquary()).to.be.revertedWith("Ownable: caller is not the owner")
  })
})
