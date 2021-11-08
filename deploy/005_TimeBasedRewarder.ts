import { bn } from "../test/utilities"
import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BeethovenxMasterChef, BeethovenxToken } from "../types"

export default async function ({ ethers, deployments, getNamedAccounts, network }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments
  const { deployer, dev, treasury } = await getNamedAccounts()

  const masterChefDeployment = await deployments.get("BeethovenxMasterChef")

  const { address, args } = await deploy("HNDTimeBasedRewarder", {
    from: deployer,
    args: ["0x10010078a54396F62c96dF8532dc2B4847d47ED3", "2480158730158730158", masterChefDeployment.address],
    log: true,
    deterministicDeployment: false,
    contract: "contracts/TimeBasedRewarder.sol:TimeBasedRewarder",
  })

}
