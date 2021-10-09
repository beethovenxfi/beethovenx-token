import { bn } from "../test/utilities"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BeethovenxMasterChef, BeethovenxToken, Timelock } from "../types"

export default async function ({ ethers, deployments, getNamedAccounts, network }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments
  const { deployer, dev, treasury } = await getNamedAccounts()
  const beetsDeployment = await deployments.get("BeethovenxToken")
  const beets: BeethovenxToken = (await ethers.getContractAt(
    "contracts/BeethovenxToken.sol:BeethovenxToken",
    beetsDeployment.address
  )) as BeethovenxToken

  const beetsPerBlock = bn(505, 16)

  const startBlock = process.env.DEPLOYMENT_MC_START_BLOCK

  const { address, args } = await deploy("BeethovenxMasterChef", {
    from: deployer,
    args: [beets.address, process.env.TREASURY_ADDRESS, beetsPerBlock, startBlock],
    log: true,
    deterministicDeployment: false,
    contract: "contracts/BeethovenxMasterChef.sol:BeethovenxMasterChef",
  })

  console.log("masterchef constructor args", JSON.stringify(args))

  if ((await beets.owner()) !== address) {
    // Transfer BEETS Ownership to Chef
    console.log("Transfer Beets Ownership to Chef")
    await (await beets.transferOwnership(address)).wait()
  }
}
