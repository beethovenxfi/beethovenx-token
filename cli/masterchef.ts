import dotenv from "dotenv"
import commander from "commander"
import inquirer from "inquirer"
import { printNetwork } from "./utils/network"
import { stdout } from "./utils/stdout"
import { timelockQueueQuestions } from "./utils/timelock"
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

dotenv.config()

const program = new commander.Command("masterchef-cli")

async function main() {
  program
    .command("add-pool")
    .description("add pool")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "allocationPoints",
          type: "input",
          message: "Allocation points",
        },
        {
          name: "lp",
          type: "input",
          message: "LP token address",
        },
        {
          name: "rewarder",
          type: "input",
          message: "Rewarder address",
          default: "0x0000000000000000000000000000000000000000",
        },
        ...timelockQueueQuestions,
      ])

      let txHash
      if (answers.timelock) {
        stdout.printStep(
          `Queue adding pool to master chef for LP ${answers.lp} with allocation points ${answers.allocationPoints} and rewarder ${answers.rewarder}`
        )
        txHash = await timelocked_addMasterChefPool(answers.allocationPoints, answers.lp, answers.rewarder, answers.eta)
      } else {
        stdout.printStep(
          `Adding pool to master chef for LP ${answers.lp} with allocation points ${answers.allocationPoints} and rewarder ${answers.rewarder}`
        )
        txHash = await addMasterChefPool(answers.allocationPoints, answers.lp, answers.rewarder)
      }
      stdout.printStepDone(`done with tx ${txHash}`)
    })

  program
    .command("set-pool")
    .description("set pool attributes")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "pid",
          type: "input",
          message: "pool ID",
        },
        {
          name: "allocationPoints",
          type: "input",
          message: "Allocation points",
        },
        {
          name: "rewarder",
          type: "input",
          message: "Rewarder address",
          default: "0x0000000000000000000000000000000000000000",
        },
        {
          name: "overwrite",
          type: "confirm",
          message: "overwrite rewarder",
          default: false,
        },
        ...timelockQueueQuestions,
      ])

      let txHash
      if (answers.timelock) {
        stdout.printStep(
          `Queue set attributes for pool ${answers.pid} with allocation points ${answers.allocationPoints} ${
            answers.overwrite ? `and rewarder ${answers.rewarder}` : ""
          }`
        )
        txHash = await timelocked_setMasterChefPool(answers.pid, answers.allocationPoints, answers.rewarder, answers.overwrite, answers.eta)
      } else {
        stdout.printStep(
          `Set attributes for pool ${answers.pid} with allocation points ${answers.allocationPoints} ${
            answers.overwrite ? `and rewarder ${answers.rewarder}` : ""
          }`
        )
        txHash = await setMasterChefPool(answers.pid, answers.allocationPoints, answers.rewarder, answers.overwrite)
      }
      stdout.printStepDone(`done with tx ${txHash}`)
    })

  program
    .command("update-emission-rate")
    .description("update beets emission rate to the base 1e16")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "beetsPerBlock",
          type: "input",
          message: "Beets/Block * 1e16",
        },
        ...timelockQueueQuestions,
      ])

      const beetsPerBlock = bn(answers.beetsPerBlock, 16)

      let txHash
      if (answers.timelock) {
        stdout.printStep(`Queue set beets emission to ${beetsPerBlock}`)
        txHash = await timelocked_updateEmissionRate(beetsPerBlock, answers.eta)
      } else {
        stdout.printStep(`Set beets emission to ${beetsPerBlock}`)
        txHash = await updateEmissionRate(beetsPerBlock)
      }
      stdout.printStepDone(`done with tx ${txHash}`)
    })

  program
    .command("set-treasury-address")
    .description("set treasury address")
    .action(async () => {
      await printNetwork()
      const answers = await inquirer.prompt([
        {
          name: "address",
          type: "input",
          message: "Treasury address",
        },
        ...timelockQueueQuestions,
      ])

      let txHash
      if (answers.timelock) {
        stdout.printStep(`Queue set treasury address to ${answers.address}`)
        txHash = await timelocked_setTreasuryAddress(answers.address, answers.eta)
      } else {
        stdout.printStep(`Set treasury address to ${answers.address}`)
        txHash = await setTreasuryAddress(answers.address)
      }
      stdout.printStepDone(`done with tx ${txHash}`)
    })

  program
    .command("list-pools")
    .description("list pools")
    .action(async () => {
      await printNetwork()
      await listPools()
    })

  await program.parseAsync(process.argv)
}

main().catch((error) => {
  stdout.printError(error.message, error)
  process.exit(1)
})
