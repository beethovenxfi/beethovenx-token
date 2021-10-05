import { network } from "hardhat"
import inquirer from "inquirer"
import chalk from "chalk"

export async function printNetwork(confirmIfMainnet = true) {
  console.log(chalk.cyanBright(`\n------------ you are on ${network.name} network ------------\n`.toUpperCase()))

  if (confirmIfMainnet && network.name === process.env.MAINNET) {
    const answers = await inquirer.prompt([
      {
        name: "confirm",
        type: "confirm",
        message: `You are on MAINNET (${network.name}), proceed?`,
      },
    ])
    if (!answers.confirm) {
      process.exit(1)
    }
  }
}
