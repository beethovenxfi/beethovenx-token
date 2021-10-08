import dotenv from "dotenv"
import commander from "commander"
import { printNetwork } from "./utils/network"
import inquirer from "inquirer"
import { stdout } from "./utils/stdout"
import { listVestedAmount, printPercentageAmount, vestLps } from "./contract-interactions/lp-vesting"
import { listPools } from "./contract-interactions/masterchef"

dotenv.config()

const program = new commander.Command("vesting-cli")

async function main() {
  program
    .command("print-percentage")
    .description("prinit percentage")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "percentage",
          type: "input",
          message: "percentage to 1000 = 100%",
        },
      ])
      await printPercentageAmount(parseInt(answers.percentage))
    })

  program
    .command("deposit")
    .description("deposit lp to vesting contract")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "contract",
          type: "input",
          message: "vesting contract",
        },
        {
          name: "amount",
          type: "input",
          message: "amount",
        },
        {
          name: "beneficiary",
          type: "input",
          message: "beneficiary address",
        },
      ])

      stdout.printStep(`Vesting ${answers.amount} into ${answers.contract}\n`)
      const txHash = await vestLps(answers.contract, answers.amount, answers.beneficiary)
      stdout.printStepDone(`done with tx ${txHash}`)
    })

  program
    .command("show-deposit")
    .description("show deposited amount")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "contract",
          type: "input",
          message: "vesting contract",
        },
      ])
      await listVestedAmount(answers.contract)
    })

  await program.parseAsync(process.argv)
}

main().catch((error) => {
  stdout.printError(error.message, error)
  process.exit(1)
})
