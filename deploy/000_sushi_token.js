 module.exports = async function ({ getNamedAccounts, deployments }) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  await deploy("BeethovenxToken", {
    from: deployer,
    log: true,
    deterministicDeployment: false
  })
}

