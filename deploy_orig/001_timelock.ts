import { HardhatRuntimeEnvironment } from "hardhat/types"

export default async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  const { address, args, receipt } = await deploy("Timelock", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: [deployer, 21600],
  })

  console.log("timelock constructor args", JSON.stringify(args))
}
