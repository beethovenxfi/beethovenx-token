import { scriptConfig } from "../cli-config"
import { ethers, network } from "hardhat"
import { BeethovenxMasterChef, BeethovenxToken } from "../../types"
import { stdout } from "../utils/stdout"

const config = scriptConfig[network.config.chainId!]

export async function printCirculatingSupply() {
  const token = (await ethers.getContractAt("BeethovenxToken", config.contractAddresses.BeethovenxToken)) as BeethovenxToken
  const totalSupply = await token.totalSupply()
  const teamVesting = await token.balanceOf(config.contractAddresses.TeamVesting)
  const treasury = await token.balanceOf(config.walletAddresses.treasury)
  const partnership = await token.balanceOf(config.walletAddresses.partnership)
  const team = await token.balanceOf(config.walletAddresses.team)

  stdout.printInfo(`Total supply: ${ethers.utils.formatUnits(totalSupply, await token.decimals())}`)
  stdout.printInfo(`Vested team: ${ethers.utils.formatUnits(teamVesting, await token.decimals())}`)
  stdout.printInfo(`Treasury: ${ethers.utils.formatUnits(treasury, await token.decimals())}`)
  stdout.printInfo(`Partnership: ${ethers.utils.formatUnits(partnership, await token.decimals())}`)
  stdout.printInfo(`Team: ${ethers.utils.formatUnits(team, await token.decimals())}`)
  // stdout.printInfo(`Circulating supply: ${ethers.utils.formatUnits(totalSupply.sub(teamVesting), await token.decimals())}`)
}
