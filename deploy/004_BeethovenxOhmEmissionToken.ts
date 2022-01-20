import { HardhatRuntimeEnvironment } from "hardhat/types"

const deployOhmEmissionToken = async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  await deploy("BeethovenxOhmEmissionToken", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    contract: "BeethovenxOhmEmissionToken",
    args: ["0x0EDfcc1b8D082Cd46d13Db694b849D7d8151C6D5"],
  })
}

deployOhmEmissionToken.tags = ["OhmEmissionToken"]
export default deployOhmEmissionToken
