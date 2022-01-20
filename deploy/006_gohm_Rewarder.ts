import { HardhatRuntimeEnvironment } from "hardhat/types"

const deployGohmRewarder = async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  await deploy("GohmRewarder", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    contract: "TimeBasedRewarder",
    args: ["0x91fa20244Fb509e8289CA630E5db3E9166233FDc", "2893518518518", "0x8166994d9ebBe5829EC86Bd81258149B87faCfd3"],
  })
}

deployGohmRewarder.tags = ["GohmRewarder"]
export default deployGohmRewarder
