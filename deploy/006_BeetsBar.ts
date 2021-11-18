import { bn } from "../test/utilities"
import { HardhatRuntimeEnvironment } from "hardhat/types"

export default async function ({ ethers, deployments, getNamedAccounts, network }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments
  const { deployer, dev, treasury } = await getNamedAccounts()

  const { address, args } = await deploy("BeetsBar", {
    from: deployer,
    args: [process.env.FBEETS_VESTED_TOKEN],
    log: true,
    deterministicDeployment: false,
    contract: "contracts/BeetsBar.sol:BeetsBar",
  })
}
