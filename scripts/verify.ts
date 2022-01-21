import inquirer from "inquirer"
import fs from "fs"
import path from "path"
import { run } from "hardhat"

const network = process.env.HARDHAT_NETWORK!

async function verify() {
  const baseDir = path.join(process.cwd(), "on_chain", network)

  const files = fs.readdirSync(baseDir)

  const answers = await inquirer.prompt([
    {
      name: "contract",
      message: "select contract:",
      type: "list",
      choices: files.map((file) => file.replace(".json", "")),
    },
  ])

  const fileName = `${answers.contract}.json`
  const file = fs.readFileSync(path.join(baseDir, fileName), "utf-8")
  const report: { contract: string; address: string; args: string[]; verified: boolean } = JSON.parse(file)

  await run("verify:verify", {
    address: report.address,
    constructorArguments: report.args,
  })
  report.verified = true

  fs.writeFileSync(path.join(baseDir, fileName), JSON.stringify(report))
}

verify().catch((error) => console.error(error))
