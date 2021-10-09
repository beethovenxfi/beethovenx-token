import dotenv from "dotenv"
import commander from "commander"
import { printNetwork } from "./utils/network"
import inquirer from "inquirer"
import { listVestedAmount, printPercentageAmount, vestLps } from "./contract-interactions/lp-vesting"
import { stdout } from "./utils/stdout"
import { printCirculatingSupply } from "./contract-interactions/token"

dotenv.config()

const program = new commander.Command("token-cli")

async function main() {
  program
    .command("circulating-supply")
    .description("circulating supply")
    .action(async () => {
      await printNetwork()
      await printCirculatingSupply()
    })

  await program.parseAsync(process.argv)
}

main().catch((error) => {
  stdout.printError(error.message, error)
  process.exit(1)
})
