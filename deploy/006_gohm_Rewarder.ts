import { HardhatRuntimeEnvironment } from "hardhat/types"

const deployGohmRewarder = async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  await deploy("GohmRewarder", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    contract: "TimeBasedRewarder",
    args: [0x91fa20244fb509e8289ca630e5db3e9166233fdc, 2893518518518, 0x8166994d9ebbe5829ec86bd81258149b87facfd3],
  })
}

deployGohmRewarder.tags = ["GohmRewarder"]
export default deployGohmRewarder
