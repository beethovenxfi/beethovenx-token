import dotenv from "dotenv"
import commander from "commander"
import inquirer from "inquirer"
import { getTimelockTransactionIds, getTimelockTransactions, timelockQueueQuestions } from "./utils/timelock"
import { printNetwork } from "./utils/network"
import { stdout } from "./utils/stdout"
import {
  acceptAdmin,
  executeTransaction,
  getTimelockAdmin,
  getTimelockSettings,
  setPendingTimelockAdmin,
  timelocked_setPendingTimelockAdmin,
} from "./contract-interactions/time-lock"

dotenv.config()

const program = new commander.Command("timelock")

async function main() {
  program
    .command("set-pending-admin")
    .description("set pending timelock admin")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "admin",
          type: "input",
          message: "new timelock admin",
        },
        ...timelockQueueQuestions,
      ])
      if (answers.timelock) {
        stdout.printStep(`Queuing set pending timelock admin to ${answers.admin} on eta ${answers.eta}`)
        const txHash = await timelocked_setPendingTimelockAdmin(answers.admin, "queue", answers.eta)

        stdout.printStepDone(`done with tx ${txHash}`)
      } else {
        stdout.printStep(`set pending timelock admin to ${answers.admin}`)
        const txHash = await setPendingTimelockAdmin(answers.admin)
        stdout.printStepDone(`done with tx ${txHash}`)
      }
    })

  program
    .command("accept-pending-admin")
    .description("accept pending timelock admin")
    .action(async () => {
      await printNetwork()
      stdout.printStep(`accepting pending admin for timelock`)
      const txHash = await acceptAdmin()
      stdout.printStepDone(`done with tx ${txHash}`)
    })

  program
    .command("current-admin")
    .description("get current timelock admin")
    .action(async () => {
      await printNetwork()
      stdout.printInfo(`Current timelock admin: ${await getTimelockAdmin()}`)
    })

  program
    .command("list-settings")
    .description("list current timelock settings")
    .action(async () => {
      await printNetwork()
      const { delay, maximumDelay, minimumDelay, gracePeriod } = await getTimelockSettings()
      stdout.printInfo(`Current timelock delay: ${delay} seconds`)
      stdout.printInfo(`Maximum delay: ${maximumDelay} seconds`)
      stdout.printInfo(`Minimum delay: ${minimumDelay} seconds`)
      stdout.printInfo(`Grace period: ${gracePeriod} seconds`)
    })
  program
    .command("list-transactions")
    .description("list all transaction")
    .action(async () => {
      await printNetwork()
      stdout.printInfo(getTimelockTransactions())
    })

  program
    .command("execute")
    .description("execute transaction")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "transactionId",
          message: "select transaction id",
          type: "list",
          when: () => getTimelockTransactionIds().length > 0,
          choices: getTimelockTransactionIds(),
        },
      ])
      if (!answers.transactionId) {
        stdout.printInfo(`Currently no transactions available to execute`)
        return
      }
      stdout.printStep(`Executing transaction with id ${answers.transactionId}`)
      const txHash = await executeTransaction(answers.transactionId)
      stdout.printStepDone(`done with tx ${txHash}`)
    })

  await program.parseAsync(process.argv)
}

main().catch((error) => {
  stdout.printError(error.message, error)
  process.exit(1)
})
