import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BeethovenxToken } from "../types"

const deployToken = async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  await deploy("BeethovenxToken", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    contract: "BeethovenxToken",
  })
}

deployToken.tags = ["BeetsToken"]

export default deployToken
