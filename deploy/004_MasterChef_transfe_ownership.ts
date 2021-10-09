import { bn } from "../test/utilities"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BeethovenxMasterChef, BeethovenxToken, Timelock } from "../types"

export default async function ({ ethers, deployments, getNamedAccounts, network }: HardhatRuntimeEnvironment) {
  const masterChef = (await ethers.getContractAt(
    "contracts/BeethovenxMasterChef.sol:BeethovenxMasterChef",
    "0x8166994d9ebBe5829EC86Bd81258149B87faCfd3"
  )) as BeethovenxMasterChef
  if ((await masterChef.owner()) !== "0xB5CaEe3CD5d86c138f879B3abC5B1bebB63c6471") {
    // Transfer ownership of MasterChef to timelock
    console.log("Transfer ownership of MasterChef to Timelock")
    const tx = await (await masterChef.transferOwnership("0xB5CaEe3CD5d86c138f879B3abC5B1bebB63c6471")).wait()
    console.log(tx.transactionHash)
  }
}
