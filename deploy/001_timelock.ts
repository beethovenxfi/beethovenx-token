import { HardhatRuntimeEnvironment } from "hardhat/types"

const deployTimelock = async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  const { address, args, receipt } = await deploy("Timelock", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    args: [deployer, 21600],
  })
}

deployTimelock.tags = ["Timelock"]
export default deployTimelock
