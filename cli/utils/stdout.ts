import chalk from "chalk"

class StdOut {
  printStep(message: string) {
    process.stdout.write(chalk.blueBright(`${message}...`))
  }

  printStepDone(message = "done!") {
    process.stdout.write(chalk.blueBright(message) + "\n")
  }

  printError(message: string, error?: Error) {
    console.log(chalk.redBright(message), error)
  }

  printWarning(message: string) {
    console.log(chalk.yellowBright(message))
  }

  printSuccess(message: string) {
    console.log(chalk.greenBright(message))
  }

  printInfo(message: string) {
    console.log(chalk.yellowBright(message))
  }
}

export const stdout = new StdOut()
