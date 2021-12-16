import { HardhatRuntimeEnvironment } from "hardhat/types"

export default async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  const { address } = await deploy("BeethovenxOhmEmissionToken", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    contract: "contracts/BeethovenxOhmEmissionToken.sol:BeethovenxOhmEmissionToken",
    args: ["0x0EDfcc1b8D082Cd46d13Db694b849D7d8151C6D5"],
  })
}
