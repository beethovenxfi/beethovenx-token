module.exports = async function ({ ethers, deployments, getNamedAccounts }) {
  const { deploy } = deployments
  const { deployer, dev, treasury } = await getNamedAccounts()
  const beethovenx = await ethers.getContract("BeethovenxToken")

  const beetxPerBlock = '3000000000000000000';
  const startBlock = 0;
  const devPercent = 200;
  const treasuryPercent = 200;

  const { address } = await deploy("BeethovenxMasterChef", {
    from: deployer,
    args: [beethovenx.address, dev, treasury, beetxPerBlock, startBlock, devPercent, treasuryPercent],
    log: true,
    deterministicDeployment: false
  })

  if (await beethovenx.owner() !== address) {
    // Transfer Sushi Ownership to Chef
    console.log("Transfer Sushi Ownership to Chef")
    await (await beethovenx.transferOwnership(address)).wait()
  }

  const masterChef = await ethers.getContract("BeethovenxMasterChef")
  if (await masterChef.owner() !== dev) {
    // Transfer ownership of MasterChef to dev
    console.log("Transfer ownership of MasterChef to dev")
    await (await masterChef.transferOwnership(dev)).wait()
  }
}

module.exports.tags = ["BeethovenxMasterChef"]
