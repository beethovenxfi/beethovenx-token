import dotenv from "dotenv"
import commander from "commander"
import { printNetwork } from "./utils/network"
import inquirer from "inquirer"
import { timelockQueueQuestions } from "./utils/timelock"
import { stdout } from "./utils/stdout"
import {
  addMasterChefPool,
  listPools,
  setMasterChefPool,
  setTreasuryAddress,
  timelocked_addMasterChefPool,
  timelocked_setMasterChefPool,
  timelocked_setTreasuryAddress,
  timelocked_updateEmissionRate,
  updateEmissionRate,
} from "./contract-interactions/masterchef"
import { bn } from "../test/utilities"
import { printPercentageAmount, vestLps } from "./contract-interactions/lp-vesting"

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
      const txHash = await vestLps(answers.contract, answers.amount)
      stdout.printStepDone(`done with tx ${txHash}`)
    })

  await program.parseAsync(process.argv)
}

main().catch((error) => {
  stdout.printError(error.message, error)
  process.exit(1)
})
