import { HardhatRuntimeEnvironment } from "hardhat/types"
import { BeethovenxToken } from "../types"
import { bn } from "../test/utilities"

export default async function ({ ethers, getNamedAccounts, deployments }: HardhatRuntimeEnvironment) {
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  const { address } = await deploy("BeethovenxToken", {
    from: deployer,
    log: true,
    deterministicDeployment: false,
    contract: "contracts/BeethovenxToken.sol:BeethovenxToken",
  })

  const beets = (await ethers.getContractAt("contracts/BeethovenxToken.sol:BeethovenxToken", address)) as BeethovenxToken

  const partnershipFundAddress = process.env.PARTNERSHIP_FUND_ADDRESS!
  // 7% of total supply
  const strategicPartnershipFunds = bn(17_500_000)

  const teamFundVestingAddress = process.env.TEAM_FUND_VESTING_ADDRESS!

  // 13% of total supply
  const vestedTeamFunds = bn(30_875_000)

  const teamFundAddress = process.env.TEAM_FUND_ADDRESS!
  const unvestedTeamFund = bn(1_625_000)

  // 2% of total supply
  const lbpFunds = bn(5_000_000)
  const lbpFundAddress = process.env.LBP_FUND_ADDRESS!

  if ((await beets.balanceOf(partnershipFundAddress)).eq(0)) {
    console.log(
      `minting strategic partnership funds '${strategicPartnershipFunds}' to strategic partnership address '${partnershipFundAddress}'`
    )
    await beets.mint(partnershipFundAddress, strategicPartnershipFunds)
  }

  if ((await beets.balanceOf(teamFundVestingAddress)).eq(0)) {
    console.log(`minting vested team funds '${vestedTeamFunds}' to team vesting contract address '${teamFundVestingAddress}'`)
    await beets.mint(teamFundVestingAddress, vestedTeamFunds)
  }

  if ((await beets.balanceOf(teamFundAddress)).eq(0)) {
    console.log(`minting unvested team funds '${unvestedTeamFund}' to team contract address '${teamFundAddress}'`)
    await beets.mint(teamFundAddress, unvestedTeamFund)
  }
  if ((await beets.balanceOf(lbpFundAddress)).eq(0)) {
    console.log(`minting lbp funds '${lbpFunds}' to lbp address '${lbpFundAddress}'`)
    await beets.mint(lbpFundAddress, lbpFunds)
  }
}
