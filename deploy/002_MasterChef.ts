import { bn } from "../test/utilities"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BeethovenxMasterChef, BeethovenxToken, Timelock } from "../types"

const deployMasterchef = async function ({ ethers, deployments, getNamedAccounts, network }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()
  const beetsDeployment = await deployments.get("BeethovenxToken")
  const beets: BeethovenxToken = (await ethers.getContractAt("BeethovenxToken", beetsDeployment.address)) as BeethovenxToken

  const beetsPerBlock = bn(505, 16)

  const startBlock = process.env.DEPLOYMENT_MC_START_BLOCK

  const { args } = await deploy("BeethovenxMasterChef", {
    from: deployer,
    args: [beets.address, process.env.TREASURY_ADDRESS, beetsPerBlock, startBlock],
    log: true,
    deterministicDeployment: false,
    contract: "BeethovenxMasterChef",
  })

  console.log("masterchef constructor args", JSON.stringify(args))
}

deployMasterchef.tags = ["MasterChef"]
deployMasterchef.dependencies = ["BeetsToken"]

export default deployMasterchef
