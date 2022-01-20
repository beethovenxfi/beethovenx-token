import { HardhatRuntimeEnvironment } from "hardhat/types"

const deployCRE8RRewarder = async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  await deploy("CRE8RRewarder", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    contract: "TimeBasedRewarder",
    args: ["0x2aD402655243203fcfa7dCB62F8A08cc2BA88ae0", "32150205761317000", "0x8166994d9ebBe5829EC86Bd81258149B87faCfd3"],
  })
}

deployCRE8RRewarder.tags = ["CRE8RRewarder"]
export default deployCRE8RRewarder
