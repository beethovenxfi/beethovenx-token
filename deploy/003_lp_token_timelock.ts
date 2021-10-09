import { HardhatRuntimeEnvironment } from "hardhat/types"

export default async function ({ getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments
  const { deployer } = await getNamedAccounts()

  await deploy("MasterChefLpTokenTimelock", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: [],
  })
}
